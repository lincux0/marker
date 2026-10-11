// Existing Playwright MCP runner; disposable mock bridge, no native settings writes.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
  const editor = await context.newPage();
  const sessionId = '77777777777777777777777777777777';
  const checks = [];
  const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  try {
    await editor.addInitScript(() => {
      const handlers = [];
      window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
      window.chrome = { webview: { postMessage: data => window.markerTest.sent.push(data), addEventListener: (_, handler) => handlers.push(handler) } };
    });
    await editor.goto('http://127.0.0.1:5173/index.html');
    const receive = message => editor.evaluate(data => window.markerTest.receive(data), { protocolVersion: 1, sessionId, ...message });
    await receive({ type: 'initialize', text: '# 自动隐藏测试\n\n正文' });
    const settings = { theme: 'light', fontSize: 16, lineHeight: 1.5, lineWrapping: true, reducedMotion: true, hiddenToolbarActions: ['recover'] };
    await receive({ type: 'settings', ...settings, autoHideToolbar: true });
    await editor.mouse.move(640, 450);
    await editor.waitForFunction(() => document.querySelector('.marker-toolbar')?.dataset.collapsed === 'true');
    check(await editor.locator('.marker-toolbar').evaluate(element => element.getBoundingClientRect().bottom < 1), 'idle hides toolbar');
    await editor.mouse.move(640, 2);
    await editor.waitForFunction(() => !document.querySelector('.marker-toolbar')?.dataset.collapsed);
    check(true, 'top edge reveals toolbar');
    await editor.locator('.marker-toolbar [data-action="save"]').first().focus();
    await editor.mouse.move(640, 450);
    await editor.waitForTimeout(3200);
    check(await editor.locator('.marker-toolbar').evaluate(element => !element.dataset.collapsed), 'keyboard focus prevents hiding');
    await editor.locator('.cm-content').focus();
    await editor.locator('.marker-toolbar-more summary').click();
    await editor.mouse.move(640, 450);
    await editor.waitForTimeout(3200);
    check(await editor.locator('.marker-toolbar').evaluate(element => !element.dataset.collapsed), 'open menu prevents hiding');
    await editor.locator('.marker-toolbar-more').evaluate(element => { element.open = false; });
    await editor.locator('.cm-content').focus();
    await receive({ type: 'settings', ...settings, autoHideToolbar: false });
    await editor.waitForTimeout(3200);
    check(await editor.locator('.marker-toolbar').evaluate(element => !element.dataset.collapsed), 'switch off keeps toolbar visible');
    await receive({ type: 'settings', ...settings, autoHideToolbar: 'invalid' });
    check(await editor.locator('.marker-toolbar').evaluate(element => !element.dataset.collapsed), 'invalid setting ignored');
    return { passed: true, checks };
  } finally { await context.close(); }
}
