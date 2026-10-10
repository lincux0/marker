// U5 source selection regression; run through the existing Playwright MCP async(page) entry.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
  const editor = await context.newPage();
  const sessionId = '55555555555555555555555555555555';
  const checks = [];
  let snapshotCounter = 0;
  const imageLine = '![U5 image alt](u5-selection-image.png)';
  const fixture = [
    '# U5 source selection', '',
    '```text', 'U5_PREVIOUS_CODE_LINE', '```', '',
    ...Array.from({ length: 32 }, (_, index) => `U5_SCROLL_FILLER_${String(index + 1).padStart(2, '0')}`),
    imageLine, '',
    '| A | B | C |', '| --- | --- | --- |', '| x |  | y |', '|  |  |  |',
  ].join('\n');
  const check = (ok, message) => { if (!ok) throw new Error(message); };
  let send;
  const frames = () => editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const readClipboard = () => editor.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'));
  const toggleByHotkey = async () => {
    await editor.locator('.cm-content').focus();
    await editor.keyboard.press('Control+Alt+m');
  };
  const toggleByHost = async () => send({ type: 'editorCommand', command: 'toggleSource' });
  const scrollInfo = () => editor.evaluate(() => {
    const scroller = document.querySelector('.cm-scroller');
    return scroller && { top: scroller.scrollTop, height: scroller.scrollHeight, clientHeight: scroller.clientHeight };
  });
  let stage = 'setup';
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5173' });
    await context.addInitScript(() => {
      const handlers = [];
      window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
      window.chrome = { webview: {
        postMessage: data => window.markerTest.sent.push(data),
        addEventListener: (type, handler) => { if (type === 'message') handlers.push(handler); },
      } };
    });
    await editor.goto('http://127.0.0.1:5173/index.html');
    send = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
    const snapshot = async () => {
      const requestId = `u5-selection-${++snapshotCounter}`;
      await send({ type: 'requestSnapshot', requestId });
      await editor.waitForFunction(id => window.markerTest.sent.some(message => message.type === 'snapshot' && message.requestId === id), requestId);
      return editor.evaluate(id => window.markerTest.sent.findLast(message => message.type === 'snapshot' && message.requestId === id)?.text, requestId);
    };
    await send({ type: 'initialize', text: fixture });
    await editor.locator('.cm-content').waitFor();
    check(await snapshot() === fixture, 'Initial rendered content changed the Markdown fixture.');

    const settings = [
      { theme: 'light', fontSize: 16, lineHeight: 1.5, paragraphSpacing: 0.5, highContrast: false },
      { theme: 'dark', fontSize: 20, lineHeight: 1.7, paragraphSpacing: 0.75, highContrast: false },
      { theme: 'light', fontSize: 18, lineHeight: 1.6, paragraphSpacing: 0.6, highContrast: true },
    ];
    const appearance = settings[0];
    await send({ type: 'settings', ...appearance, lineWrapping: true, reducedMotion: true, colorPalette: 'lavender' });
    await frames();

    // Edits on both sides of a source-mode round trip must remain in the same undo history.
    stage = 'edit before toggle and preserve undo history';
    await editor.locator('.cm-content').click();
    await editor.keyboard.press('Control+End');
    await editor.keyboard.insertText('\nU5_PRE_TOGGLE_EDIT');
    const preToggleEdit = `${fixture}\nU5_PRE_TOGGLE_EDIT`;
    check(await snapshot() === preToggleEdit, 'Pre-toggle edit did not reach the Markdown snapshot.');
    await toggleByHotkey();
    await editor.waitForFunction(() => document.querySelector('.cm-editor')?.dataset.sourceMode === 'true');
    await toggleByHost();
    await editor.waitForFunction(() => document.querySelector('.cm-editor')?.dataset.sourceMode === 'false');
    check(await snapshot() === preToggleEdit, 'Source-mode round trip changed the pre-toggle edit.');
    await editor.locator('.cm-content').focus();
    await editor.keyboard.press('Control+z');
    check(await snapshot() === fixture, 'Undo after source-mode round trip did not restore the original fixture.');

    await toggleByHost();
    await editor.waitForFunction(() => document.querySelector('.cm-editor')?.dataset.sourceMode === 'true');
    await editor.keyboard.press('Control+End');
    await editor.keyboard.insertText('\nU5_POST_TOGGLE_EDIT');
    const postToggleEdit = `${fixture}\nU5_POST_TOGGLE_EDIT`;
    check(await snapshot() === postToggleEdit, 'Post-toggle edit did not reach the Markdown snapshot.');
    await toggleByHotkey();
    await editor.waitForFunction(() => document.querySelector('.cm-editor')?.dataset.sourceMode === 'false');
    await editor.locator('.cm-content').focus();
    await editor.keyboard.press('Control+z');
    check(await snapshot() === fixture, 'Undo after a source-mode edit did not restore the original fixture.');
    checks.push('source-round-trip-preserves-edit-and-undo-history');

    const readFailureGeometry = (x, y) => editor.evaluate(({ x, y, expectedLine }) => {
      const root = document.querySelector('.cm-editor');
      const content = document.querySelector('.cm-content');
      const view = content?.cmTile?.root?.view;
      if (!view) return { unavailable: 'CodeMirror view not found' };
      const from = view.state.doc.toString().indexOf(expectedLine);
      const line = from < 0 ? null : view.state.doc.lineAt(from);
      const selection = view.state.selection.main;
      const domLine = [...document.querySelectorAll('.cm-line')].find(element => element.textContent === expectedLine);
      const rect = domLine?.getBoundingClientRect();
      return {
        sourceMode: root?.dataset.sourceMode,
        focused: root?.classList.contains('cm-focused'),
        clicked: { x, y, posAtCoords: view.posAtCoords({ x, y }) },
        expectedLine: line && { from: line.from, to: line.to, coordsAtStart: view.coordsAtPos(line.from), coordsAtEnd: view.coordsAtPos(line.to) },
        selection: { anchor: selection.anchor, head: selection.head, from: selection.from, to: selection.to },
        selectedLine: view.state.doc.lineAt(selection.head).text,
        geometry: {
          documentTop: view.documentTop,
          domLine: rect?.toJSON(),
          lineBlockAtExpected: line && view.lineBlockAt(line.from),
          lineBlockAtClick: view.lineBlockAt(view.posAtCoords({ x, y }) ?? selection.head),
          scrollTop: document.querySelector('.cm-scroller')?.scrollTop,
        },
      };
    }, { x, y, expectedLine: imageLine });

    for (let attempt = 0; attempt < 12; attempt++) {
      const appearance = settings[attempt % settings.length];
      stage = `iteration ${attempt + 1}: settings and source toggle`;
      await send({ type: 'settings', ...appearance, lineWrapping: true, reducedMotion: true, colorPalette: 'lavender' });
      await frames();
      const enter = attempt % 2 === 0 ? toggleByHotkey : toggleByHost;
      const leave = attempt % 2 === 0 ? toggleByHost : toggleByHotkey;
      await enter();
      await editor.waitForFunction(() => document.querySelector('.cm-editor')?.dataset.sourceMode === 'true');

      const scroller = editor.locator('.cm-scroller');
      await scroller.evaluate(element => { element.scrollTop = Math.floor((element.scrollHeight - element.clientHeight) * 0.7); });
      await frames();
      const target = editor.locator('.cm-line').filter({ hasText: imageLine });
      const matches = await target.count();
      const targetInfo = matches === 1 ? await target.evaluate(element => {
        const rect = element.getBoundingClientRect();
        return { text: element.textContent, visible: rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.top < innerHeight, rect: rect.toJSON() };
      }) : null;
      if (matches !== 1 || targetInfo?.text !== imageLine || !targetInfo.visible) {
        return { passed: false, classification: 'test-targeting', attempt: attempt + 1, matches, targetInfo, scroll: await scrollInfo(), note: 'Could not identify exactly one visible source line; this does not establish a product selection failure.' };
      }

      const clickPoint = await target.evaluate(element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode()) && !node.textContent.includes('u5-selection-image.png')) { }
        if (!node) return null;
        const start = node.textContent.indexOf('u5-selection-image.png');
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + 'u5-selection-image.png'.length);
        const rect = range.getBoundingClientRect();
        return rect.width && rect.height ? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, textRect: rect.toJSON() } : null;
      });
      if (!clickPoint) return { passed: false, classification: 'test-targeting', attempt: attempt + 1, targetInfo, note: 'The fixture filename has no measurable text range.' };
      const position = { x: clickPoint.x - targetInfo.rect.x, y: clickPoint.y - targetInfo.rect.y };
      const sourceScroll = await scrollInfo();

      stage = `iteration ${attempt + 1}: Home+Shift+End`;
      await target.click({ position });
      await editor.keyboard.press('Home');
      await editor.keyboard.press('Shift+End');
      await editor.keyboard.press('Control+c');
      const selected = await readClipboard();
      if (selected !== imageLine) {
        return { passed: false, classification: 'product-selection', attempt: attempt + 1, method: 'Home+Shift+End', selected, expected: imageLine, targetInfo, clickPoint, geometry: await readFailureGeometry(clickPoint.x, clickPoint.y), note: 'The exact visible source line was targeted, but the keyboard selection copied different text.' };
      }

      stage = `iteration ${attempt + 1}: triple-click`;
      await target.click({ position, clickCount: 3, delay: 60 });
      await editor.keyboard.press('Control+c');
      const tripleSelected = await readClipboard();
      if (tripleSelected !== imageLine && tripleSelected !== `${imageLine}\n`) {
        return { passed: false, classification: 'product-selection', attempt: attempt + 1, method: 'triple-click', selected: tripleSelected, expected: imageLine, targetInfo, clickPoint, geometry: await readFailureGeometry(clickPoint.x, clickPoint.y), note: 'The exact visible source line was triple-clicked, but the copied selection differs.' };
      }

      stage = `iteration ${attempt + 1}: toggle out and verify source/scroll`;
      await leave();
      await editor.waitForFunction(() => document.querySelector('.cm-editor')?.dataset.sourceMode === 'false');
      const afterToggleScroll = await scrollInfo();
      check(afterToggleScroll && afterToggleScroll.top > 0 && Math.abs(afterToggleScroll.top - sourceScroll.top) < sourceScroll.clientHeight,
        `Toggle lost the scrolled document position: before=${JSON.stringify(sourceScroll)}, after=${JSON.stringify(afterToggleScroll)}`);
      check(await snapshot() === fixture, `Selection check ${attempt + 1} changed the Markdown fixture.`);
      checks.push(`iteration-${attempt + 1}-${appearance.theme}-${appearance.fontSize}-${attempt % 2 === 0 ? 'hotkey-enter-host-exit' : 'host-enter-hotkey-exit'}`);
    }
    return { passed: true, checks, fixture: 'image source line preceded by a fenced code block and scroll filler, followed by empty table cells', note: 'A pass means this run did not reproduce the intermittent selection issue; it does not prove the issue is fixed.' };
  } catch (error) {
    throw new Error(`U5 selection stage "${stage}": ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    await context.close();
  }
}
