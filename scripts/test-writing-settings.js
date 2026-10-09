// Short settings regression for editor typography, spacing, palettes and history.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1000, height: 760 } });
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
    window.chrome = { webview: { postMessage: data => window.markerTest.sent.push(data), addEventListener: (_, handler) => handlers.push(handler) } };
  });
  const editor = await context.newPage();
  const sessionId = '55555555555555555555555555555555';
  const receive = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
  const check = (value, message) => { if (!value) throw new Error(message); };
  const longParagraph = '这是一段用于检查正文宽度、中文自动换行和字体切换的长文。'.repeat(120);
  const source = `# 字体布局回归\n\n## 第二节\n\n${longParagraph}\n\n${longParagraph}\n\n${longParagraph}`;
  const snapshot = async () => {
    await receive({ type: 'requestSnapshot', requestId: 'settings-check' });
    return editor.evaluate(() => window.markerTest.sent.findLast(message => message.type === 'snapshot' && message.requestId === 'settings-check')?.text);
  };
  const readStyles = () => editor.locator('#editor').evaluate(element => {
    const style = getComputedStyle(element);
    return {
      body: style.getPropertyValue('--editor-body-font').trim(),
      h1: style.getPropertyValue('--editor-h1-font').trim(),
      h2: style.getPropertyValue('--editor-h2-font').trim(),
      spacing: style.getPropertyValue('--editor-paragraph-spacing').trim(),
      foreground: getComputedStyle(document.documentElement).getPropertyValue('--editor-foreground').trim(),
      paper: getComputedStyle(document.documentElement).getPropertyValue('--editor-paper').trim(),
      accent: getComputedStyle(document.documentElement).getPropertyValue('--editor-accent').trim(),
      palette: document.documentElement.dataset.colorPalette,
      highContrast: document.documentElement.dataset.highContrast,
      reducedMotion: document.documentElement.dataset.reducedMotion,
    };
  });
  const assertPaperWidth = async label => {
    const dimensions = await editor.locator('.cm-content').evaluate(element => ({
      paper: element.getBoundingClientRect().width,
      viewport: element.closest('.cm-scroller').clientWidth,
      editor: element.closest('.cm-editor').clientWidth,
    }));
    check(dimensions.paper >= Math.min(700, dimensions.viewport - 80) && dimensions.editor >= 700,
      `Paper collapsed after ${label}: ${JSON.stringify(dimensions)}`);
  };
  const assertParagraphWrap = async label => {
    const layout = await editor.locator('.cm-md-paragraph').first().evaluate(element => ({
      rows: element.getBoundingClientRect().height / Number.parseFloat(getComputedStyle(element).lineHeight),
      characters: element.textContent.length,
    }));
    check(layout.characters / layout.rows > 10,
      `Long Chinese paragraph collapsed after ${label}: ${JSON.stringify(layout)}`);
  };
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    await receive({ type: 'initialize', text: source });
    await receive({ type: 'settings', theme: 'light', fontSize: 16, lineHeight: 1.6, lineWrapping: true });
    await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await assertPaperWidth('initial font settings');
    await assertParagraphWrap('initial layout');
    const defaults = await readStyles();
    check(defaults.h1.includes('SimSun') && defaults.h2.includes('SimSun') && defaults.body.includes('Segoe UI Variable Text'), 'Default typography did not apply');
    check((await editor.locator('.cm-md-h1').evaluate(element => getComputedStyle(element).fontFamily)).includes('SimSun') &&
      (await editor.locator('.cm-md-h2').evaluate(element => getComputedStyle(element).fontFamily)).includes('SimSun'), 'Heading DOM did not use the selected fonts');
    const defaultParagraphPadding = await editor.locator('.cm-md-paragraph').first().evaluate(element => Number.parseFloat(getComputedStyle(element).paddingBottom));
    check(Math.abs(defaultParagraphPadding - 8) < 0.2, `Default paragraph spacing should be 0.5em (8px), got ${defaultParagraphPadding}px`);

    await editor.locator('.cm-md-h1').click();
    await editor.keyboard.press('End');
    await editor.keyboard.insertText('!');
    await receive({ type: 'settings', theme: 'dark', fontSize: 16, lineHeight: 1.6, lineWrapping: true,
      paragraphSpacing: 0.75, bodyFont: 'dengxian', h1Font: 'song', h2Font: 'yahei', colorPalette: 'forest', reducedMotion: true, highContrast: false });
    await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(resolve)));
    await assertPaperWidth('body/H1/H2 font change');
    await assertParagraphWrap('body/H1/H2 font change');
    let chosen = await readStyles();
    check(chosen.body.includes('DengXian') && chosen.h1.includes('SimSun') && chosen.h2.includes('Microsoft YaHei UI'), 'Font options did not map to fixed stacks');
    check((await editor.locator('.cm-md-h1').evaluate(element => getComputedStyle(element).fontFamily)).includes('SimSun') &&
      (await editor.locator('.cm-md-h2').evaluate(element => getComputedStyle(element).fontFamily)).includes('Microsoft YaHei UI'), 'H1/H2 did not apply their individual DOM fonts');
    check(chosen.spacing === '0.75em' && chosen.palette === 'forest' && chosen.reducedMotion === 'true', 'Spacing, palette or reduced motion did not apply');
    const configuredParagraphPadding = await editor.locator('.cm-md-paragraph').first().evaluate(element => Number.parseFloat(getComputedStyle(element).paddingBottom));
    check(Math.abs(configuredParagraphPadding - 12) < 0.2, `0.75em paragraph spacing should be 12px, got ${configuredParagraphPadding}px`);

    await receive({ type: 'settings', theme: 'dark', fontSize: 16, lineHeight: 1.6, lineWrapping: true,
      paragraphSpacing: 0.2, bodyFont: 'serif; color:red', h1Font: 'song', h2Font: 'song', colorPalette: 'ocean', reducedMotion: false, highContrast: true });
    chosen = await readStyles();
    check(chosen.palette === 'forest' && chosen.spacing === '0.75em' && chosen.body.includes('DengXian'), 'Invalid font value partially applied settings');
    check(chosen.highContrast === 'false', 'Invalid packet changed high contrast');

    await editor.locator('.cm-content').blur();
    for (const bodyFont of ['dengxian', 'yahei', 'serif', 'system', 'dengxian']) {
      await receive({ type: 'settings', theme: 'light', fontSize: 16, lineHeight: 1.6, lineWrapping: true,
        paragraphSpacing: 0.5, bodyFont, h1Font: 'song', h2Font: 'song', colorPalette: 'lavender' });
      await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await assertPaperWidth(`repeated ${bodyFont} setting`);
      await assertParagraphWrap(`repeated ${bodyFont} setting`);
    }
    await editor.setViewportSize({ width: 720, height: 760 });
    for (const bodyFont of ['yahei', 'system', 'serif']) {
      await receive({ type: 'settings', theme: 'light', fontSize: 24, lineHeight: 2, lineWrapping: true,
        paragraphSpacing: 0.5, bodyFont, h1Font: 'song', h2Font: 'song', colorPalette: 'lavender' });
      await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      await assertPaperWidth(`narrow viewport ${bodyFont} setting`);
      await assertParagraphWrap(`narrow viewport ${bodyFont} setting`);
    }
    await editor.locator('.cm-scroller').evaluate(scroller => {
      const pressure = document.createElement('div');
      pressure.id = 'layout-pressure';
      pressure.setAttribute('aria-hidden', 'true');
      pressure.style.cssText = 'flex:0 0 75%;height:1px;pointer-events:none';
      scroller.prepend(pressure);
    });
    try {
      for (const bodyFont of ['dengxian', 'yahei', 'serif']) {
        await receive({ type: 'settings', theme: 'light', fontSize: 24, lineHeight: 2, lineWrapping: true,
          paragraphSpacing: 0.5, bodyFont, h1Font: 'song', h2Font: 'song', colorPalette: 'lavender' });
        await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        await assertPaperWidth(`75% flex sibling pressure with ${bodyFont}`);
        await assertParagraphWrap(`75% flex sibling pressure with ${bodyFont}`);
      }
    } finally {
      await editor.locator('#layout-pressure').evaluate(element => element.remove());
    }
    await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await assertPaperWidth('layout pressure removed');
    await editor.setViewportSize({ width: 1600, height: 900 });
    await receive({ type: 'settings', theme: 'light', fontSize: 12, lineHeight: 1.2, lineWrapping: true,
      paragraphSpacing: 0.5, bodyFont: 'serif', h1Font: 'yahei', h2Font: 'dengxian', colorPalette: 'lavender' });
    await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await assertPaperWidth('wide viewport font setting');
    await assertParagraphWrap('wide viewport font setting');

    await receive({ type: 'settings', theme: 'dark', fontSize: 16, lineHeight: 1.6, lineWrapping: true,
      paragraphSpacing: 1.2, bodyFont: 'system', h1Font: 'song', h2Font: 'serif', colorPalette: 'graphite', reducedMotion: true, highContrast: true });
    chosen = await readStyles();
    check(chosen.palette === 'graphite' && chosen.highContrast === 'true' && chosen.spacing === '1.2em', 'Dark palette/high-contrast settings did not apply');
    const largeParagraphPadding = await editor.locator('.cm-md-paragraph').first().evaluate(element => Number.parseFloat(getComputedStyle(element).paddingBottom));
    check(Math.abs(largeParagraphPadding - 19.2) < 0.2, `1.2em paragraph spacing should be 19.2px, got ${largeParagraphPadding}px`);
    check(chosen.paper === 'Canvas' && chosen.foreground === 'CanvasText' && chosen.accent === 'LinkText',
      `High contrast was overridden by the palette: ${JSON.stringify({ paper: chosen.paper, foreground: chosen.foreground, accent: chosen.accent })}`);
    await editor.keyboard.press('Control+z');
    check(await snapshot() === source, 'A settings update replaced the CodeMirror document or history');

    await receive({ type: 'settings', theme: 'light', fontSize: 16, lineHeight: 1.6, lineWrapping: true,
      paragraphSpacing: 4, bodyFont: 'system', h1Font: 'song', h2Font: 'song', colorPalette: 'lavender' });
    check((await readStyles()).palette === 'graphite', 'Out-of-range spacing packet partially applied');

    const preview = await context.newPage();
    await preview.goto('http://127.0.0.1:5173/preview.html');
    const sendPreview = message => preview.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
    await sendPreview({ type: 'initialize', settings: { theme: 'light', fontSize: 16, lineHeight: 1.6, lineWrapping: true, paragraphSpacing: 1.2, bodyFont: 'system', h1Font: 'song', h2Font: 'song', colorPalette: 'paper' } });
    await sendPreview({ type: 'render', version: 0, html: '<p>第一段</p><p>第二段</p>', outline: [] });
    const previewMargin = await preview.locator('#preview p').last().evaluate(element => Number.parseFloat(getComputedStyle(element).marginTop));
    check(Math.abs(previewMargin - 19.2) < 0.2, `Preview 1.2em spacing should be 19.2px, got ${previewMargin}px`);
    await sendPreview({ type: 'settings', theme: 'dark', fontSize: 16, lineHeight: 1.6, lineWrapping: true, paragraphSpacing: 1.2, bodyFont: 'system', h1Font: 'song', h2Font: 'song', colorPalette: 'graphite', highContrast: true });
    const previewColors = await preview.locator('html').evaluate(element => ({
      foreground: getComputedStyle(element).getPropertyValue('--foreground').trim(),
      paper: getComputedStyle(element).getPropertyValue('--paper').trim(),
      accent: getComputedStyle(element).getPropertyValue('--accent').trim(),
    }));
    check(previewColors.paper === 'Canvas' && previewColors.foreground === 'CanvasText' && previewColors.accent === 'Highlight',
      `Preview high contrast was overridden by the palette: ${JSON.stringify(previewColors)}`);
    return { passed: true, checks: ['legacy-settings-defaults', 'font-enum', 'heading-dom-fonts', 'long-document-layout-after-repeated-font-changes', 'narrow-and-wide-viewport-layout', 'editor-spacing-units', 'preview-spacing-units', 'fixed-palette', 'invalid-packet-atomicity', 'editor-preview-high-contrast-priority', 'history-preserved'] };
  } finally { await context.close(); }
}
