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
  let stage = 'initialize';
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    await editor.evaluate(() => window.markerTest.receive({ type: 'initialize', sessionId: 'test-session', text: '# 初始\n' }));
    await editor.locator('#editor .cm-content').waitFor();
    await editor.locator('#editor .cm-content').click();
    await editor.keyboard.press('Control+End');
    await editor.keyboard.insertText('中文 😀');
    stage = 'snapshot';
    await editor.waitForFunction(() => window.markerTest.sent.some(message => message.type === 'snapshot' && message.text.includes('中文 😀')));
    const snapshot = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'snapshot').at(-1));
    check(snapshot.sessionId === 'test-session' && snapshot.version > 0, 'snapshot session/version');
    await editor.keyboard.press('Control+z');
    stage = 'undo';
    await editor.waitForFunction(() => window.markerTest.sent.filter(message => message.type === 'snapshot').at(-1)?.text === '# 初始\n');
    await editor.keyboard.press('Control+y');
    stage = 'redo';
    await editor.waitForFunction(() => window.markerTest.sent.filter(message => message.type === 'snapshot').at(-1)?.text.includes('中文 😀'));
    const before = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'snapshot').at(-1));
    await editor.evaluate(() => window.markerTest.receive({ type: 'initialize', sessionId: 'test-session', text: '不得覆盖编辑内容' }));
    await editor.evaluate(() => window.markerTest.receive({ type: 'requestSnapshot', sessionId: 'test-session' }));
    const after = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'snapshot').at(-1));
    check(after.text === before.text && after.version === before.version, 'resync must preserve text and undo history');
    await preview.goto('http://127.0.0.1:5173/preview.html');
    await preview.evaluate(() => {
      window.markerTest.receive({ type: 'initialize', sessionId: 'test-session', text: '' });
      window.markerTest.receive({ type: 'render', sessionId: 'test-session', version: 5,
        html: '<h1>安全预览</h1><script>window.pwned=1</script><img src="https://example.com/x" onerror="window.pwned=2"><a href="javascript:window.pwned=3">链接</a><iframe src="https://example.com"></iframe><input autofocus>' });
    });
    check(await preview.locator('#preview h1').innerText() === '安全预览', 'render content');
    check(await preview.locator('#preview script, #preview img, #preview iframe, #preview input, #preview [href], #preview [onerror]').count() === 0, 'unsafe preview markup');
    check(await preview.evaluate(() => !window.pwned), 'script executed');
    await preview.evaluate(() => {
      window.markerTest.receive({ type: 'render', sessionId: 'test-session', version: 4, html: '<h1>旧版本</h1>' });
      window.markerTest.receive({ type: 'render', sessionId: 'wrong-session', version: 6, html: '<h1>错误会话</h1>' });
    });
    check(await preview.locator('#preview h1').innerText() === '安全预览', 'stale/wrong-session render');
    check(await preview.evaluate(() => window.markerTest.sent.some(message => message.type === 'rendered' && message.version === 5)), 'render ack');
    return { passed: true, checks: ['snapshot UTF-16 text', 'undo/redo', 'resync', 'sanitization', 'stale version/session', 'render ack'], windowsIme: 'not tested' };
  } catch (error) {
    throw new Error(`${stage}: ${error.message}; ${JSON.stringify(await editor.evaluate(() => ({ sent: window.markerTest?.sent, text: document.querySelector('.cm-content')?.textContent, platform: navigator.platform })))}`);
  } finally { await context.close(); }
}
