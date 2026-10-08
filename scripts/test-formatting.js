// Short formatting/source-mode regression using the current local Vite page and a mock native bridge.
async (page) => {
  const context = await page.context().browser().newContext();
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
    window.chrome = { webview: { postMessage: data => window.markerTest.sent.push(data), addEventListener: (_, handler) => handlers.push(handler) } };
  });
  const editor = await context.newPage();
  const sessionId = '55555555555555555555555555555555';
  const source = 'alpha beta\nsecond\n';
  const check = (value, message) => { if (!value) throw new Error(message); };
  let requestNumber = 0;
  const receive = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
  const snapshot = async () => {
    const requestId = `formatting-check-${++requestNumber}`;
    await receive({ type: 'requestSnapshot', requestId });
    const message = await editor.evaluate(id => window.markerTest.sent.findLast(item => item.type === 'snapshot' && item.requestId === id), requestId);
    check(message, 'Snapshot request did not return a fresh snapshot');
    return message.text;
  };
  const selectFirstLine = async () => { await editor.keyboard.press('Control+Home'); await editor.keyboard.press('Shift+End'); };
  const reset = async () => { await editor.keyboard.press('Control+a'); await editor.keyboard.insertText(source); };
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    await receive({ type: 'initialize', text: source });
    const content = editor.locator('.cm-content');
    await content.click();
    await editor.keyboard.press('Control+Home');
    await editor.keyboard.press('Shift+End');
    await editor.keyboard.press('Control+b');
    check(await snapshot() === '**alpha beta**\nsecond\n', 'Bold did not wrap the selected text');
    await editor.keyboard.press('Control+b');
    const unboldText = await snapshot();
    check(unboldText === source, `Bold toggle did not remove existing markers: ${JSON.stringify(unboldText)}`);
    await editor.keyboard.press('Control+z');
    check(await snapshot() === '**alpha beta**\nsecond\n', 'Undo did not restore the previous formatted text');
    await editor.keyboard.press('Control+z');
    check(await snapshot() === source, 'Second undo did not restore the source');

    const inlineFormats = [
      ['Control+i', '*alpha beta*\nsecond\n', 'italic'],
      ['Alt+Shift+5', '~~alpha beta~~\nsecond\n', 'strikethrough'],
      ['Control+Shift+Backquote', '`alpha beta`\nsecond\n', 'inline code'],
      ['Control+k', '[alpha beta](url)\nsecond\n', 'link'],
    ];
    for (const [shortcut, formatted, name] of inlineFormats) {
      await reset();
      await selectFirstLine();
      await editor.keyboard.press(shortcut);
      check(await snapshot() === formatted, `${name} shortcut did not format selected text`);
      await editor.keyboard.press(shortcut);
      check(await snapshot() === source, `${name} shortcut did not unwrap selected text`);
    }

    await reset();
    await editor.keyboard.press('Control+End');
    await editor.keyboard.press('Control+b');
    await editor.keyboard.insertText('X');
    check(await snapshot() === `${source}**X**`, 'Empty-selection formatting did not place typing inside its markers');

    await reset();
    await editor.keyboard.press('Control+Home');
    await editor.keyboard.press('ArrowRight');
    await editor.keyboard.press('Shift+Home');
    await editor.keyboard.press('Control+b');
    check(await snapshot() === '**a**lpha beta\nsecond\n', 'Reverse selection did not format its original text range');
    await editor.keyboard.press('Control+b');
    await editor.keyboard.insertText('Q');
    check(await snapshot() === 'Qlpha beta\nsecond\n', 'Reverse selection was not preserved when removing formatting');

    await reset();

    await editor.keyboard.press('Control+a');
    await editor.keyboard.press('Control+2');
    check(await snapshot() === '## alpha beta\n## second\n', 'Heading shortcut did not update each selected line');
    await editor.keyboard.press('Control+a');
    await editor.keyboard.press('Control+0');
    check(await snapshot() === source, 'Plain-text shortcut did not remove selected heading prefixes');

    await editor.keyboard.press('Control+Alt+m');
    const firstMode = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'sourceMode').at(-1));
    const currentVersion = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes' || message.type === 'snapshot').at(-1)?.version);
    check(firstMode?.sourceMode === true && firstMode.sessionId === sessionId && firstMode.version === currentVersion, 'Keyboard source-mode change was not sent with the current version');
    await receive({ type: 'editorCommand', command: 'toggleSource' });
    const secondMode = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'sourceMode').at(-1));
    check(secondMode?.sourceMode === false, 'Toolbar source-mode command did not synchronize its state');

    await editor.keyboard.press('Control+Home');
    await editor.evaluate(() => document.querySelector('.cm-content')?.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await editor.keyboard.press('Control+b');
    await editor.evaluate(() => document.querySelector('.cm-content')?.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));
    await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    check(await snapshot() === source, 'Formatting command changed text during the synthetic composition guard');
    return { passed: true, checks: ['bold-wrap-and-toggle', 'italic', 'strikethrough', 'inline-code', 'link', 'empty-selection-typing', 'reverse-selection-and-unwrapping', 'undo-history', 'multi-line-headings', 'plain-text', 'keyboard-source-mode', 'toolbar-source-mode-sync', 'synthetic-composition-guard'] };
  } finally { await context.close(); }
}
