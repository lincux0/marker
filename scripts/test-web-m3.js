// Run with the existing Playwright MCP browser_run_code_unsafe (filename).
// Serve Marker.Web production dist with Vite preview on 127.0.0.1:5173 first.
// This checks editor protocol/UI behavior, not native Windows IME.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const sessionId = '33333333333333333333333333333333';
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
  let stage = 'initialize';
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    await editor.evaluate(id => window.markerTest.receive({ type: 'initialize', protocolVersion: 1, sessionId: id, text: '# Fruit\napple apple' }), sessionId);
    await editor.locator('#editor .cm-content').waitFor();
    await editor.waitForFunction(() => window.markerTest.sent.some(message => message.type === 'snapshot' && message.version === 0));
    const baselineSnapshots = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'snapshot').length);

    stage = 'incremental UTF-16 edit';
    await editor.locator('#editor .cm-content').click();
    await editor.keyboard.press('Control+End');
    await editor.keyboard.insertText(' 中文 😀');
    await editor.waitForFunction(() => window.markerTest.sent.some(message => message.type === 'changes' && message.changes.some(change => change.insert.includes('中文 😀'))));
    const edit = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').at(-1));
    check(edit.protocolVersion === 1 && edit.sessionId === '33333333333333333333333333333333' && edit.version === edit.baseVersion + 1, 'incremental packet protocol/session/version');
    check(edit.changes.every(change => Number.isInteger(change.from) && Number.isInteger(change.to) && typeof change.insert === 'string'), 'incremental ranges use integer UTF-16 offsets');
    check((await editor.locator('#editor .cm-content').innerText()).endsWith('apple apple 中文 😀'), 'editor applies the Unicode input');
    check(await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'snapshot').length) === baselineSnapshots, 'ordinary edit was not hidden by a synthetic full snapshot');

    stage = 'search and replace';
    await editor.evaluate(id => window.markerTest.receive({ type: 'editorCommand', protocolVersion: 1, sessionId: id, command: 'find' }), sessionId);
    const find = editor.locator('.cm-search-panel input[type="search"]');
    const replace = editor.locator('.cm-search-panel input[type="text"]');
    await find.waitFor();
    await editor.getByRole('button', { name: '关闭', exact: true }).click();
    await editor.locator('#editor .cm-content').click();
    await editor.keyboard.press('Control+f');
    await find.waitFor();
    await editor.getByRole('button', { name: '关闭', exact: true }).click();
    await editor.locator('#editor .cm-content').click();
    await editor.keyboard.press('Control+h');
    await replace.waitFor();
    await editor.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '替换为');
    await find.fill('apple');
    await replace.fill('pear');
    const beforeReplace = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').length);
    await editor.getByRole('button', { name: '全部替换' }).click();
    await editor.waitForFunction(count => window.markerTest.sent.filter(message => message.type === 'changes').length > count, beforeReplace);
    check((await editor.locator('#editor .cm-content').innerText()).includes('pear pear'), 'replace all updates both matches');

    stage = 'settings preserve document and history';
    const beforeSettings = await editor.locator('#editor .cm-content').innerText();
    await editor.evaluate(id => window.markerTest.receive({ type: 'settings', protocolVersion: 1, sessionId: id, theme: 'dark', fontSize: 20, lineHeight: 1.8, lineWrapping: false }), sessionId);
    check(await editor.locator('#editor').getAttribute('data-theme') === 'dark', 'theme setting applied');
    check(await editor.locator('#editor').evaluate(element => getComputedStyle(element).fontSize) === '20px', 'font size setting applied');
    check(await editor.locator('#editor .cm-content').innerText() === beforeSettings, 'settings preserve editor text');
    const beforeUndo = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').length);
    await editor.evaluate(id => window.markerTest.receive({ type: 'editorCommand', protocolVersion: 1, sessionId: id, command: 'undo' }), sessionId);
    await editor.waitForFunction(count => window.markerTest.sent.filter(message => message.type === 'changes').length > count, beforeUndo);
    check((await editor.locator('#editor .cm-content').innerText()).includes('apple apple'), 'settings preserve undo history');
    await editor.evaluate(id => window.markerTest.receive({ type: 'editorCommand', protocolVersion: 1, sessionId: id, command: 'redo' }), sessionId);
    check((await editor.locator('#editor .cm-content').innerText()).includes('pear pear'), 'redo after settings');

    stage = 'status protocol';
    const status = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'status').at(-1));
    check(status.protocolVersion === 1 && status.sessionId === sessionId && status.version > 0 && status.line >= 1 && status.column >= 1 && status.unit === 'utf16', 'status is session/version-bound and reports UTF-16');
    check(status.charCount === await editor.locator('#editor .cm-content').evaluate(element => element.innerText.length), 'status character count uses UTF-16 code units');

    stage = 'composition guards';
    const textBeforeComposition = await editor.locator('#editor .cm-content').innerText();
    await editor.locator('#editor .cm-content').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await editor.evaluate(id => {
      window.markerTest.receive({ type: 'editorCommand', protocolVersion: 1, sessionId: id, command: 'undo' });
      window.markerTest.receive({ type: 'revealSource', protocolVersion: 1, sessionId: id, version: window.markerTest.sent.filter(message => message.type === 'status').at(-1).version, offset: 0 });
    }, sessionId);
    check((await editor.locator('#editor .cm-content').innerText()) === textBeforeComposition, 'composition guards do not mutate text');
    check((await editor.locator('#status').innerText()).includes('请先完成输入法候选输入'), 'composition guard reports deferred command');
    await editor.locator('#editor .cm-content').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));

    return { passed: true, checks: ['actual incremental UTF-16 changes', 'Chinese and emoji input', 'localized search and replace with Ctrl+F/Ctrl+H', 'settings reconfigure without losing history', 'UTF-16 status', 'composition guards'], windowsIme: 'not tested' };
  } catch (error) {
    throw new Error(`${stage}: ${error.message}; ${JSON.stringify(await editor.evaluate(() => ({ sent: window.markerTest?.sent, text: document.querySelector('.cm-content')?.textContent, platform: navigator.platform })))}`);
  } finally { await context.close(); }
}
