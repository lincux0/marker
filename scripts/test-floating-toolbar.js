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
      return { position: style.position, left: rect.left, width: rect.width, center: rect.left + rect.width / 2,
        blur: style.backdropFilter, logo: element.querySelector('.marker-toolbar-logo')?.getAttribute('src') };
    });
    check(surface.position === 'fixed' && surface.blur.includes('blur'), `Toolbar did not float with the glass surface: ${JSON.stringify(surface)}`);
    check(surface.logo === '/app-logo.png', 'Toolbar logo asset was not mounted');
    const settingsIcon = await editor.locator('[data-action="settings"] svg').evaluate(svg => {
      const { x, y, width, height } = [...svg.querySelectorAll('path')].map(path => path.getBBox()).reduce((box, next) => ({
        x: Math.min(box.x, next.x), y: Math.min(box.y, next.y),
        width: Math.max(box.x + box.width, next.x + next.width) - Math.min(box.x, next.x),
        height: Math.max(box.y + box.height, next.y + next.height) - Math.min(box.y, next.y),
      }));
      return { viewBox: svg.getAttribute('viewBox'), x, y, width, height };
    });
    check(settingsIcon.viewBox === '0 0 24 24' && settingsIcon.x >= 3 && settingsIcon.x <= 3.5 && settingsIcon.y >= 3 && settingsIcon.y <= 3.5 &&
      settingsIcon.x + settingsIcon.width >= 20.5 && settingsIcon.x + settingsIcon.width <= 21 && settingsIcon.y + settingsIcon.height >= 20.5 && settingsIcon.y + settingsIcon.height <= 21,
      `Settings icon is incomplete or off-center: ${JSON.stringify(settingsIcon)}`);
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
    const viewportLayouts = [];
    for (const width of [1400, 2000, 720]) {
      await editor.setViewportSize({ width, height: 720 });
      const layout = await editor.evaluate(() => {
        const bar = document.querySelector('.marker-toolbar').getBoundingClientRect();
        const paper = document.querySelector('.cm-content').getBoundingClientRect();
        const title = document.querySelector('.marker-toolbar-title');
        const actions = [...document.querySelectorAll('.marker-toolbar-actions > .marker-toolbar-button, .marker-toolbar-more summary')]
          .map(element => ({ element, rect: element.getBoundingClientRect() }))
          .filter(({ element, rect }) => getComputedStyle(element).display !== 'none' && element.getClientRects().length > 0 && rect.width > 0)
          .map(({ rect }) => ({ left: rect.left, right: rect.right }));
        return { viewport: innerWidth, bar: { left: bar.left, right: bar.right, width: bar.width },
          paper: { left: paper.left, right: paper.right, width: paper.width }, title: { scroll: title.scrollWidth, client: title.clientWidth }, actions };
      });
      const extraWidth = layout.bar.width - layout.paper.width;
      check(Math.abs((layout.bar.left + layout.bar.right) / 2 - width / 2) < 1, `Toolbar was not centered at ${width}px: ${JSON.stringify(layout)}`);
      check(extraWidth > 0 && (width > 800 ? extraWidth >= 63 && extraWidth <= 65 : extraWidth >= 20 && extraWidth <= 64),
        `Toolbar should be slightly wider than the paper at ${width}px: ${JSON.stringify(layout)}`);
      check(layout.actions.every(button => button.left >= layout.bar.left && button.right <= layout.bar.right),
        `Visible toolbar actions overflowed at ${width}px: ${JSON.stringify(layout)}`);
      viewportLayouts.push({ width, toolbar: layout.bar.width, paper: layout.paper.width });
    }

    const longTitle = `${'很长的稿件标题'.repeat(30)}.md`;
    await send({ type: 'toolbarState', title: longTitle, notification: '', busy: false });
    const titleLayout = await editor.locator('.marker-toolbar-title').evaluate(element => ({
      text: element.textContent, title: element.title, overflow: getComputedStyle(element).textOverflow,
      scroll: element.scrollWidth, client: element.clientWidth,
    }));
    check(titleLayout.text === longTitle && titleLayout.title === longTitle && titleLayout.overflow === 'ellipsis' && titleLayout.scroll > titleLayout.client,
      `Long document title was not safely truncated: ${JSON.stringify(titleLayout)}`);
    await editor.locator('[data-action="save"]').click();
    check((await commands()).at(-1)?.command === 'save', 'Toolbar save button was not usable with a long title');
    return { passed: true, viewportLayouts, checks: ['centered-paper-width', 'long-title-ellipsis', 'buttons-fit-and-work', 'floating-glass-surface', 'initial-disabled', 'safe-toolbar-state', 'length-validation', 'busy-disabled', 'history-and-focus', 'native-command-packets', 'source-mode-sync', 'responsive-overflow'] };
  } finally { await context.close(); }
}
