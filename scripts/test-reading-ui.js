// U0 baseline/final comparison via the existing Playwright MCP filename runner.
// Open the MCP page at ?phase=baseline or ?phase=final; use the production Vite preview on 127.0.0.1:5173.
async (page) => {
  const phase = await page.evaluate(() => new URL(location.href).searchParams.get('phase')) ?? 'final';
  if (!['baseline', 'final'].includes(phase)) throw new Error('Use ?phase=baseline or ?phase=final on the Playwright MCP page.');
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 1600 } });
  const editor = await context.newPage();
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
  let sessionCounter = 0;
  let sessionId = '';
  let snapshotCounter = 0;
  const nextSession = () => sessionId = String(++sessionCounter).padStart(32, '0');
  const frames = () => editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    const fixture = (await (await editor.request.get('http://127.0.0.1:5173/u0-reading.md')).text()).replace(/\r\n/g, '\n');
    await editor.addInitScript(() => {
      const handlers = [];
      window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
      window.chrome = { webview: {
        postMessage: data => window.markerTest.sent.push(data),
        addEventListener: (type, handler) => { if (type === 'message') handlers.push(handler); },
      } };
    });
    await editor.goto('http://127.0.0.1:5173/index.html');
    const send = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
    const initialize = async text => {
      nextSession();
      const started = Date.now();
      await send({ type: 'initialize', text });
      await editor.locator('.cm-content .cm-line').first().waitFor();
      await frames();
      return Date.now() - started;
    };
    const snapshot = async () => {
      const requestId = `reading-ui-${++snapshotCounter}`;
      await send({ type: 'requestSnapshot', requestId });
      await editor.waitForFunction(id => window.markerTest.sent.some(message => message.type === 'snapshot' && message.requestId === id), requestId);
      return editor.evaluate(id => window.markerTest.sent.findLast(message => message.type === 'snapshot' && message.requestId === id)?.text, requestId);
    };
    const setSettings = settings => send({ type: 'settings', ...settings });

    const fixtureInitializationMs = await initialize(fixture);
    check(await editor.locator('.cm-md-heading').count() === 6, 'Expected all six heading levels in the sample.');
    check(await editor.locator('.cm-md-inline-code').count() >= 2, 'Inline code was not decorated.');
    check(await editor.locator('.cm-md-list').count() >= 10, 'List and ordered-number boundaries were not decorated.');
    check(await editor.locator('.cm-md-quote').count() >= 5, 'Quote lines were not decorated.');
    check(await editor.locator('.cm-md-link').count() >= 1, 'Markdown links were not decorated.');
    check(await snapshot() === fixture, 'Rendered presentation changed the Markdown fixture.');
    await setSettings({ theme: 'light', fontSize: 16, lineHeight: 1.5, lineWrapping: true, paragraphSpacing: 0.5, colorPalette: 'lavender', highContrast: false });
    await frames();
    const layout = await editor.evaluate(() => {
      const content = document.querySelector('.cm-content');
      const heading = document.querySelector('.cm-md-h1');
      const paragraph = document.querySelector('.cm-md-paragraph');
      const quote = document.querySelector('.cm-md-quote');
      const rect = element => { const value = element.getBoundingClientRect(); return { x: value.x, y: value.y, width: value.width, height: value.height }; };
      return {
        viewport: { width: innerWidth, height: innerHeight },
        content: { ...rect(content), fontSize: getComputedStyle(content).fontSize, lineHeight: getComputedStyle(content).lineHeight },
        defaultSettings: {
          fontSize: getComputedStyle(document.querySelector('#editor')).fontSize,
          lineHeight: getComputedStyle(document.querySelector('#editor')).getPropertyValue('--editor-line-height').trim(),
          paragraphSpacing: getComputedStyle(document.querySelector('#editor')).getPropertyValue('--editor-paragraph-spacing').trim(),
        },
        heading: { ...rect(heading), fontSize: getComputedStyle(heading).fontSize, lineHeight: getComputedStyle(heading).lineHeight },
        paragraph: paragraph ? { ...rect(paragraph), paddingBottom: getComputedStyle(paragraph).paddingBottom } : null,
        quote: quote ? { ...rect(quote), padding: getComputedStyle(quote).padding, borderLeft: getComputedStyle(quote).borderLeftWidth } : null,
        renderedLines: document.querySelectorAll('.cm-line').length,
      };
    });
    check(layout.defaultSettings.fontSize === '16px' && layout.defaultSettings.lineHeight === '1.5' && layout.defaultSettings.paragraphSpacing === '0.5em',
      `Existing default typography changed: ${JSON.stringify(layout.defaultSettings)}`);
    const screenshot = `D:/marker/artifacts/reading-ui-${phase}.png`;
    await editor.screenshot({ path: screenshot, fullPage: true });

    const widths = [];
    const matrix = [];
    const viewportWidths = [720, 960, 1400, 2000];
    const fontSizes = [12, 16, 24];
    const palettes = ['lavender', 'forest', 'ocean', 'paper', 'graphite'];
    for (const width of viewportWidths) {
      await editor.setViewportSize({ width, height: 900 });
      await frames();
      const baseWidth = await editor.locator('.cm-content').evaluate(element => element.getBoundingClientRect().width);
      check(baseWidth > 0 && baseWidth <= width, `Paper width escaped the ${width}px viewport: ${baseWidth}`);
      if (width >= 1400) check(Math.abs(baseWidth - 980) < 1, `Expected the preserved 980px paper width at ${width}px, got ${baseWidth}px.`);
      widths.push({ viewport: width, paperWidth: baseWidth });
      const variants = fontSizes.map(fontSize => ({ fontSize, theme: 'light', colorPalette: 'lavender', highContrast: false }));
      const observed = await editor.evaluate(async ({ variants, sessionId }) => {
        const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
        const result = [];
        for (const variant of variants) {
          window.markerTest.receive({ protocolVersion: 1, type: 'settings', sessionId, lineHeight: 1.5, lineWrapping: true, paragraphSpacing: 0.5, ...variant });
          await frame();
          const paper = document.querySelector('.cm-content');
          result.push({ ...variant, paperWidth: paper.getBoundingClientRect().width,
            fontSizePx: getComputedStyle(document.querySelector('#editor')).fontSize,
            themeApplied: document.documentElement.dataset.theme,
            paletteApplied: document.documentElement.dataset.colorPalette,
            highContrastApplied: document.documentElement.dataset.highContrast === 'true' });
        }
        return result;
      }, { variants, sessionId });
      for (const value of observed) {
        check(Math.abs(value.paperWidth - baseWidth) < 1, `Typography or color settings changed paper width at ${width}px: ${JSON.stringify(value)}`);
        check(value.fontSizePx === `${value.fontSize}px`, `Font size ${value.fontSize}px was not applied.`);
        check(value.themeApplied === value.theme && value.paletteApplied === value.colorPalette && !value.highContrastApplied,
          `Typography matrix setting was not applied: ${JSON.stringify(value)}`);
      }
      matrix.push(...observed.map(value => ({ viewport: width, ...value })));
    }
    await editor.setViewportSize({ width: 1280, height: 900 });
    const paletteVariants = ['light', 'dark'].flatMap(theme => palettes.map(colorPalette => ({ theme, colorPalette, fontSize: 16, highContrast: false })));
    const paletteResults = await editor.evaluate(async ({ variants, sessionId }) => {
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const result = [];
      for (const variant of variants) {
        window.markerTest.receive({ protocolVersion: 1, type: 'settings', sessionId, lineHeight: 1.5, lineWrapping: true, paragraphSpacing: 0.5, ...variant });
        await frame();
        const paper = document.querySelector('.cm-content');
        result.push({ ...variant, paperWidth: paper.getBoundingClientRect().width,
          themeApplied: document.documentElement.dataset.theme, paletteApplied: document.documentElement.dataset.colorPalette,
          highContrastApplied: document.documentElement.dataset.highContrast === 'true' });
      }
      return result;
    }, { variants: paletteVariants, sessionId });
    for (const value of paletteResults) {
      check(value.themeApplied === value.theme && value.paletteApplied === value.colorPalette && !value.highContrastApplied,
        `Palette matrix setting was not applied: ${JSON.stringify(value)}`);
      check(Math.abs(value.paperWidth - 980) < 1, `Palette changed the wide paper width: ${JSON.stringify(value)}`);
    }
    matrix.push(...paletteResults.map(value => ({ viewport: 1280, ...value })));
    const contrastVariants = ['light', 'dark'].map(theme => ({ theme, colorPalette: 'lavender', fontSize: 16, highContrast: true }));
    const contrastResults = await editor.evaluate(async ({ variants, sessionId }) => {
      const frame = () => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
      const result = [];
      for (const variant of variants) {
        window.markerTest.receive({ protocolVersion: 1, type: 'settings', sessionId, lineHeight: 1.5, lineWrapping: true, paragraphSpacing: 0.5, ...variant });
        await frame();
        result.push({ ...variant, themeApplied: document.documentElement.dataset.theme,
          highContrastApplied: document.documentElement.dataset.highContrast === 'true' });
      }
      return result;
    }, { variants: contrastVariants, sessionId });
    for (const value of contrastResults) check(value.themeApplied === value.theme && value.highContrastApplied,
      `High contrast setting was not applied: ${JSON.stringify(value)}`);
    matrix.push(...contrastResults.map(value => ({ viewport: 1280, ...value })));
    check(matrix.length === 24, `Expected 24 focused viewport/typography/palette/contrast cases, got ${matrix.length}.`);

    await setSettings({ theme: 'light', fontSize: 16, lineHeight: 1.5, lineWrapping: true, paragraphSpacing: 0.5, colorPalette: 'lavender', highContrast: false });
    await frames();
    const shortText = 'U0_SHORT_READY 这是短文，用于初始化和浏览器自动输入计时。';
    const paragraph = '中文 English 123 🧭 **重点** `code` 混排性能样本，保留自然段落与换行。\n\n';
    const longText = paragraph.repeat(Math.ceil(100000 / paragraph.length)).slice(0, 100000 - '\n\nU0_100K_END'.length) + '\n\nU0_100K_END';
    check(longText.length === 100000 && longText.includes('\n\n'), 'Long sample must be exactly 100,000 UTF-16 units and span multiple paragraphs.');
    const typeAndMeasure = async (name, text) => {
      const initializationMs = await initialize(text);
      const before = await snapshot();
      check(before === text, `${name} initialization changed the source text.`);
      const content = editor.locator('.cm-content');
      await content.click();
      await editor.keyboard.press('Control+Home');
      await editor.keyboard.press('Home');
      const samplesMs = [];
      for (let index = 0; index < 20; index++) {
        const started = Date.now();
        await editor.keyboard.insertText('字');
        await frames();
        samplesMs.push(Date.now() - started);
      }
      const after = await snapshot();
      check(after === `${'字'.repeat(20)}${text}`, `${name} did not retain exactly 20 inserted characters.`);
      return { name, utf16Units: text.length, initializationMs, insertedCharacters: 20,
        browserRoundTripWithTwoRafMs: { p50: percentile(samplesMs, 0.5), p95: percentile(samplesMs, 0.95), min: Math.min(...samplesMs), max: Math.max(...samplesMs), samples: samplesMs } };
    };
    const benchmarks = [
      await typeAndMeasure('short', shortText),
      await typeAndMeasure('100k-multiline', longText),
    ];
    const result = {
      passed: true, phase, fixture: 'docs/samples/u0-reading.md', screenshot, layout, fixtureInitializationMs, paperWidths: widths, visualMatrix: matrix, benchmarks,
      limits: 'Input timings measure Playwright browser automation round-trip plus two animation frames. insertText is synthetic browser input; results exclude physical keyboard, Windows IME, native WebView2 serialization, Markdig and disk I/O.',
    };
    const jsonPath = `D:/marker/artifacts/reading-ui-${phase}.json`;
    const downloadReady = editor.waitForEvent('download');
    await editor.evaluate(({ filename, content }) => {
      const link = document.createElement('a');
      link.href = URL.createObjectURL(new Blob([content], { type: 'application/json' }));
      link.download = filename;
      link.click();
      setTimeout(() => URL.revokeObjectURL(link.href), 1000);
    }, { filename: `reading-ui-${phase}.json`, content: JSON.stringify(result, null, 2) });
    const download = await downloadReady;
    await download.saveAs(jsonPath);
    return result;
  } finally {
    await context.close();
  }
}
