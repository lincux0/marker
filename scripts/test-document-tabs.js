// Run with the existing Playwright MCP browser_run_code_unsafe (filename).
// Serve Marker.Web production dist with Vite preview on 127.0.0.1:5173 first.
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
  const sessionId = '11111111111111111111111111111111';
  const firstId = 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
  const secondId = 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb';
  const send = data => editor.evaluate(data => window.markerTest.receive(data), data);
  const initialize = (documentId, text) => send({ protocolVersion: 1, type: 'initialize', sessionId, documentId, text });
  const tabs = (values, activeDocumentId = firstId, busy = false) => send({ protocolVersion: 1, type: 'documentTabs', sessionId, activeDocumentId, tabs: values, busy });
  const text = async () => {
    await send({ protocolVersion: 1, type: 'requestSnapshot', sessionId, requestId: 'tabs-test' });
    return editor.evaluate(() => window.markerTest.sent.findLast(packet => packet.type === 'snapshot' && packet.requestId === 'tabs-test')?.text);
  };
  const firstText = '# One\n\n' + Array.from({ length: 90 }, (_, index) => `Paragraph ${index} with enough text to make a scrollable document.`).join('\n\n');
  let stage = 'initialize';
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    await initialize(firstId, firstText);
    await tabs([
      { id: firstId, title: '👩🏽‍🚀草稿.md', dirty: true },
      { id: secondId, title: '测试设计.md', dirty: false }
    ]);
    const rail = editor.locator('.marker-document-tabs');
    check(await rail.locator('.marker-document-tab-select').count() === 2, 'both open documents render');
    const firstButton = rail.getByRole('button', { name: '切换到👩🏽‍🚀草稿.md，有未保存修改' });
    check(await firstButton.innerText() === '👩🏽‍🚀', 'tab uses the first grapheme and shows the dirty marker');
    check(await firstButton.getAttribute('title') === '👩🏽‍🚀草稿.md', 'hover title contains the full filename');
    await editor.screenshot({ animations: 'disabled', path: 'D:/marker/artifacts/reading-ui/document-tabs-desktop.png' });
    await editor.setViewportSize({ width: 720, height: 800 });
    await editor.screenshot({ animations: 'disabled', path: 'D:/marker/artifacts/reading-ui/document-tabs-720.png' });
    await editor.setViewportSize({ width: 1280, height: 800 });
    await editor.emulateMedia({ colorScheme: 'dark' });
    await editor.screenshot({ animations: 'disabled', path: 'D:/marker/artifacts/reading-ui/document-tabs-dark.png' });
    await editor.emulateMedia({ colorScheme: 'light' });

    stage = 'strict tab validation';
    await send({ protocolVersion: 1, type: 'documentTabs', sessionId, activeDocumentId: firstId,
      tabs: [{ id: firstId, title: 'bad', dirty: false, extra: true }], busy: false });
    check(await rail.locator('.marker-document-tab-select').count() === 2, 'malformed tab packet is ignored');
    await tabs([{ id: firstId, title: '👩🏽‍🚀草稿.md', dirty: true }, { id: secondId, title: '测试设计.md', dirty: false }], firstId, true);
    check(await rail.getByRole('button', { name: '切换到测试设计.md' }).isDisabled(), 'busy state disables switching');
    await tabs([{ id: firstId, title: '👩🏽‍🚀草稿.md', dirty: true }, { id: secondId, title: '测试设计.md', dirty: false }]);

    stage = 'select command';
    await rail.getByRole('button', { name: '切换到测试设计.md' }).click();
    let packet = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'tabCommand').at(-1));
    check(packet?.documentId === secondId && packet.action === 'select' && packet.sessionId === sessionId, 'select command includes target and session');

    stage = 'state restore';
    await initialize(secondId, '# Two\n\nSecond document');
    await editor.keyboard.press('Control+Alt+m');
    check(await editor.locator('#editor .cm-editor').getAttribute('data-source-mode') === 'true', 'source mode activates on the second document');
    await editor.locator('#editor .cm-content').click();
    await editor.keyboard.press('Control+End');
    await editor.keyboard.insertText(' edit');
    const secondEdited = await text();
    await initialize(firstId, firstText);
    await editor.locator('#editor .cm-content').click();
    await editor.keyboard.press('Control+End');
    await editor.keyboard.insertText(' first edit');
    const firstEdited = await text();
    await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await editor.locator(".cm-scroller").evaluate(element => { element.scrollTop = 1300; });
    await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const visibleLine = () => editor.locator(".cm-scroller").evaluate(element => Array.from(element.querySelectorAll(".cm-line")).find(line => line.getBoundingClientRect().bottom > element.getBoundingClientRect().top + 100)?.textContent);
    const firstVisible = await visibleLine();
    await initialize(secondId, secondEdited);
    check(await text() === secondEdited, 'cached document text is restored');
    check(await editor.locator('#editor .cm-editor').getAttribute('data-source-mode') === 'true', 'cached source mode is restored consistently');
    await editor.keyboard.press('Control+z');
    check((await text()) !== secondEdited, 'cached history remains available');
    await initialize(secondId, '# refreshed externally');
    check(await text() === '# refreshed externally', 'changed text for the same document ID resets cached state');
    await initialize(firstId, firstEdited);
    await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check(await visibleLine() === firstVisible, "document reading position is restored");

    stage = 'close command';
    await rail.getByRole('button', { name: '关闭测试设计.md' }).click({ force: true });
    packet = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'tabCommand').at(-1));
    check(packet?.documentId === secondId && packet.action === 'close', 'per-tab close command is emitted');
    await editor.locator('#editor .cm-content').click();
    const closeCount = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'tabCommand' && message.action === 'close').length);
    await editor.keyboard.press('Control+w');
    packet = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'tabCommand').at(-1));
    const afterCloseCount = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'tabCommand' && message.action === 'close').length);
    check(packet?.documentId === firstId && packet.action === 'close' && afterCloseCount === closeCount + 1, 'Ctrl+W emits one close command for the active document');

    stage = 'scroll and focus mode';
    const manyTabs = Array.from({ length: 24 }, (_, index) => ({
      id: (index + 10).toString(16).padStart(32, '0'), title: `文档 ${index}.md`, dirty: false
    }));
    manyTabs[0] = { id: firstId, title: '👩🏽‍🚀草稿.md', dirty: false };
    await tabs(manyTabs);
    check(await rail.evaluate(element => element.scrollHeight > element.clientHeight), 'large tab lists scroll vertically');
    await rail.evaluate(element => { element.scrollTop = element.scrollHeight; });
    await editor.screenshot({ animations: 'disabled', path: 'D:/marker/artifacts/reading-ui/document-tabs-overflow.png' });
    await editor.locator('.marker-toolbar-button[data-action="toggleFocus"]:visible').click();
    check(await rail.evaluate(element => getComputedStyle(element).display === 'none'), 'focus mode hides the tab rail');
    return { passed: true, checks: ['grapheme/title/dirty display', 'strict packet validation', 'busy state', 'select/close protocol', 'cached text and undo history', 'Ctrl+W', 'vertical overflow', 'focus mode visibility'] };
  } catch (error) {
    throw new Error(`${stage}: ${error.message}`);
  } finally { await context.close(); }
}
