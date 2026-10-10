// U5 responsive, appearance, accessibility reachability, and source fidelity matrix.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
  const editor = await context.newPage();
  const sessionId = '77777777777777777777777777777777';
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const frames = () => editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const toolbarLayout = () => editor.evaluate(() => {
    const element = document.querySelector('.marker-toolbar');
    if (!element) throw new Error('Toolbar is missing.');
    const bar = element.getBoundingClientRect();
    const actions = [...element.querySelectorAll('.marker-toolbar-button:not(.marker-toolbar-menu-button), .marker-toolbar-more > summary')]
      .filter(action => !action.hidden && action.getClientRects().length > 0)
      .map(action => {
        const rect = action.getBoundingClientRect();
        return { name: action.getAttribute('aria-label') || action.title, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
    const menuActions = [...element.querySelectorAll('.marker-toolbar-menu-button')]
      .filter(action => !action.hidden && action.getClientRects().length > 0)
      .map(action => {
        const rect = action.getBoundingClientRect();
        return { name: action.getAttribute('aria-label') || action.title, left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom };
      });
    return { bar: { left: bar.left, right: bar.right, top: bar.top, bottom: bar.bottom }, actions, menuActions };
  });
  const sourceLines = [
    '# U5 阅读布局矩阵',
    '用于检查正文、工具条与目录在不同视口和外观设置下仍可阅读。',
    '中文与 English 混排，以及较长但可断行的正文内容用于观察右侧裁切。',
    '## 目录可达性',
    '大纲项目应保持可聚焦，并且导航不得改变 Markdown 源码。',
    '## 间距覆盖',
    '段落间距由设置消息控制，零间距和较大间距都不能挤压或裁切文字。',
  ];
  const source = sourceLines.join('\n\n');
  const headings = [];
  let offset = 0;
  for (const line of sourceLines) {
    if (/^#{1,6} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      const text = line.slice(level + 1);
      headings.push({ id: `u5-${headings.length + 1}`, text, level, offset });
    }
    offset += line.length + 2;
  }
  let snapshotId = 0;
  const send = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
  const snapshot = async () => {
    const requestId = `u5-${++snapshotId}`;
    await send({ type: 'requestSnapshot', requestId });
    await editor.waitForFunction(id => window.markerTest.sent.some(message => message.type === 'snapshot' && message.requestId === id), requestId);
    return editor.evaluate(id => window.markerTest.sent.findLast(message => message.type === 'snapshot' && message.requestId === id)?.text, requestId);
  };
  try {
    await context.addInitScript(() => {
      const handlers = [];
      window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
      window.chrome = { webview: {
        postMessage: data => window.markerTest.sent.push(data),
        addEventListener: (type, handler) => { if (type === 'message') handlers.push(handler); },
      } };
    });
    await editor.goto('http://127.0.0.1:5173/index.html');
    await send({ type: 'initialize', text: source });
    await editor.locator('.cm-content').waitFor();
    check(await snapshot() === source, 'Initial render changed the Markdown source.');
    await send({ type: 'outline', version: 0, headings });

    const toolbar = editor.getByRole('toolbar', { name: '文档工具栏' });
    const outlineToggle = toolbar.getByRole('button', { name: '文档大纲' }).first();
    const nav = editor.getByRole('navigation', { name: '文档大纲' });
    const palettes = ['lavender', 'forest', 'ocean', 'paper', 'graphite'];
    const themes = ['light', 'dark'];
    const fontSizes = [12, 16, 24];
    const widths = [720, 960, 1400, 2000];
    const matrix = [];

    for (const width of widths) {
      await editor.setViewportSize({ width, height: 900 });
      await frames();
      const variants = themes.flatMap(theme => palettes.flatMap(colorPalette => fontSizes.map(fontSize => ({
        theme, colorPalette, fontSize,
        paragraphSpacing: [0, 0.5, 1][fontSizes.indexOf(fontSize)], highContrast: false,
      }))));
      const applied = [];
      for (const variant of variants) {
        await send({ type: 'settings', lineHeight: 1.5, lineWrapping: true, reducedMotion: true, ...variant });
        await frames();
        const value = await editor.evaluate(variant => {
          const html = document.documentElement;
          const editorRoot = document.querySelector('#editor');
          const paper = document.querySelector('.cm-content');
          const paragraph = document.querySelector('.cm-md-paragraph');
          const paperRect = paper.getBoundingClientRect();
          const lineRects = [...document.querySelectorAll('.cm-line')].map(line => line.getBoundingClientRect());
          return { ...variant,
            themeApplied: html.dataset.theme, paletteApplied: html.dataset.colorPalette,
            highContrastApplied: html.dataset.highContrast === 'true',
            reducedMotionApplied: html.dataset.reducedMotion === 'true',
            fontSizeApplied: getComputedStyle(editorRoot).fontSize,
            fontVariableInline: editorRoot.style.getPropertyValue('--editor-font-size').trim(),
            fontVariableComputed: getComputedStyle(editorRoot).getPropertyValue('--editor-font-size').trim(),
            paragraphSpacingApplied: paragraph ? getComputedStyle(paragraph).paddingBottom : null,
            transitionDurations: [editorRoot, paragraph, document.querySelector('.marker-toolbar-button')].filter(Boolean)
              .map(element => ({ target: element.id || element.className, value: getComputedStyle(element).transitionDuration })),
            runningTransitions: editorRoot.getAnimations({ subtree: true })
              .filter(animation => animation.transitionProperty && animation.playState === 'running')
              .map(animation => ({ property: animation.transitionProperty, currentTime: animation.currentTime })),
            viewportWidth: innerWidth, documentWidth: html.scrollWidth,
            paper: { left: paperRect.left, right: paperRect.right, width: paperRect.width, clientWidth: paper.clientWidth, scrollWidth: paper.scrollWidth },
            linesInsidePaper: lineRects.every(rect => rect.left >= paperRect.left - 1 && rect.right <= paperRect.right + 1),
          };
        }, variant);
        applied.push(value);
        check(value.themeApplied === value.theme && value.paletteApplied === value.colorPalette && !value.highContrastApplied,
          `Theme or palette did not apply at ${width}px: ${JSON.stringify(value)}`);
        check(value.reducedMotionApplied && value.transitionDurations.every(item => item.value.split(',').every(duration => parseFloat(duration) === 0)) &&
          value.runningTransitions.length === 0,
        `Reduced-motion setting left a CSS transition active at ${width}px: ${JSON.stringify(value)}`);
        if (value.fontSizeApplied !== `${value.fontSize}px`) {
          throw new Error(`Font size did not apply at ${width}px; case=${JSON.stringify(value)}.`);
        }
        check(Math.abs(parseFloat(value.paragraphSpacingApplied) - value.fontSize * value.paragraphSpacing) < 0.2,
          `Paragraph spacing did not apply at ${width}px: ${JSON.stringify(value)}`);
        check(value.documentWidth <= width + 1 && value.paper.scrollWidth <= value.paper.clientWidth + 1,
          `Page or paper has horizontal overflow at ${width}px: ${JSON.stringify(value)}`);
        check(value.paper.left >= -1 && value.paper.right <= width + 1 && value.linesInsidePaper,
          `Body text is clipped by the paper at ${width}px: ${JSON.stringify(value)}`);
      }
      const toolbarMeasure = await toolbarLayout();
      check(toolbarMeasure.bar.left >= -1 && toolbarMeasure.bar.right <= width + 1 && toolbarMeasure.bar.bottom > 0 && toolbarMeasure.bar.top < 900,
        `Toolbar is outside the visible viewport at ${width}px: ${JSON.stringify(toolbarMeasure)}`);
      check(toolbarMeasure.actions.every(action => action.left >= toolbarMeasure.bar.left - 1 && action.right <= toolbarMeasure.bar.right + 1 &&
        action.left >= -1 && action.right <= width + 1 && action.top >= -1 && action.bottom <= 901),
      `Visible toolbar action is clipped or unreachable at ${width}px: ${JSON.stringify(toolbarMeasure)}`);
      if (width === 720) for (const action of ['undo', 'redo', 'find']) {
        check(await editor.locator(`.marker-toolbar-actions > .marker-toolbar-button[data-action="${action}"]`).isVisible(),
          `${action} left the direct toolbar at 720px.`);
        check(!(await editor.locator(`.marker-toolbar-menu-button[data-action="${action}"]`).isVisible()),
          `${action} moved into the more menu at 720px.`);
      }
      matrix.push(...applied.map(value => ({ viewport: width, ...value })));
      check(await snapshot() === source, `Appearance matrix changed the Markdown source at ${width}px.`);

      check(await outlineToggle.isVisible(), `Outline trigger is unavailable at ${width}px.`);
      if (!(await nav.isVisible())) await outlineToggle.click();
      const firstHeading = nav.getByRole('button', { name: 'U5 阅读布局矩阵', exact: true });
      check(await nav.isVisible() && await firstHeading.isVisible(), `Outline is not reachable at ${width}px.`);
      await firstHeading.focus();
      check(await firstHeading.evaluate(element => element === document.activeElement), `Outline item cannot receive keyboard focus at ${width}px.`);
      await firstHeading.click();
      check(await nav.isVisible() && await snapshot() === source, `Outline item could not be activated or changed the source at ${width}px.`);
      await outlineToggle.click();
      check(!(await nav.isVisible()), `Outline did not collapse at ${width}px.`);
    }

    const contrastVariants = themes.flatMap(theme => palettes.map(colorPalette => ({ theme, colorPalette, fontSize: 16 })));
    const contrastResults = [];
    for (const variant of contrastVariants) {
      await send({ type: 'settings', lineHeight: 1.5, lineWrapping: true, paragraphSpacing: 0.5,
        reducedMotion: true, highContrast: true, ...variant });
      await frames();
      contrastResults.push(await editor.evaluate(variant => ({ ...variant,
        themeApplied: document.documentElement.dataset.theme,
        paletteApplied: document.documentElement.dataset.colorPalette,
        highContrastApplied: document.documentElement.dataset.highContrast === 'true' }), variant));
    }
    for (const value of contrastResults) check(value.themeApplied === value.theme && value.paletteApplied === value.colorPalette && value.highContrastApplied,
      `High-contrast override did not apply: ${JSON.stringify(value)}`);
    check(await snapshot() === source, 'Contrast matrix changed the Markdown source.');

    await editor.setViewportSize({ width: 320, height: 900 });
    await send({ type: 'settings', theme: 'light', colorPalette: 'lavender', fontSize: 16, lineHeight: 1.5,
      lineWrapping: true, paragraphSpacing: 2, highContrast: true, reducedMotion: true });
    // A 320 CSS px viewport is the 200% zoom reflow width for a 640 CSS px desktop viewport.
    await editor.addStyleTag({ content: '#editor { font-size: 32px !important; }' });
    await frames();
    const reflow = await editor.evaluate(() => {
      const root = document.documentElement;
      const paper = document.querySelector('.cm-content');
      const toolbar = document.querySelector('.marker-toolbar').getBoundingClientRect();
      const paperRect = paper.getBoundingClientRect();
      const contentRect = document.querySelector('.cm-md-paragraph').getBoundingClientRect();
      return { width: innerWidth, documentWidth: root.scrollWidth, paper: { left: paperRect.left, right: paperRect.right, width: paperRect.width, clientWidth: paper.clientWidth, scrollWidth: paper.scrollWidth },
        toolbar: { left: toolbar.left, right: toolbar.right, top: toolbar.top, bottom: toolbar.bottom },
        text: { left: contentRect.left, right: contentRect.right, height: contentRect.height },
        fontSize: getComputedStyle(document.querySelector('#editor')).fontSize,
        theme: root.dataset.theme, palette: root.dataset.colorPalette, highContrast: root.dataset.highContrast === 'true' };
    });
    check(reflow.width === 320 && reflow.fontSize === '32px' && reflow.documentWidth <= 321 && reflow.paper.scrollWidth <= reflow.paper.clientWidth + 1,
      `320px/200% reflow has horizontal overflow: ${JSON.stringify(reflow)}`);
    check(reflow.paper.left >= -1 && reflow.paper.right <= 321 && reflow.text.left >= reflow.paper.left - 1 && reflow.text.right <= reflow.paper.right + 1 && reflow.text.height > 0,
      `Body text is clipped in 320px/200% reflow: ${JSON.stringify(reflow)}`);
    check(reflow.toolbar.left >= -1 && reflow.toolbar.right <= 321 && reflow.toolbar.bottom > 0 && reflow.toolbar.top < 900,
      `Toolbar is not visible in 320px/200% reflow: ${JSON.stringify(reflow.toolbar)}`);
    const narrowToolbar = await toolbarLayout();
    check(narrowToolbar.actions.every(action => action.left >= narrowToolbar.bar.left - 1 && action.right <= narrowToolbar.bar.right + 1 &&
      action.left >= -1 && action.right <= 321 && action.top >= -1 && action.bottom <= 901),
    `Visible toolbar action is clipped or unreachable at 320px/200%: ${JSON.stringify(narrowToolbar)}`);
    check(reflow.theme === 'light' && reflow.palette === 'lavender' && reflow.highContrast, 'Reflow override settings did not apply.');
    check(await outlineToggle.isVisible(), 'Outline trigger is unavailable at 320px/200%.');
    const outlineBounds = await outlineToggle.boundingBox();
    check(outlineBounds && outlineBounds.x >= -1 && outlineBounds.x + outlineBounds.width <= 321 && outlineBounds.y >= -1 && outlineBounds.y + outlineBounds.height <= 901,
      `Outline trigger is clipped at 320px/200%: ${JSON.stringify(outlineBounds)}`);
    check(!narrowToolbar.actions.some(action => ['撤销', '重做', '查找'].includes(action.name)),
      `Compact actions remained in the clipped direct toolbar at 320px: ${JSON.stringify(narrowToolbar.actions)}`);
    const moreSummary = toolbar.locator('.marker-toolbar-more > summary');
    const moreSummaryBounds = await moreSummary.boundingBox();
    check(await moreSummary.isVisible() && moreSummaryBounds && moreSummaryBounds.x >= -1 && moreSummaryBounds.x + moreSummaryBounds.width <= 321,
      `More-menu trigger is clipped at 320px: ${JSON.stringify(moreSummaryBounds)}`);
    await moreSummary.click();
    const compactMenu = await editor.evaluate(() => {
      const menu = document.querySelector('.marker-toolbar-more[open] .marker-toolbar-menu');
      if (!menu) return null;
      const rect = menu.getBoundingClientRect();
      const actions = [...menu.querySelectorAll('.marker-toolbar-menu-button:not([hidden])')].map(action => {
        const bounds = action.getBoundingClientRect();
        return { id: action.dataset.action, name: action.getAttribute('aria-label'), left: bounds.left, right: bounds.right,
          top: bounds.top, bottom: bounds.bottom, visible: bounds.width > 0 && bounds.height > 0 };
      });
      return { bounds: { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom }, actions };
    });
    check(compactMenu && compactMenu.bounds.left >= -1 && compactMenu.bounds.right <= 321 && compactMenu.bounds.top >= -1 && compactMenu.bounds.bottom <= 901,
      `More menu is clipped at 320px: ${JSON.stringify(compactMenu)}`);
    for (const action of ['undo', 'redo', 'find']) {
      const menuButton = editor.locator(`.marker-toolbar-more[open] .marker-toolbar-menu-button[data-action="${action}"]`);
      check(await menuButton.isVisible() && compactMenu.actions.some(item => item.id === action && item.visible && item.left >= -1 && item.right <= 321),
        `${action} is not reachable from the 320px more menu: ${JSON.stringify(compactMenu)}`);
    }
    await editor.locator('.marker-toolbar-more[open] .marker-toolbar-menu-button[data-action="find"]').click();
    check(await editor.locator('.cm-search-panel').isVisible(), 'Find action in the 320px more menu did not open search.');
    await editor.locator('.cm-search-panel').getByRole('button', { name: '关闭' }).click();
    await editor.locator('.cm-search-panel').waitFor({ state: 'hidden' });
    check(!(await editor.locator('.cm-search-panel').isVisible()), 'Search panel did not close using its close button.');
    await outlineToggle.click();
    const narrowHeading = nav.getByRole('button', { name: 'U5 阅读布局矩阵', exact: true });
    check(await nav.isVisible() && await narrowHeading.isVisible(), 'Outline is unreachable at 320px/200%.');
    await narrowHeading.click();
    check(await nav.isVisible(), 'Outline item could not be activated at 320px/200%.');
    check(await snapshot() === source, '320px/200% reflow changed the Markdown source.');

    return { passed: true, checks: ['120-theme-palette-font-viewport-cases', 'five-palettes-high-contrast-light-dark', 'paragraph-spacing-0-0.5-1-and-2em', 'toolbar-and-keyboard-outline-reachability', '320px-200-percent-equivalent-reflow', 'source-snapshot-fidelity'], matrix, contrastCases: contrastResults.length, reflow };
  } finally {
    await context.close();
  }
}
