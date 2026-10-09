// Short link-action regression for the current single-page editor (mock native bridge).
async (page) => {
  const context = await page.context().browser().newContext();
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
    window.chrome = { webview: { postMessage: data => window.markerTest.sent.push(data), addEventListener: (_, handler) => handlers.push(handler) } };
  });
  const editor = await context.newPage();
  const sessionId = '44444444444444444444444444444444';
  const check = (value, message) => { if (!value) throw new Error(message); };
  const messages = () => editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'openLink'));
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    await editor.evaluate(sessionId => window.markerTest.receive({ type: 'initialize', protocolVersion: 1, sessionId,
      text: '[inline](https://example.com/a&amp;b) [id][go] <https://auto.example/> [bad](javascript:alert) [file](file:///C:/secret) [user](https://user:pass@example.com/) [local](../notes/a%20b.md)\n\n[go]: <https://ref.example/test%20path>' }), sessionId);
    const links = editor.locator('.cm-md-link');
    await links.nth(6).waitFor();
    check(await links.first().getAttribute('title') === '按ctrl并点击以访问', 'Link tooltip is missing');
    await links.first().click();
    check((await messages()).length === 0, 'A normal click opened the link instead of editing');
    for (let index = 0; index < 3; index++) await links.nth(index).click({ modifiers: ['Control'] });
    let opened = await messages();
    check(opened.length === 3 && opened[0].url === 'https://example.com/a&b' && opened[1].url === 'https://ref.example/test%20path' && opened[2].url === 'https://auto.example/', 'Link destinations did not resolve');
    check(opened.every(message => message.protocolVersion === 1 && message.sessionId === sessionId && message.version === 0), 'Link packet lost session/version');
    await links.nth(6).click({ modifiers: ['Control'] });
    opened = await messages();
    check(opened.length === 4 && opened[3].url === '../notes/a%20b.md', 'A relative local link was not forwarded');
    const box = await links.first().boundingBox();
    if (!box) throw new Error('Link bounds missing');
    await editor.keyboard.down('Control');
    await editor.mouse.move(box.x + 2, box.y + box.height / 2);
    await editor.mouse.down();
    await editor.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    await editor.mouse.up();
    await editor.keyboard.up('Control');
    check((await messages()).length === 4, 'Dragging opened a link');
    await editor.keyboard.press('Control+Alt+m');
    check(await editor.locator('.cm-md-link').count() === 0, 'Source mode retained link click actions');
    await editor.locator('.cm-content').click({ position: { x: 10, y: 10 }, modifiers: ['Control'] });
    check((await messages()).length === 4, 'Source mode opened a link');
    return { passed: true, checks: ['tooltip', 'plain-click-edits', 'ctrl-inline', 'ctrl-reference', 'ctrl-autolink', 'ctrl-local-relative', 'entity-decoding', 'versioned-packet', 'ctrl-drag-selection', 'source-mode'] };
  } finally { await context.close(); }
}
