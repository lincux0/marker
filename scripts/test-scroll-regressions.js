// Source-mode and task-checkbox scroll regressions via the existing Playwright MCP runner.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
  const editor = await context.newPage();
  const sessionId = '66666666666666666666666666666666';
  const filler = Array.from({ length: 70 }, (_, index) => `滚动填充 ${index + 1}`);
  const source = ['# 滚动回归', '', ...filler.slice(0, 32), '', '- [ ] 待办任务', ...filler.slice(32)].join('\n');
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  const frames = () => editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  try {
    await editor.addInitScript(() => {
      const handlers = [];
      window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
      window.chrome = { webview: {
        postMessage: data => window.markerTest.sent.push(data),
        addEventListener: (type, handler) => { if (type === 'message') handlers.push(handler); },
      } };
    });
    await editor.goto('http://127.0.0.1:5173/index.html');
    const receive = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
    await receive({ type: 'initialize', text: source });
    await editor.locator('.cm-md-task').waitFor();
    const scroller = editor.locator('.cm-scroller');
    const toggleSource = editor.locator('.marker-toolbar-actions > [data-action="toggleSource"]');

    // A cursor at EOF must not pull a scrolled-to-top document to EOF when the toolbar rebuilds its view.
    await editor.locator('.cm-content').focus();
    await editor.keyboard.press('Control+End');
    await scroller.evaluate(element => { element.scrollTop = 0; });
    await frames();
    await toggleSource.click();
    await editor.waitForFunction(() => document.querySelector('.cm-editor')?.dataset.sourceMode === 'true');
    const sourceTop = await scroller.evaluate(element => element.scrollTop);
    check(sourceTop < 4, `Entering code mode moved the viewport from the top: ${sourceTop}`);
    await toggleSource.click();
    await editor.waitForFunction(() => document.querySelector('.cm-editor')?.dataset.sourceMode === 'false');
    const presentationTop = await scroller.evaluate(element => element.scrollTop);
    check(presentationTop < 4, `Returning to presentation mode moved the viewport from the top: ${presentationTop}`);

    // Keep EOF selected while clicking a visible checkbox, then record even transient scroll events.
    const checkbox = editor.locator('.cm-md-task');
    await checkbox.scrollIntoViewIfNeeded();
    await frames();
    const taskScrollTop = await scroller.evaluate(element => element.scrollTop);
    await editor.locator('.cm-content').focus();
    await editor.keyboard.press('Control+End');
    const before = await scroller.evaluate((element, top) => {
      element.scrollTop = top;
      window.markerScrollSamples = [element.scrollTop];
      element.addEventListener('scroll', () => window.markerScrollSamples.push(element.scrollTop), { passive: true });
      return element.scrollTop;
    }, taskScrollTop);
    await checkbox.click();
    await editor.evaluate(() => new Promise(resolve => {
      let frames = 0;
      const sample = () => {
        window.markerScrollSamples.push(document.querySelector('.cm-scroller').scrollTop);
        if (++frames === 12) resolve(); else requestAnimationFrame(sample);
      };
      requestAnimationFrame(sample);
    }));
    const scroll = await scroller.evaluate(element => ({ top: element.scrollTop, samples: window.markerScrollSamples }));
    const checked = await checkbox.getAttribute('aria-checked');
    check(checked === 'true', 'Clicking the presentation checkbox did not check the task.');
    check(Math.max(...scroll.samples) - Math.min(...scroll.samples) < 3, `Toggling the checkbox moved the viewport: ${JSON.stringify(scroll.samples)}`);
    return { passed: true, checks: ['source-mode-preserves-viewport-at-eof-selection', 'task-checkbox-keeps-viewport'] };
  } finally {
    await context.close();
  }
}
