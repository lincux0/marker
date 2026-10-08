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
      text: '[inline](https://example.com/a&amp;b) [id][go] <https://auto.example/> [bad](javascript:alert) [file](file:///C:/secret) [user](https://user:pass@example.com/)\n\n[go]: <https://ref.example/test%20path>' }), sessionId);
    const links = editor.locator('.cm-md-link');
    await links.nth(5).waitFor();
    for (let index = 0; index < 3; index++) await links.nth(index).click();
    let opened = await messages();
    check(opened.length === 3 && opened[0].url === 'https://example.com/a&b' && opened[1].url === 'https://ref.example/test%20path' && opened[2].url === 'https://auto.example/', 'Link destinations did not resolve');
    check(opened.every(message => message.protocolVersion === 1 && message.sessionId === sessionId && message.version === 0), 'Link packet lost session/version');
    for (let index = 3; index < 6; index++) await links.nth(index).click();
    check((await messages()).length === 3, 'Unsafe destination was sent to native host');
    await links.first().click({ modifiers: ['Control'] });
    check((await messages()).length === 3, 'Modified click opened a link');
    const box = await links.first().boundingBox();
    if (!box) throw new Error('Link bounds missing');
    await editor.mouse.move(box.x + 2, box.y + box.height / 2);
    await editor.mouse.down();
    await editor.mouse.move(box.x + box.width - 2, box.y + box.height / 2);
    await editor.mouse.up();
    check((await messages()).length === 3, 'Dragging opened a link');
    await editor.keyboard.press('Control+Alt+m');
    check(await editor.locator('.cm-md-link').count() === 0, 'Source mode retained link click actions');
    return { passed: true, checks: ['inline', 'reference', 'autolink', 'entity-decoding', 'versioned-packet', 'unsafe-URLs', 'modified-click', 'drag-selection', 'source-mode'] };
  } finally { await context.close(); }
}
