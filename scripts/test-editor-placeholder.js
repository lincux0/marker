// Verify the real CodeMirror placeholder shares the first-character caret origin.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1100, height: 760 } });
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = { receive: data => handlers.forEach(handler => handler({ data })) };
    window.chrome = { webview: { postMessage: () => {}, addEventListener: (_, handler) => handlers.push(handler) } };
  });
  const editor = await context.newPage();
  const sessionId = '66666666666666666666666666666666';
  const receive = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
  const check = (value, message) => { if (!value) throw new Error(message); };
  const assertOrigin = async (fontSize, sourceMode) => {
    await receive({ type: 'settings', theme: 'light', fontSize, lineHeight: 1.5, lineWrapping: true });
    await editor.locator('.cm-content').click();
    if (sourceMode) await editor.keyboard.press('Control+Alt+m');
    const placeholder = editor.locator('.cm-placeholder');
    await placeholder.waitFor();
    const expected = await placeholder.evaluate(element => {
      const node = element.firstChild;
      if (!node) return null;
      const range = document.createRange();
      range.setStart(node, 0);
      range.setEnd(node, 1);
      const rect = range.getBoundingClientRect();
      return { left: rect.left, top: rect.top, text: element.textContent, font: getComputedStyle(element).fontFamily };
    });
    check(expected !== null, 'Placeholder text node is missing');
    check(expected.text === '写下新的想法…', 'The native CodeMirror placeholder is missing');
    await editor.locator('.cm-content').click();
    await editor.keyboard.insertText('写');
    const actual = await editor.locator('.cm-line').first().evaluate(element => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const offset = node.textContent.indexOf('写');
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset + 1);
        const rect = range.getBoundingClientRect();
        return { left: rect.left, top: rect.top };
      }
      return null;
    });
    check(actual !== null, 'Inserted character was not rendered');
    check(Math.abs(actual.left - expected.left) < 1.5 && Math.abs(actual.top - expected.top) < 1.5,
      `Placeholder and first character have different origins at ${fontSize}px/source=${sourceMode}: ${JSON.stringify({ expected, actual })}`);
    await editor.keyboard.press('Control+z');
    if (sourceMode) await editor.keyboard.press('Control+Alt+m');
    return { fontSize, sourceMode, left: expected.left, top: expected.top, font: expected.font };
  };
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    await receive({ type: 'initialize', text: '' });
    const positions = [await assertOrigin(16, false), await assertOrigin(24, false), await assertOrigin(24, true)];
    return { passed: true, positions };
  } finally { await context.close(); }
}
