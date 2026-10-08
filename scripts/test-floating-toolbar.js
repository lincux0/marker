// Mock-native regression for the floating WebView toolbar and its command bridge.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1100, height: 760 } });
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
    window.chrome = { webview: { postMessage: data => window.markerTest.sent.push(data), addEventListener: (_, handler) => handlers.push(handler) } };
  });
  const editor = await context.newPage();
  const sessionId = '77777777777777777777777777777777';
  const send = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
  const check = (value, message) => { if (!value) throw new Error(message); };
  const commands = () => editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'command'));
  const snapshot = async () => {
    await send({ type: 'requestSnapshot', requestId: 'toolbar-test' });
    return editor.evaluate(() => window.markerTest.sent.findLast(message => message.type === 'snapshot' && message.requestId === 'toolbar-test')?.text);
  };
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    check(await editor.locator('.marker-toolbar-button').first().isDisabled(), 'Toolbar commands must start disabled');
    await send({ type: 'initialize', text: 'one' });
    await send({ type: 'toolbarState', title: '稿件.md', notification: '<img id="toolbar-injection">', busy: false });
    const surface = await editor.locator('.marker-toolbar').evaluate(element => {
      const style = getComputedStyle(element), rect = element.getBoundingClientRect();
      return { position: style.position, left: rect.left, blur: style.backdropFilter, logo: element.querySelector('.marker-toolbar-logo')?.getAttribute('src') };
    });
    check(surface.position === 'fixed' && surface.left >= 32 && surface.left <= 56 && surface.blur.includes('blur'),
      `Toolbar did not float with the glass surface: ${JSON.stringify(surface)}`);
    check(surface.logo === '/app-logo.png', 'Toolbar logo asset was not mounted');
    check(await editor.locator('.marker-toolbar-title').textContent() === '稿件.md', 'Document title did not update');
    check(await editor.locator('.marker-toolbar-notification').textContent() === '<img id="toolbar-injection">' && await editor.locator('#toolbar-injection').count() === 0,
      'Toolbar state was parsed as HTML');
    await send({ type: 'toolbarState', title: 'x'.repeat(4097), notification: '', busy: false });
    check(await editor.locator('.marker-toolbar-title').textContent() === '稿件.md', 'Oversized toolbar state was accepted');

    await send({ type: 'toolbarState', title: '稿件.md', notification: '', busy: true });
    check(await editor.locator('[data-action="save"]').isDisabled(), 'Busy state did not disable commands');
    await send({ type: 'toolbarState', title: '稿件.md', notification: '', busy: false });
    await editor.locator('.cm-content').click();
    await editor.keyboard.insertText('!');
    await editor.locator('[data-action="undo"]').click();
    check(await snapshot() === 'one', 'Toolbar undo did not preserve CodeMirror history');
    check(await editor.locator('.cm-content').evaluate(element => element === document.activeElement), 'Mouse toolbar command stole editor focus');

    await editor.locator('[data-action="save"]').click();
    await editor.locator('.marker-toolbar-actions > [data-action="recover"]').click();
    await editor.locator('[data-action="settings"]').click();
    const sent = await commands();
    check(sent.map(message => message.command).join(',') === 'save,recover,settings', 'Native toolbar commands were not routed in order');
    check(sent.every(message => message.sessionId === sessionId && message.protocolVersion === 1 && Object.keys(message).sort().join(',') === 'command,protocolVersion,sessionId,type'),
      'Toolbar command included an unexpected field');

    await editor.keyboard.press('Control+Alt+m');
    check(await editor.locator('[data-action="toggleSource"]').getAttribute('aria-pressed') === 'true', 'Keyboard source mode did not update toolbar state');
    await editor.locator('[data-action="toggleSource"]').click();
    check(await editor.locator('[data-action="toggleSource"]').getAttribute('aria-pressed') === 'false', 'Toolbar source mode did not return to rendered editing');

    await editor.setViewportSize({ width: 720, height: 720 });
    check(await editor.locator('.marker-toolbar-more').evaluate(element => getComputedStyle(element).display !== 'none'), 'Narrow toolbar did not expose overflow menu');
    check(await editor.locator('.marker-toolbar-actions > [data-action="recover"]').evaluate(element => getComputedStyle(element).display === 'none'), 'Narrow toolbar did not move overflow action into menu');
    return { passed: true, checks: ['floating-glass-surface', 'initial-disabled', 'safe-toolbar-state', 'length-validation', 'busy-disabled', 'history-and-focus', 'native-command-packets', 'source-mode-sync', 'responsive-overflow'] };
  } finally { await context.close(); }
}
