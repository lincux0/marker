// Short web integration via the existing Playwright MCP; not a desktop/IME acceptance test.
async (page) => {
  const context = await page.context().browser().newContext();
  const editor = await context.newPage();
  const sessionId = '22222222222222222222222222222222';
  const alerts = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].map(kind => `> [!${kind}]\n> ${kind.toLowerCase()} body.`);
  const source = [
    'Repeated refs: first[^note], then again[^note].',
    '',
    '[^note]: Definition body.',
    '    Definition continuation.',
    '',
    ...alerts.flatMap((quote, index) => index ? ['', quote] : [quote]),
    '',
    '> [!UNKNOWN]',
    '> Unknown alert remains a regular quote.',
    '',
    'End ordinary paragraph.',
  ].join('\n');
  const marker = '[^note]';
  const referenceOffsets = [source.indexOf(marker), source.indexOf(marker, source.indexOf(marker) + marker.length)];
  const definitionFrom = source.indexOf('[^note]:');
  const definitionEndText = 'Definition continuation.';
  const definitionTo = source.indexOf(definitionEndText, definitionFrom) + definitionEndText.length;
  const definitionSource = source.slice(definitionFrom, definitionTo);
  const alertNodes = alerts.map((quote, index) => {
    const from = source.indexOf(quote);
    const kind = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'][index];
    const label = `[!${kind}]`;
    return { kind: 'alert', from, to: from + quote.length, text: kind, label, target: from + 2 + label.length };
  });
  const nodes = [
    ...referenceOffsets.map(from => ({ kind: 'footnote-reference', from, to: from + marker.length, text: '1', label: 'note', target: definitionFrom })),
    { kind: 'footnote-definition', from: definitionFrom, to: definitionTo, text: '1', label: 'note', target: referenceOffsets[0] },
    ...alertNodes,
  ].sort((left, right) => left.from - right.from || right.to - left.to);
  const errors = [];
  const externalRequests = [];
  const check = (value, message) => { if (!value) throw new Error(message); };
  const receive = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
  let requestId = 0;
  const snapshot = async () => {
    const id = `annotations-${++requestId}`;
    await receive({ type: 'requestSnapshot', requestId: id });
    return editor.evaluate(key => window.markerTest.sent.findLast(item => item.type === 'snapshot' && item.requestId === key)?.text, id);
  };
  const latestVersion = () => editor.evaluate(() => window.markerTest.sent.filter(item => item.type === 'changes').at(-1)?.version ?? 0);
  const inject = async version => receive({ type: 'richContent', version, nodes });

  try {
    editor.on('pageerror', error => errors.push(error.message));
    editor.on('request', request => {
      if (new URL(request.url()).origin !== 'http://127.0.0.1:5173') externalRequests.push(request.url());
    });
    await editor.addInitScript(() => {
      const handlers = [];
      window.markerTest = { sent: [], opened: [], receive: data => handlers.forEach(handler => handler({ data })) };
      window.open = (...args) => { window.markerTest.opened.push(args); return null; };
      window.chrome = { webview: {
        postMessage: data => window.markerTest.sent.push(data),
        addEventListener: (type, handler) => { if (type === 'message') handlers.push(handler); },
      } };
    });
    await editor.goto('http://127.0.0.1:5173/index.html');

    const devModuleAvailable = (await (await editor.request.get('http://127.0.0.1:5173/src/annotations.ts')).text()).includes('class AnnotationWidget');
    const widgetCheck = devModuleAvailable ? await editor.evaluate(async () => {
      const { AnnotationWidget } = await import('/src/annotations.ts');
      const root = document.createElement('div');
      let detail;
      root.addEventListener('marker-rich-navigate', event => { detail = event.detail; });
      const button = new AnnotationWidget('<img src=x onerror=alert(1)>', 24, 11).toDOM({ dom: root });
      root.append(button);
      button.click();
      return { tag: button.tagName, text: button.textContent, childCount: button.childElementCount, aria: button.getAttribute('aria-label'), detail };
    }) : null;
    if (widgetCheck) {
    check(widgetCheck.tag === 'BUTTON' && widgetCheck.childCount === 0 && widgetCheck.text === '<img src=x onerror=alert(1)>', 'Annotation label was not rendered as safe text.');
    check(widgetCheck.aria && widgetCheck.detail?.offset === 24 && widgetCheck.detail?.returnOffset === 11, 'Annotation navigation event or accessible name is incomplete.');
    }

    await receive({ type: 'initialize', text: source });
    await editor.locator('.cm-heading, .cm-line').first().waitFor();
    await editor.locator('.cm-content').click({ position: { x: 8, y: 8 } });
    await editor.keyboard.press('Control+End');
    check(await snapshot() === source, 'Markdown source changed before rich annotations were applied.');
    for (const node of nodes) {
      check(node.from >= 0 && node.to > node.from && node.to <= source.length, `Invalid range for ${node.kind}.`);
      check(source.slice(node.from, node.to).length === node.to - node.from, `Range is not exclusive for ${node.kind}.`);
    }
    check(referenceOffsets.every(from => source.slice(from, from + marker.length) === marker), 'Repeated reference offsets are incorrect.');
    check(definitionSource.startsWith('[^note]:') && definitionSource.endsWith(definitionEndText), 'Definition range does not cover the complete definition.');
    check(nodes.filter(node => node.kind === 'footnote-reference').every(node => node.text === '1' && node.label === 'note' && node.target === definitionFrom), 'Footnote reference text, label, or target is incorrect.');
    check(nodes.find(node => node.kind === 'footnote-definition')?.target === referenceOffsets[0], 'Footnote definition does not point to its first reference.');
    check(alertNodes.every(node => source.slice(node.from, node.to) === alerts[['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'].indexOf(node.text)]), 'Alert ranges do not match their quoted source.');
    check(alertNodes.every(node => node.target === node.from + 2 + node.label.length), 'Alert marker end offsets are incorrect.');

    await inject(0);
    await editor.locator('.cm-md-rich-footnote-reference.cm-md-rich-annotation').first().waitFor();
    check(await editor.locator('.cm-md-rich-footnote-reference').count() === 2, 'Footnote references are not styled as superscript annotations.');
    check(await editor.locator('.cm-md-rich-annotation').count() === 3, 'Footnote reference and definition buttons are missing.');
    const superscript = await editor.locator('.cm-md-rich-footnote-reference').first().evaluate(element => getComputedStyle(element).verticalAlign);
    check(superscript === 'super', `Footnote reference is not superscript: ${superscript}.`);
    const shownAlerts = await editor.locator('.cm-md-alert-title').allTextContents();
    check(JSON.stringify(shownAlerts) === JSON.stringify(['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION']), `Unexpected alert titles: ${shownAlerts.join(', ')}.`);
    await editor.keyboard.press('Control+End');
    check((await editor.locator('.cm-content').innerText()).includes('[!UNKNOWN]'), 'Unknown alert marker was hidden: ' + await editor.locator('.cm-content').innerText());

    await editor.locator('.cm-md-rich-annotation').nth(1).click();
    await editor.keyboard.insertText('D');
    const afterDefinitionEdit = await snapshot();
    const definitionInsertAt = definitionFrom + '[^note]: '.length;
    check(afterDefinitionEdit === source.slice(0, definitionInsertAt) + 'D' + source.slice(definitionInsertAt), 'Repeated reference did not jump to the footnote definition.');
    check(await editor.locator('.cm-md-alert-title').count() === 0, 'Editing did not invalidate stale rich annotations.');
    await editor.keyboard.press('Control+z');
    check(await snapshot() === source, 'Undo did not restore the original Markdown source.');

    const versionAfterUndo = await latestVersion();
    await editor.keyboard.press('Control+End');
    await inject(versionAfterUndo);
    await editor.locator('.cm-md-rich-annotation').nth(1).click();
    await editor.locator('.cm-md-rich-annotation').nth(2).click();
    await editor.keyboard.insertText('R');
    const afterReturnEdit = await snapshot();
    const repeatedReference = referenceOffsets[1];
    check(afterReturnEdit === source.slice(0, repeatedReference) + 'R' + source.slice(repeatedReference), 'Footnote return did not target the repeated reference that was clicked.');
    await editor.keyboard.press('Control+z');
    check(await snapshot() === source, 'Undo after returning from the definition did not restore source.');

    await inject(0);
    check(await editor.locator('.cm-md-rich-annotation').count() === 0, 'A stale richContent version was accepted.');
    check((await snapshot()) === source, 'Stale richContent changed document source.');
    const outbound = await editor.evaluate(() => ({
      openLinks: window.markerTest.sent.filter(item => item.type === 'openLink').length,
      opened: window.markerTest.opened.length,
    }));
    check(outbound.openLinks === 0 && outbound.opened === 0 && externalRequests.length === 0, 'Annotation interaction caused external navigation or a network request.');
    check(errors.length === 0, `Runtime errors: ${errors.join('; ')}`);
    return { passed: true, devWidgetUnitCheck: devModuleAvailable, checks: [...(devModuleAvailable ? ['safe-widget-label'] : []), 'exact-ast-ranges', 'repeat-footnotes', 'superscript', 'five-alert-types', 'unknown-alert-preserved', 'jump-to-definition', 'return-to-clicked-reference', 'source-and-undo', 'edit-invalidates-ranges', 'stale-version-rejected', 'no-external-navigation', 'runtime-errors'] };
  } finally {
    await context.close();
  }
}
