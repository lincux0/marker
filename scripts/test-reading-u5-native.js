// Existing Playwright MCP entry; connects only to the dedicated Marker CDP port 9222.
// Use ?nativeMode=smoke for fixture checks only, or ?nativeMode=perf&nativeUnits=2048|100000|950000 for one size.
// The host must have a disposable U5_NATIVE_FIXTURE document open, ending in U5_NATIVE_FIXTURE_TAIL.
// Edits are undone; nothing is saved. Save and clipboard byte checks are performed by the harness owner.
async (page) => {
  const browser = await page.context().browser().browserType().connectOverCDP('http://127.0.0.1:9222');
  try {
    const pages = browser.contexts().flatMap(context => context.pages());
    const editor = pages.find(candidate => candidate.url() === 'https://editor.marker.example/index.html');
    const preview = pages.find(candidate => candidate.url() === 'https://preview.marker.example/preview.html');
    if (!editor || !preview) throw new Error('Marker editor and preview are not open on the dedicated CDP instance');
    const callerParams = new URL(page.url()).searchParams;
    const editorParams = new URL(editor.url()).searchParams;
    const requestedMode = callerParams.get('nativeMode') ?? editorParams.get('nativeMode') ?? 'all';
    if (!['all', 'smoke', 'perf'].includes(requestedMode)) throw new Error(`Unsupported nativeMode=${requestedMode}`);
    const requestedUnits = callerParams.get('nativeUnits') ?? editorParams.get('nativeUnits');
    const sizes = [['short', 2048], ['100k', 100000], ['near-bridge', 950000]];
    if (requestedUnits && !sizes.some(([, units]) => String(units) === requestedUnits)) throw new Error(`Unsupported nativeUnits=${requestedUnits}`);
    const selectedSizes = requestedMode === 'smoke' ? [] : requestedUnits ? sizes.filter(([, units]) => String(units) === requestedUnits) : sizes;
    const content = editor.locator('.cm-content');
    await content.waitFor();
    const check = (ok, message) => { if (!ok) throw new Error(message); };
    check((await content.innerText()).includes('U5_NATIVE_FIXTURE'), 'Refusing to touch a document without the disposable U5_NATIVE_FIXTURE sentinel');
    const restoredTail = 'U5_NATIVE_FIXTURE_TAIL';
    const previewWaitPollingMs = 25;
    const waitPreviewTail = (tail) => preview.waitForFunction(expected => {
      const root = document.querySelector('#preview');
      if (!root) return false;
      const finalParagraph = root.querySelector(':scope > p:last-of-type');
      return finalParagraph?.textContent?.trimEnd().endsWith(expected) ?? false;
    }, tail, { timeout: 60000, polling: previewWaitPollingMs });
    await waitPreviewTail(restoredTail);
    await preview.locator('#preview .marker-math-inline .katex math').first().waitFor();

    const errors = [];
    editor.on('pageerror', error => errors.push(error.message));
    await editor.locator('.marker-math-inline .katex').first().waitFor();
    check(await editor.locator('.marker-math-block .katex').count() > 0, 'Markdig block math metadata missing');
    check(await editor.locator('.cm-md-rich-footnote-reference').count() >= 2, 'Markdig footnote metadata or repeated references missing');
    check(await editor.locator('.cm-md-alert-title').count() > 0, 'Markdig alert metadata missing');
    check(await editor.locator('.marker-mermaid-preview svg').count() > 0, 'Mermaid chart did not render in the real host');
    const code = editor.locator('.cm-md-code-line').first();
    check(await code.count() > 0, 'Code highlighting fixture missing');
    check(await code.evaluate(line => [...line.querySelectorAll('span')].some(token => getComputedStyle(token).color !== getComputedStyle(line).color)), 'Syntax tokens were not highlighted');

    await editor.getByRole('button', { name: '文档大纲', exact: true }).click();
    check(await editor.getByRole('navigation', { name: '文档大纲' }).locator('button').count() > 0, 'Native outline is empty');
    await editor.getByRole('button', { name: '关闭文档大纲', exact: true }).click();

    const makeText = (units, tag) => {
      const prefix = `# U5 ${tag}\n\n`;
      const tail = `U5_SOURCE_TAIL_${tag}`;
      const bodyUnits = units - prefix.length - tail.length - 1;
      if (bodyUnits < 0 || units > 1_000_000) throw new Error(`Invalid UTF-16 sample size: ${units}`);
      // ASCII, one paragraph: JSON stays below 2 MiB and Markdig HTML stays below its 4 MiB limit.
      const text = prefix + 'x'.repeat(bodyUnits) + ' ' + tail;
      if (text.length !== units) throw new Error(`Sample length mismatch: expected ${units}, got ${text.length}`);
      return { text, sourceTail: tail, previewTail: tail };
    };
    const nearestRankP95 = rawMs => [...rawMs].sort((a, b) => a - b)[Math.ceil(rawMs.length * 0.95) - 1];
    const samples = [];
    await editor.evaluate(mode => { window.__u5NativeResult = { mode, sizes: {}, summary: null }; }, requestedMode);
    const paste = async sample => {
      await content.click();
      await editor.keyboard.press('Control+a');
      await editor.evaluate(({ text }) => {
        window.__u5StartedAt = performance.now();
        const transfer = new DataTransfer();
        transfer.setData('text/plain', text);
        const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
        document.querySelector('.cm-content').dispatchEvent(event);
        if (!event.defaultPrevented) throw new Error('CodeMirror did not accept controlled paste');
      }, sample);
      await waitPreviewTail(sample.previewTail);
      return editor.evaluate(() => performance.now() - window.__u5StartedAt);
    };

    try {
      for (const [label, units] of selectedSizes) {
        const fullPasteSamples = [];
        for (let run = 1; run <= 3; run++) {
          const sample = makeText(units, `${label}_paste_${run}`);
          fullPasteSamples.push(await paste(sample));
          await editor.keyboard.press('Control+z');
          await waitPreviewTail(restoredTail);
        }

        const inputSample = makeText(units, `${label}_input`);
        await paste(inputSample);
        await content.click();
        await editor.keyboard.press('Control+End');
        const baseTail = inputSample.previewTail;
        const char = 'z';
        const inputMs = [];
        for (let run = 0; run < 20; run++) {
          await waitPreviewTail(baseTail);
          await editor.evaluate(() => { window.__u5StartedAt = performance.now(); });
          await editor.keyboard.insertText(char);
          await waitPreviewTail(baseTail + char);
          inputMs.push(await editor.evaluate(() => performance.now() - window.__u5StartedAt));
          await editor.keyboard.press('Control+z');
          await waitPreviewTail(baseTail);
        }
        await editor.keyboard.press('Control+z');
        await waitPreviewTail(restoredTail);
        const sampleResult = {
          label,
          utf16Units: units,
          sourceTail: inputSample.sourceTail,
          previewTail: inputSample.previewTail,
          fullReplaceAndPreview: { rawMs: fullPasteSamples, p95Ms: nearestRankP95(fullPasteSamples), sampleCount: fullPasteSamples.length },
          singleCharacterEditAndPreview: { rawMs: inputMs, p95Ms: nearestRankP95(inputMs), sampleCount: inputMs.length, char },
        };
        samples.push(sampleResult);
        await editor.evaluate(result => { window.__u5NativeResult.sizes[result.utf16Units] = result; }, sampleResult);
      }
    } finally {
      // Scroll to the start before checking the sentinel; CodeMirror virtualizes large documents.
      await content.click();
      await editor.keyboard.press('Control+Home');
      for (let undo = 0; undo < 3; undo++) {
        if ((await content.innerText()).includes('U5_NATIVE_FIXTURE')) break;
        await editor.keyboard.press('Control+z');
        await editor.keyboard.press('Control+Home');
      }
      check((await content.innerText()).includes('U5_NATIVE_FIXTURE'), 'Could not restore disposable fixture text with undo');
      await waitPreviewTail(restoredTail);
    }

    check(errors.length === 0, `WebView runtime errors: ${errors.join('; ')}`);
    const result = {
      passed: true,
      checks: ['real-Markdig-math-footnotes-alerts', 'preview-MathML', 'Mermaid-chart', 'syntax-highlighting', 'native-outline', 'undo-restored-fixture'],
      requestedMode,
      requestedNativeUnits: requestedUnits ?? 'all',
      measurements: samples,
      previewWaitPollingMs,
      timing: 'Each size has 3 controlled full-replacement samples and 20 Playwright single-character insert samples, each timed until the hidden native preview displays the matching unique suffix. Preview completion is polled every 25 ms (up to one polling interval plus CDP scheduling is included). p95 is nearest-rank over raw samples (the three-sample paste p95 is the maximum). Timings include CDP, host debounce, Markdig, and preview render; they are diagnostic and do not measure OS keyboard or IME latency. Save and clipboard byte fidelity, Narrator, and DPI are checked separately.',
    };
    await editor.evaluate(summary => { window.__u5NativeResult.summary = summary; }, result);
    return result;
  } finally {
    await browser.close();
  }
}
