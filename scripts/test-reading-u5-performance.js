// U5 performance-only comparison. Open the Playwright MCP runner at ?phase=baseline or ?phase=final.
// The phase is reported as a label only; it never changes setup or measurement order.
async (page) => {
  const phase = await page.evaluate(() => new URL(location.href).searchParams.get('phase')) ?? 'final';
  if (!['baseline', 'final'].includes(phase)) throw new Error('Use ?phase=baseline or ?phase=final on the Playwright MCP page.');

  const origin = await page.evaluate(() => new URL(location.href).origin);
  const browser = page.context().browser();
  const percentile = (values, fraction) => [...values].sort((a, b) => a - b)[Math.min(values.length - 1, Math.ceil(values.length * fraction) - 1)];
  const summarize = samples => ({
    p50: percentile(samples, 0.5),
    p95: percentile(samples, 0.95),
    min: Math.min(...samples),
    max: Math.max(...samples),
    samples,
  });
  const shortText = 'U0_SHORT_READY 这是短文，用于初始化和浏览器自动输入计时。';
  const paragraph = '中文 English 123 🧭 **重点** `code` 混排性能样本，保留自然段落与换行。\n\n';
  const longText = paragraph.repeat(Math.ceil(100000 / paragraph.length)).slice(0, 100000 - '\n\nU0_100K_END'.length) + '\n\nU0_100K_END';
  if (longText.length !== 100000 || !longText.includes('\n\n')) throw new Error('Long sample must be exactly 100,000 UTF-16 units and span multiple paragraphs.');

  let sessionCounter = 0;
  let snapshotCounter = 0;
  const nextSessionId = () => String(++sessionCounter).padStart(32, '0');
  const roundResults = [];

  const runDocument = async (context, name, text) => {
    const editor = await context.newPage();
    const sessionId = nextSessionId();
    await editor.goto(`${origin}/index.html`);
    const send = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
    const frames = () => editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const snapshot = async () => {
      const requestId = `u5-performance-${++snapshotCounter}`;
      await send({ type: 'requestSnapshot', requestId });
      await editor.waitForFunction(id => window.markerTest.sent.some(message => message.type === 'snapshot' && message.requestId === id), requestId);
      return editor.evaluate(id => window.markerTest.sent.findLast(message => message.type === 'snapshot' && message.requestId === id)?.text, requestId);
    };

    const initializedAt = Date.now();
    await send({ type: 'initialize', text });
    await editor.locator('.cm-content .cm-line').first().waitFor();
    await frames();
    const initializationMs = Date.now() - initializedAt;
    if (await snapshot() !== text) throw new Error(`${name} initialization changed its source.`);
    await send({
      type: 'settings', theme: 'light', fontSize: 16, lineHeight: 1.5, lineWrapping: true,
      paragraphSpacing: 0.5, colorPalette: 'lavender', highContrast: false, reducedMotion: true,
    });
    await frames();

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
    if (after !== `${'字'.repeat(20)}${text}`) throw new Error(`${name} did not retain exactly 20 inserted characters.`);
    await editor.close();
    return { name, utf16Units: text.length, initializationMs, insertedCharacters: 20, browserRoundTripWithTwoRafMs: summarize(samplesMs) };
  };

    for (let round = 1; round <= 3; round++) {
      const context = await browser.newContext({ viewport: { width: 1280, height: 1600 } });
      await context.addInitScript(() => {
        const handlers = [];
        window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
        window.chrome = { webview: {
          postMessage: data => window.markerTest.sent.push(data),
          addEventListener: (type, handler) => { if (type === 'message') handlers.push(handler); },
        } };
      });
      try {
        const short = await runDocument(context, 'short', shortText);
        const long = await runDocument(context, '100k-multiline', longText);
        roundResults.push({ round, viewport: { width: 1280, height: 1600 }, benchmarks: [short, long] });
      } finally {
        await context.close();
      }
    }

  const aggregate = ['short', '100k-multiline'].map(name => {
    const samples = roundResults.flatMap(round => round.benchmarks.find(item => item.name === name).browserRoundTripWithTwoRafMs.samples);
    const initializations = roundResults.map(round => round.benchmarks.find(item => item.name === name).initializationMs);
    return { name, sampleCount: samples.length, initializationMs: { samples: initializations, median: percentile(initializations, 0.5) }, browserRoundTripWithTwoRafMs: summarize(samples) };
  });
  return {
    passed: true,
    phase,
    fixture: 'U0 inline short and 100k multiline benchmark texts',
    rounds: roundResults,
    aggregate,
    limits: 'Each sample measures synthetic insertText plus two animation frames using Date.now(); the first input is included. Source snapshots verify the exact 20-character insertion after each document run. Results exclude physical keyboard, Windows IME, native WebView2 serialization, Markdig and disk I/O.',
  };
}
