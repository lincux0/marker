// Physical pointer regression on visible text after scrolling a long document.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1120, height: 760 } });
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
    window.chrome = { webview: { postMessage: data => window.markerTest.sent.push(data), addEventListener: (type, handler) => { if (type === 'message') handlers.push(handler); } } };
  });
  const editor = await context.newPage();
  const sessionId = '33333333333333333333333333333333';
  const source = Array.from({ length: 80 }, (_, index) => `## 标题目标${index}：点击定位\n\n正文目标${index}：${'这是中文正文，含有可编辑的内容和自动折行。'.repeat(9)}\n\n`).join('');
  const receive = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
  const snapshot = async () => {
    await receive({ type: 'requestSnapshot', requestId: 'pointer-check' });
    return editor.evaluate(() => window.markerTest.sent.findLast(message => message.type === 'snapshot' && message.requestId === 'pointer-check')?.text);
  };
  const settle = () => editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const results = [];
  const clickText = async label => {
    const line = editor.locator('.cm-line').filter({ hasText: label }).first();
    const point = await line.evaluate((element, label) => {
      const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
      let node;
      while ((node = walker.nextNode())) {
        const offset = node.textContent.indexOf(label);
        if (offset < 0) continue;
        const range = document.createRange();
        range.setStart(node, offset + 2);
        range.setEnd(node, offset + 3);
        const rect = range.getBoundingClientRect(), parent = element.getBoundingClientRect();
        return { x: rect.left + rect.width * .2 - parent.left, y: rect.top + rect.height / 2 - parent.top };
      }
      throw new Error('No visible target character');
    }, label);
    const background = await line.evaluate(element => getComputedStyle(element).backgroundColor);
    await line.hover({ position: point });
    if (await line.evaluate(element => getComputedStyle(element).backgroundColor) !== background) throw new Error('Hover changed text background');
    await line.click({ position: point });
    await editor.keyboard.insertText('§');
    const position = (await snapshot())?.indexOf('§') ?? -1;
    const expected = source.indexOf(label) + 2;
    results.push({ label, expected, actual: position });
    if (Math.abs(position - expected) > 1) throw new Error(`Pointer hit mismatch: ${JSON.stringify(results.at(-1))}`);
    await editor.keyboard.press('Control+z');
    if (await snapshot() !== source) throw new Error('Undo changed original Markdown');
  };
  const visibleLabel = prefix => editor.evaluate(prefix => {
    for (const line of document.querySelectorAll('.cm-line')) {
      const label = line.textContent.match(new RegExp(`${prefix}目标[0-9]+：`))?.[0];
      const rect = line.getBoundingClientRect();
      if (label && rect.top >= 10 && rect.bottom <= innerHeight - 10) return label;
    }
    return null;
  }, prefix);
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    await receive({ type: 'initialize', text: source });
    await receive({ type: 'settings', theme: 'light', fontSize: 16, lineHeight: 1.7, lineWrapping: true, reducedMotion: true, highContrast: false });
    for (const top of [0, 2000, 6000, 10000]) {
      await editor.locator('.cm-scroller').evaluate((element, top) => { element.scrollTop = top; }, top);
      await settle();
      for (const prefix of ['标题', '正文']) {
        const label = await visibleLabel(prefix);
        if (!label) throw new Error(`No visible ${prefix} at scroll ${top}`);
        await clickText(label);
      }
    }
    await editor.setViewportSize({ width: 780, height: 620 });
    await receive({ type: 'settings', theme: 'dark', fontSize: 24, lineHeight: 2, lineWrapping: true, reducedMotion: true, highContrast: false });
    await editor.locator('.cm-scroller').evaluate(element => { element.scrollTop = 0; });
    await settle();
    const label = await visibleLabel('标题');
    if (!label) throw new Error('No heading after font/viewport change');
    await clickText(label);
    return { passed: true, pointerTargets: results, resizedHeading: true, hoverUnchanged: true };
  } finally { await context.close(); }
}
