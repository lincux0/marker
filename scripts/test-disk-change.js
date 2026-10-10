// Mock-native regression for the dismissible external-change notification.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1100, height: 760 } });
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
    window.chrome = { webview: { postMessage: data => window.markerTest.sent.push(data), addEventListener: (_, handler) => handlers.push(handler) } };
  });
  const editor = await context.newPage();
  const sessionId = '77777777777777777777777777777777';
  const notificationId = 'abcdef0123456789abcdef0123456789';
  const send = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
  const check = (value, message) => { if (!value) throw new Error(message); };
  const prompt = editor.locator('.marker-disk-change');
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    await send({ type: 'initialize', text: 'original' });
    await editor.locator('.cm-content').click();
    await editor.keyboard.press('Control+End');
    await editor.keyboard.insertText(' edited');
    await send({ type: 'diskChange', notificationId, busy: false });
    check(await prompt.isVisible(), 'External change did not show a prompt');
    check((await prompt.textContent()).includes('磁盘中文件已被修改，是否重新加载？'), 'Prompt wording changed');
    check(await editor.locator('.cm-content').evaluate(element => element === document.activeElement), 'Notification stole editing focus');
    await send({ type: 'initialize', text: 'ignored same-session content' });
    check(await prompt.isVisible(), 'Duplicate initialize hid the active notification');
    await send({ type: 'diskChange', notificationId: null, busy: false, extra: true });
    await send({ type: 'diskChange', notificationId: null, busy: false, sessionId: '88888888888888888888888888888888' });
    await send({ type: 'diskChange', notificationId: 'invalid', busy: false });
    check(await prompt.isVisible(), 'Malformed or stale-session notification changed UI');
    await send({ type: 'toolbarState', title: 'original.md', notification: '', busy: true });
    check(await prompt.getByRole('button', { name: '重新加载' }).isDisabled() && await prompt.getByRole('button', { name: '关闭', exact: true }).isDisabled(), 'Busy document action left notification enabled');
    await send({ type: 'toolbarState', title: 'original.md', notification: '', busy: false });
    await prompt.getByRole('button', { name: '重新加载' }).click();
    let actions = await editor.evaluate(() => window.markerTest.sent.filter(packet => packet.type === 'diskChangeAction'));
    check(actions.length === 1 && actions[0].action === 'reload' && actions[0].notificationId === notificationId && actions[0].sessionId === sessionId,
      'Reload action was not bound to current notification/session');
    check(Object.keys(actions[0]).sort().join(',') === 'action,notificationId,protocolVersion,sessionId,type', 'Reload sent extra privileges');
    await prompt.getByRole('button', { name: '关闭', exact: true }).click();
    check(await prompt.isHidden(), 'Dismiss did not close notification');
    check(await editor.locator('.cm-content').evaluate(element => element === document.activeElement), 'Dismiss did not restore editor focus');
    actions = await editor.evaluate(() => window.markerTest.sent.filter(packet => packet.type === 'diskChangeAction'));
    check(actions.length === 2 && actions[1].action === 'dismiss' && actions[1].notificationId === notificationId, 'Dismiss action lost correlation');
    await send({ type: 'requestSnapshot', requestId: 'disk-change-test' });
    const text = await editor.evaluate(() => window.markerTest.sent.findLast(packet => packet.type === 'snapshot' && packet.requestId === 'disk-change-test')?.text);
    check(text === 'original edited', 'Notification modified unsaved document text');
    await send({ type: 'diskChange', notificationId, busy: false });
    await editor.setViewportSize({ width: 320, height: 640 });
    const bounds = await prompt.boundingBox();
    check(bounds && bounds.x >= 0 && bounds.x + bounds.width <= 320, 'Notification overflowed narrow viewport');
    await send({ type: 'initialize', sessionId: '99999999999999999999999999999999', text: 'new document' });
    check(await prompt.isHidden(), 'Document switch retained old notification');
    return { passed: true, checks: 13 };
  } finally { await context.close(); }
}
