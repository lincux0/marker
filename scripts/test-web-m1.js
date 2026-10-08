// Run with the existing Playwright MCP browser_run_code_unsafe (filename).
// Serve Marker.Web production dist with Vite preview on 127.0.0.1:5173 first.
// This checks web behavior, not Windows IME.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const context = await page.context().browser().newContext();
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
    window.chrome = { webview: {
      postMessage: data => window.markerTest.sent.push(data),
      addEventListener: (type, handler) => { if (type === 'message') handlers.push(handler); }
    } };
  });
  const editor = await context.newPage();
  const preview = await context.newPage();
  let snapshotCheck = 0;
  const readEditorText = async () => {
    const requestId = `assert-${++snapshotCheck}`;
    await editor.evaluate(id => window.markerTest.receive({ type: 'requestSnapshot', protocolVersion: 1, sessionId: '11111111111111111111111111111111', requestId: id }), requestId);
    await editor.waitForFunction(id => window.markerTest.sent.some(message => message.type === 'snapshot' && message.requestId === id), requestId);
    return editor.evaluate(id => window.markerTest.sent.findLast(message => message.type === 'snapshot' && message.requestId === id).text, requestId);
  };
  let stage = 'initialize';
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    await editor.evaluate(() => window.markerTest.receive({ type: 'initialize', protocolVersion: 1, sessionId: '11111111111111111111111111111111', text: '# 初始\n' }));
    await editor.locator('#editor .cm-content').waitFor();
    await editor.locator('#editor .cm-content').click();
    await editor.keyboard.press('Control+End');
    await editor.keyboard.insertText('中文 😀');
    stage = 'changes';
    await editor.waitForFunction(() => window.markerTest.sent.some(message => message.type === 'changes' && message.changes.some(change => change.insert.includes('中文 😀'))));
    const change = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').at(-1));
    check(change.protocolVersion === 1 && change.sessionId === '11111111111111111111111111111111' && change.version === change.baseVersion + 1, 'incremental session/version');
    check(await editor.locator('#editor .cm-content').innerText() === '# 初始\n中文 😀', 'incremental edit remains visible');
    const priorChangeCount = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').length);
    await editor.keyboard.press('Control+z');
    stage = 'undo';
    await editor.waitForFunction(count => window.markerTest.sent.filter(message => message.type === 'changes').length > count, priorChangeCount);
    check(await readEditorText() === '# 初始\n', 'undo text');
    const afterUndoCount = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').length);
    await editor.keyboard.press('Control+y');
    stage = 'redo';
    await editor.waitForFunction(count => window.markerTest.sent.filter(message => message.type === 'changes').length > count, afterUndoCount);
    check(await readEditorText() === '# 初始\n中文 😀', 'redo text');
    stage = 'request snapshot';
    const beforeRequestChanges = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').length);
    await editor.keyboard.insertText('待同步');
    await editor.waitForFunction(count => window.markerTest.sent.filter(message => message.type === 'changes').length > count, beforeRequestChanges);
    await editor.evaluate(() => window.markerTest.receive({ type: 'requestSnapshot', protocolVersion: 1, sessionId: '11111111111111111111111111111111', requestId: 'save-1' }));
    await editor.waitForFunction(() => window.markerTest.sent.filter(message => message.type === 'snapshot').at(-1)?.requestId === 'save-1');
    const before = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'snapshot').at(-1));
    check(before.protocolVersion === 1 && before.text.endsWith('中文 😀待同步'), 'request snapshot flushes the latest editor text');
    await editor.evaluate(() => window.markerTest.receive({ type: 'initialize', protocolVersion: 1, sessionId: '11111111111111111111111111111111', text: '不得覆盖编辑内容' }));
    await editor.evaluate(() => window.markerTest.receive({ type: 'requestSnapshot', protocolVersion: 1, sessionId: '11111111111111111111111111111111' }));
    const after = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'snapshot').at(-1));
    check(after.text === before.text && after.version === before.version && !Object.hasOwn(after, 'requestId'), 'resync must preserve text/history without request correlation');
    stage = 'native commands';
    await editor.keyboard.press('Control+n');
    await editor.keyboard.press('Control+o');
    await editor.keyboard.press('Control+s');
    await editor.keyboard.press('Control+Shift+s');
    const commands = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'command'));
    check(commands.slice(-4).map(message => message.command).join(',') === 'new,open,save,saveAs' && commands.slice(-4).every(message => message.protocolVersion === 1), 'native command shortcuts/protocol');
    stage = 'paragraph';
    const beforeParagraphChanges = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').length);
    await editor.keyboard.press('Control+End');
    await editor.keyboard.press('Control+Enter');
    await editor.waitForFunction(count => window.markerTest.sent.filter(message => message.type === 'changes').length > count, beforeParagraphChanges);
    check((await readEditorText()).endsWith('待同步\n\n'), 'paragraph insertion');
    const beforeParagraphUndo = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').length);
    await editor.keyboard.press('Control+z');
    await editor.waitForFunction(count => window.markerTest.sent.filter(message => message.type === 'changes').length > count, beforeParagraphUndo);
    check((await readEditorText()).endsWith('待同步'), 'paragraph undo');
    const beforeParagraphRedo = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').length);
    await editor.keyboard.press('Control+y');
    await editor.waitForFunction(count => window.markerTest.sent.filter(message => message.type === 'changes').length > count, beforeParagraphRedo);
    check((await readEditorText()).endsWith('待同步\n\n'), 'paragraph redo');
    await preview.goto('http://127.0.0.1:5173/preview.html');
    await preview.evaluate(() => {
      window.markerTest.receive({ type: 'initialize', protocolVersion: 1, sessionId: '11111111111111111111111111111111', text: '' });
      window.markerTest.receive({ type: 'render', protocolVersion: 1, sessionId: '11111111111111111111111111111111', version: 5,
        html: '<h1>安全预览</h1><script>window.pwned=1</script><img src="https://example.com/x" onerror="window.pwned=2"><a href="javascript:window.pwned=3">链接</a><iframe src="https://example.com"></iframe><input autofocus>' });
    });
    check(await preview.locator('#preview h1').innerText() === '安全预览', 'render content');
    check(await preview.locator('#preview script, #preview img, #preview iframe, #preview input, #preview [href], #preview [onerror]').count() === 0, 'unsafe preview markup');
    check(await preview.evaluate(() => !window.pwned), 'script executed');
    await preview.evaluate(() => {
      window.markerTest.receive({ type: 'render', protocolVersion: 1, sessionId: '11111111111111111111111111111111', version: 4, html: '<h1>旧版本</h1>' });
      window.markerTest.receive({ type: 'render', protocolVersion: 1, sessionId: 'wrong-session', version: 6, html: '<h1>错误会话</h1>' });
    });
    check(await preview.locator('#preview h1').innerText() === '安全预览', 'stale/wrong-session render');
    check(await preview.evaluate(() => window.markerTest.sent.some(message => message.type === 'rendered' && message.version === 5)), 'render ack');
    return { passed: true, checks: ['versioned incremental edits', 'undo/redo', 'request snapshot flush/correlation', 'resync', 'native command shortcuts', 'paragraph shortcut/undo/redo', 'sanitization', 'stale version/session', 'render ack'], windowsIme: 'not tested' };
  } catch (error) {
    throw new Error(`${stage}: ${error.message}; ${JSON.stringify(await editor.evaluate(() => ({ sent: window.markerTest?.sent, text: document.querySelector('.cm-content')?.textContent, platform: navigator.platform })))}`);
  } finally { await context.close(); }
}
