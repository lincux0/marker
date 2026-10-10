// U4 Mermaid checks for the isolated widget module; run via the project's Playwright MCP with Vite on 127.0.0.1:5173.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
  const testPage = await context.newPage();
  const errors = [];
  const checks = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  testPage.on('pageerror', error => errors.push(error.message));
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5173' });
    await testPage.goto('http://127.0.0.1:5173/index.html');
    await testPage.evaluate(async () => {
      const { MermaidWidget } = await import('/src/mermaid.ts');
      const lazyLoadedBeforeRender = performance.getEntriesByType('resource').some(entry => /(?:^|\/)mermaid(?:\.js|\.mjs)(?:$|[?#])/.test(entry.name));
      const root = document.createElement('div');
      root.id = 'mermaid-test-root';
      document.body.append(root);
      const sent = [];
      root.addEventListener('marker-rich-edit', event => sent.push({ type: event.type, offset: event.detail.offset }));
      root.addEventListener('marker-code-copy', event => sent.push({ type: event.type, copied: event.detail.copied }));
      window.markerMermaidTest = { root, sent, widgets: [], lazyLoadedBeforeRender };
      const fakeView = { dom: root, state: { doc: { sliceString: () => '' } }, compositionStarted: false };
      const mount = (source, from = 0, theme = 'light') => {
        const widget = new MermaidWidget(source, from, theme);
        const element = widget.toDOM(fakeView);
        root.append(element);
        window.markerMermaidTest.widgets.push({ widget, element, source });
        return element;
      };
      mount('flowchart LR\nA[Start] --> B[Finish]', 23);
      mount('sequenceDiagram\nparticipant Alice\nparticipant Bob\nAlice->>Bob: Hello', 41, 'dark');
      mount('flowchart LR\nA-->B\nstyle A fill:#f00');
      mount('flowchart LR\nA-->B; click A callback');
      mount('%%{init: {"securityLevel":"loose"}}%%\nflowchart LR\nA-->B');
      mount('flowchart LR\nA-->B[https://example.invalid/image.svg]');
      mount(`flowchart LR\n${Array.from({ length: 101 }, (_, index) => `N${index}[Node ${index}]`).join('\n')}`);
      mount('flowchart LR\nA-->B\n' + 'x'.repeat(32_769));
      mount('flowchart LR\nA-->');
      for (let index = 0; index < 6; index++) mount('flowchart LR\nQ' + index + 'A-->Q' + index + 'B');
    });
    await testPage.waitForFunction(() => document.querySelectorAll('#mermaid-test-root .cm-md-mermaid[data-rendered]').length === 15, null, { timeout: 20000 });
    const result = await testPage.evaluate(async () => {
      const root = document.querySelector('#mermaid-test-root');
      const mermaidUrl = performance.getEntriesByType('resource').find(entry => /\/node_modules\/\.vite\/deps\/mermaid\.js(?:\?|$)/.test(entry.name))?.name;
      if (!mermaidUrl) throw new Error('Vite did not expose the dynamically loaded Mermaid module URL.');
      const { default: mermaid } = await import(mermaidUrl);
      const config = mermaid.mermaidAPI.getConfig();
      const widgets = window.markerMermaidTest.widgets;
      const rendered = [...root.querySelectorAll('.cm-md-mermaid[data-rendered="true"]')];
      const fallbacks = [...root.querySelectorAll('.cm-md-mermaid[data-rendered="fallback"]')];
      const onlyLocalUrls = value => [...value.matchAll(/url\s*\(\s*([^)]*)\)/gi)].every(match => /^#[\w:.-]+$/.test(match[1].trim().replace(/^['"]|['"]$/g, '')));
      const svgSafety = [...root.querySelectorAll('.cm-md-mermaid svg')].every(svg =>
        !svg.querySelector('script,foreignObject,a,image,iframe,object,use,[onclick],[onload]') &&
        [...svg.querySelectorAll('*')].every(element => [...element.attributes].every(attribute =>
          onlyLocalUrls(attribute.value))) &&
        [...svg.querySelectorAll('style')].every(style => !/@import|https?:|data:|file:|javascript:|expression\s*\(/i.test(style.textContent) && onlyLocalUrls(style.textContent)));
      const internalMarkerRefs = [...root.querySelectorAll('.cm-md-mermaid svg *')].some(element => [...element.attributes].some(attribute => /url\(\s*#[^)]+\)/i.test(attribute.value)));
      const fallbacksPreserveSource = fallbacks.every(element => {
        const item = widgets.find(entry => entry.element === element);
        return element.querySelector('.marker-mermaid-source')?.textContent === item?.source;
      });
      const fallbackSourceAccessible = fallbacks.every(element => !element.querySelector('.marker-mermaid-source')?.closest('[role="img"]'));
      const complexityFallback = widgets.find(entry => entry.source.includes('N100'))?.element;
      await root.querySelector('.marker-mermaid-edit').click();
      const dialogOpener = rendered[0].querySelector('.marker-mermaid-open');
      dialogOpener.focus();
      dialogOpener.click();
      const dialog = document.querySelector('.marker-mermaid-dialog');
      const dialogControls = ['缩小图表', '适合窗口', '放大图表', '关闭图表查看器'].every(label => dialog.querySelector(`[aria-label="${label}"]`));
      const visibleInstructions = dialog.querySelector('.marker-mermaid-instructions')?.textContent;
      const canvas = dialog.querySelector('.marker-mermaid-canvas');
      const zoomBefore = canvas.style.transform;
      dialog.querySelector('[aria-label="放大图表"]').click();
      const zoomChanged = canvas.style.transform !== zoomBefore;
      dialog.querySelector('[aria-label="缩小图表"]').click();
      const viewport = dialog.querySelector('.marker-mermaid-viewport');
      viewport.focus();
      const keyboardZoomBefore = canvas.style.transform;
      viewport.dispatchEvent(new KeyboardEvent('keydown', { key: '+', bubbles: true }));
      const keyboardZoomChanged = canvas.style.transform !== keyboardZoomBefore;
      const keyboardPanBefore = canvas.style.transform;
      viewport.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
      const keyboardPanChanged = canvas.style.transform !== keyboardPanBefore;
      Object.defineProperty(viewport, 'setPointerCapture', { value: () => {} });
      const panBefore = canvas.style.transform;
      viewport.dispatchEvent(new PointerEvent('pointerdown', { pointerId: 1, button: 0, clientX: 10, clientY: 20 }));
      viewport.dispatchEvent(new PointerEvent('pointermove', { pointerId: 1, clientX: 30, clientY: 45 }));
      const panChanged = canvas.style.transform !== panBefore;
      viewport.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));
      return {
        rendered: rendered.length,
        fallbackCount: fallbacks.length,
        reasons: fallbacks.map(element => element.querySelector('.marker-mermaid-hint')?.textContent),
        complexityReason: complexityFallback?.querySelector('.marker-mermaid-hint')?.textContent,
        svgSafety,
        internalMarkerRefs,
        lazyLoadedBeforeRender: window.markerMermaidTest.lazyLoadedBeforeRender,
        runtimeConfig: { securityLevel: config.securityLevel, startOnLoad: config.startOnLoad, maxTextSize: config.maxTextSize, htmlLabels: config.flowchart.htmlLabels, secure: config.secure },
        fallbacksPreserveSource,
        fallbackSourceAccessible,
        editEvent: window.markerMermaidTest.sent.find(item => item.type === 'marker-rich-edit'),
        diagramButtons: rendered[0].querySelectorAll('.marker-mermaid-toolbar button').length,
        dialogControls,
        visibleInstructions,
        zoomChanged,
        panChanged,
        keyboardZoomChanged,
        keyboardPanChanged,
        expectedCopied: widgets[0].source,
        themes: rendered.map(element => element.dataset.theme),
      };
    });
    await testPage.keyboard.press('Escape');
    await testPage.waitForFunction(() => !document.querySelector('.marker-mermaid-dialog'));
    Object.assign(result, await testPage.evaluate(() => ({
      dialogRemoved: !document.querySelector('.marker-mermaid-dialog'),
      focusRestored: document.activeElement === document.querySelector('#mermaid-test-root .marker-mermaid-open'),
    })));
    await testPage.locator('#mermaid-test-root .marker-mermaid-open').nth(1).click();
    await testPage.waitForSelector('.marker-mermaid-dialog[open]');
    Object.assign(result, await testPage.evaluate(async () => {
      const entry = window.markerMermaidTest.widgets[1];
      const dialog = document.querySelector('.marker-mermaid-dialog');
      const closed = new Promise(resolve => dialog.addEventListener('close', resolve, { once: true }));
      entry.element.remove();
      entry.widget.destroy(entry.element);
      await closed;
      return { destroyClosedDialog: !document.querySelector('.marker-mermaid-dialog') };
    }));
    await testPage.locator('#mermaid-test-root .marker-mermaid-copy').first().click();
    await testPage.waitForFunction(() => window.markerMermaidTest.sent.some(item => item.type === 'marker-code-copy'));
    Object.assign(result, await testPage.evaluate(async () => ({
      copied: (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'),
      copiedEvent: window.markerMermaidTest.sent.find(item => item.type === 'marker-code-copy'),
    })));
    check(result.rendered >= 2, `Expected flowchart and sequence diagram rendering, got ${JSON.stringify(result)}`);
    check(result.svgSafety, 'Rendered SVG includes a forbidden active element, event attribute, or external URL.');
    check(result.internalMarkerRefs, 'Mermaid internal SVG marker references were not retained.');
    check(!result.lazyLoadedBeforeRender, 'Mermaid runtime loaded before a diagram needed rendering.');
    check(result.runtimeConfig.securityLevel === 'strict' && result.runtimeConfig.startOnLoad === false && result.runtimeConfig.maxTextSize === 32768 && result.runtimeConfig.htmlLabels === false &&
      ['secure', 'securityLevel', 'startOnLoad', 'maxTextSize', 'theme', 'flowchart'].every(key => result.runtimeConfig.secure.includes(key)),
      `Mermaid security configuration is incomplete: ${JSON.stringify(result.runtimeConfig)}`);
    check(result.fallbackCount >= 7 && result.fallbacksPreserveSource && result.fallbackSourceAccessible, 'Unsupported, unsafe, malformed, oversized, or complex Mermaid source was not preserved accessibly in fallback.');
    check(result.reasons.some(reason => reason.includes('自定义样式')) && result.reasons.some(reason => reason.includes('指令')) && result.reasons.some(reason => reason.includes('外部资源')) && result.reasons.some(reason => reason.includes('32,768')),
      `Expected explicit fallback reasons were missing: ${JSON.stringify(result.reasons)}`);
    check(result.complexityReason?.includes('节点或连线') || result.complexityReason?.includes('词元'), `The complex graph did not hit a complexity limit: ${result.complexityReason}`);
    check(result.editEvent?.offset === 23, `Edit event did not preserve the block offset: ${JSON.stringify(result.editEvent)}`);
    check(result.dialogControls && result.zoomChanged && result.panChanged && result.keyboardZoomChanged && result.keyboardPanChanged && result.dialogRemoved && result.focusRestored && result.destroyClosedDialog && result.visibleInstructions?.includes('Esc'),
      `Dialog zoom/pan, keyboard, instructions, close cleanup, focus restoration, or widget destruction failed: ${JSON.stringify({ dialogControls: result.dialogControls, zoomChanged: result.zoomChanged, panChanged: result.panChanged, keyboardZoomChanged: result.keyboardZoomChanged, keyboardPanChanged: result.keyboardPanChanged, dialogRemoved: result.dialogRemoved, focusRestored: result.focusRestored, destroyClosedDialog: result.destroyClosedDialog, visibleInstructions: result.visibleInstructions })}`);
    check(result.copied === result.expectedCopied && result.copiedEvent?.copied === true,
      `Copy source changed or failed to report success: ${JSON.stringify({ copied: result.copied, expected: result.expectedCopied, event: result.copiedEvent })}`);
    check(result.themes.includes('light') && result.themes.includes('dark'), `Theme was not carried into widgets: ${JSON.stringify(result.themes)}`);
    check(errors.length === 0, `Browser runtime errors: ${errors.join('; ')}`);
    checks.push('flowchart-sequence-strict-svg-sanitization', 'unsupported-security-and-complexity-full-source-fallback', 'rich-edit-offset-and-source-copy', 'dialog-zoom-pan-keyboard-esc-focus-destroy-and-theme');
    return { passed: true, checks, ...result, runtimeErrors: errors };
  } finally {
    await context.close();
  }
}
