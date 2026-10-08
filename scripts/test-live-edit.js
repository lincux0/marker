// Short web smoke via the existing Playwright MCP; not a desktop/IME acceptance test.
async (page) => {
  const context = await page.context().browser().newContext();
  const sessionId = '11111111111111111111111111111111';
  const source = '# 写作的空间\n\n在这里 **直接编辑**，也能写 `inline code`。\n\n## 今天的计划\n\n- [ ] 整理想法\n- [x] 开始写作\n\n> 留一点空间给思考。\n\n| 名称 | 状态 |\n| --- | --- |\n| Marker | 就绪 |\n\n```js\nconst marker = true;\n```\n\n![示意图片](sample.png)\n\n最后一段。';
  const errors = [];
  const check = (value, message) => { if (!value) throw new Error(message); };
  const editor = await context.newPage();
  editor.on('pageerror', error => errors.push(error.message));
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
    window.chrome = { webview: {
      postMessage: data => window.markerTest.sent.push(data),
      addEventListener: (type, handler) => { if (type === 'message') handlers.push(handler); },
    } };
  });
  const receive = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
  let counter = 0;
  const snapshot = async () => {
    const requestId = `live-${++counter}`;
    await receive({ type: 'requestSnapshot', requestId });
    return editor.evaluate(id => window.markerTest.sent.findLast(message => message.requestId === id && message.type === 'snapshot')?.text, requestId);
  };
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    await receive({ type: 'initialize', text: source });
    await editor.locator('.cm-md-heading').first().waitFor();
    check(await snapshot() === source, 'Markdown source was changed by presentation');
    const text = await editor.locator('.cm-content').innerText();
    check(!text.includes('# ') && !text.includes('**') && !text.includes('`') && !text.includes('(sample.png)'), 'Markdown markers remain visible');
    check(await editor.locator('.cm-md-table-cell').count() === 4, 'Table cells missing');
    check(await editor.locator('.cm-md-table-row').count() === 2, 'Table row layout missing');
    const firstCell = await editor.locator('.cm-md-table-cell').nth(2).boundingBox();
    const secondCell = await editor.locator('.cm-md-table-cell').nth(3).boundingBox();
    check(firstCell && secondCell && Math.abs(firstCell.y - secondCell.y) < 2, 'Table body cells are stacked');
    check(await editor.locator('.cm-md-inline-code').count() > 0, 'Inline code style missing');
    await editor.locator('.cm-md-task').first().click();
    check((await snapshot()).includes('- [x] 整理想法'), 'Task click did not update Markdown');
    await editor.keyboard.press('Control+z');
    check(await snapshot() === source, 'Task undo changed unrelated text');
    await editor.locator('.cm-md-task').first().focus();
    await editor.keyboard.press('Space');
    check((await snapshot()).includes('- [x] 整理想法'), 'Task keyboard toggle failed');
    await editor.keyboard.press('Control+z');
    check(await snapshot() === source, 'Keyboard task undo changed unrelated text');
    await editor.locator('.cm-md-heading').first().click();
    await editor.keyboard.press('End');
    await editor.keyboard.insertText(' · 可编辑');
    const edited = await snapshot();
    check(edited.startsWith('# 写作的空间 · 可编辑\n'), 'Heading click did not edit original text');
    await editor.keyboard.press('Control+z');
    check(await snapshot() === source, 'Edit undo did not retain Markdown');
    await editor.keyboard.press('Control+y');
    check(await snapshot() === edited, 'Redo failed');
    await editor.keyboard.press('Control+Alt+m');
    check((await editor.locator('.cm-content').innerText()).includes('# 写作的空间'), 'Source shortcut failed');
    await editor.keyboard.press('Control+Alt+m');
    check(!(await editor.locator('.cm-content').innerText()).includes('# 写作的空间'), 'Presentation shortcut failed');
    const beforeBackspaceVersion = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').at(-1).version);
    await receive({ type: 'revealSource', version: beforeBackspaceVersion, offset: edited.indexOf('**直接编辑**') + '**直接编辑**'.length });
    await editor.keyboard.press('Backspace');
    check((await snapshot()).includes('**直接编**'), 'Backspace damaged hidden closing markers');
    await editor.keyboard.press('Control+z');
    check(await snapshot() === edited, 'Closing-marker undo changed unrelated content');
    const version = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').at(-1).version);
    const url = `https://document.marker.example/${sessionId}/image/${'a'.repeat(48)}`;
    await editor.route('https://document.marker.example/**', route => route.fulfill({ status: 200, contentType: 'image/png', path: 'D:/marker/src/Marker.App/Assets/Square44x44Logo.png' }));
    await receive({ type: 'imageResources', version, resources: [{ source: 'sample.png', url: 'https://example.com/unsafe.png' }] });
    check(await editor.locator('.cm-md-image img').count() === 0, 'Untrusted image URL accepted');
    await receive({ type: 'imageResources', version, resources: [{ source: 'sample.png', url }] });
    await editor.locator('.cm-md-image img').waitFor();
    check(await editor.locator('.cm-md-image img').getAttribute('src') === url, 'Controlled image not displayed');
    check(await snapshot() === edited, 'Image update changed Markdown');
    await receive({ type: 'settings', theme: 'light', fontSize: 16, lineHeight: 1.7, lineWrapping: true, reducedMotion: true, highContrast: false });
    check(await editor.evaluate(() => getComputedStyle(document.querySelector('.cm-content')).animationDuration.split(',').every(value => parseFloat(value) <= 0.01)), 'Reduced motion was ignored');
    check(errors.length === 0, `Runtime errors: ${errors.join('; ')}`);
    await editor.setViewportSize({ width: 1280, height: 860 });
    await receive({ type: 'settings', theme: 'light', fontSize: 16, lineHeight: 1.7, lineWrapping: true, reducedMotion: false, highContrast: false });
    await editor.screenshot({ path: 'D:/marker/artifacts/single-editor-light.png' });
    return { passed: true, checks: ['hidden-markers', 'raw-source', 'table', 'task-toggle', 'direct-edit', 'undo-redo', 'source-shortcut', 'closing-marker-backspace', 'controlled-images', 'reduced-motion', 'runtime-errors'] };
  } finally {
    await context.close();
  }
}
