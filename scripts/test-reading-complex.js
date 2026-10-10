// U2 checks for the current editable CodeMirror view; run via Playwright MCP with Vite preview on 127.0.0.1:5173.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 1000 } });
  const editor = await context.newPage();
  const sessionId = '22222222222222222222222222222222';
  const checks = [];
  const errors = [];
  let snapshotCounter = 0;
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const frames = () => editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const readClipboard = async () => editor.evaluate(async () => (await navigator.clipboard.readText()).replace(/\r\n/g, '\n'));
  try {
    await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://127.0.0.1:5173' });
    const fixture = (await (await editor.request.get('http://127.0.0.1:5173/u2-reading.md')).text()).replace(/\r\n/g, '\n');
    await context.addInitScript(() => {
      const handlers = [];
      window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
      window.chrome = { webview: {
        postMessage: data => window.markerTest.sent.push(data),
        addEventListener: (type, handler) => { if (type === 'message') handlers.push(handler); },
      } };
      window.__u2xss = false;
    });
    editor.on('pageerror', error => errors.push(error.message));
    await editor.goto('http://127.0.0.1:5173/index.html');
    await editor.evaluate(() => {
      const nativeClipboard = navigator.clipboard;
      window.markerTest.clipboardPayloads = [];
      Object.defineProperty(navigator, 'clipboard', {
        configurable: true,
        value: {
          writeText: async text => { window.markerTest.clipboardPayloads.push(text); await nativeClipboard.writeText(text); },
          readText: () => nativeClipboard.readText(),
        },
      });
    });
    const send = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
    const snapshot = async (targetSessionId = sessionId) => {
      const requestId = `u2-${++snapshotCounter}`;
      await send({ type: 'requestSnapshot', requestId, sessionId: targetSessionId });
      await editor.waitForFunction(id => window.markerTest.sent.some(message => message.type === 'snapshot' && message.requestId === id), requestId);
      return editor.evaluate(id => window.markerTest.sent.findLast(message => message.type === 'snapshot' && message.requestId === id)?.text, requestId);
    };
    await send({ type: 'initialize', text: fixture });
    await editor.locator('.cm-md-table-row').first().waitFor();
    await frames();
    check(await snapshot() === fixture, 'Initial presentation changed the Markdown source.');
    checks.push('source-snapshot-initial');

    const renderFixture = [
      '# Render regression', '', '> Quote outer', '>', '> > Quote inner', '> >', '> > > Quote deepest', '>', '> ```text', '> quoted first', '>     quoted second', '> ```', '',
      '```js', 'const fenced = 1;', 'console.log(fenced);', '```', '', '```text', '```', '', '    const indented = 2;', '    console.log(indented);', '',
      '| text | inline |', '| --- | --- |', '| alpha | `code` |', '| beta | `code` omega |',
    ].join('\n');
    const renderSessionId = '33333333333333333333333333333333';
    await send({ type: 'initialize', sessionId: renderSessionId, text: renderFixture });
    await editor.locator('.cm-md-table-row').first().waitFor();
    await frames();
    check(await snapshot(renderSessionId) === renderFixture, 'Independent render fixture changed during initialization.');
    const renderGeometry = await editor.evaluate(() => {
      const textLeft = element => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode())) {
          if (!node.textContent?.trim()) continue;
          const range = document.createRange();
          range.setStart(node, 0);
          range.setEnd(node, 1);
          return range.getBoundingClientRect().left;
        }
        return element.getBoundingClientRect().left;
      };
      const outerQuote = [...document.querySelectorAll('.cm-md-quote-depth-1')].find(line => line.textContent.includes('Quote outer'));
      const innerQuote = [...document.querySelectorAll('.cm-md-quote-depth-2')].find(line => line.textContent.includes('Quote inner'));
      const deepestQuote = [...document.querySelectorAll('.cm-md-quote-depth-3')].find(line => line.textContent.includes('Quote deepest'));
      const headers = [...document.querySelectorAll('.cm-md-code-header')];
      const tableCells = [...document.querySelectorAll('.cm-md-table-cell')];
      const pureCodeCell = tableCells.find(cell => cell.textContent === 'code');
      const tableCode = pureCodeCell?.querySelector('.cm-md-inline-code');
      const mixedCodeCell = tableCells.find(cell => cell.textContent.includes('omega'));
      const mixedCode = mixedCodeCell?.querySelector('.cm-md-inline-code');
      const textRange = (element, target) => {
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        let node;
        while ((node = walker.nextNode()) && !node.textContent.includes(target)) { }
        if (!node) return null;
        const start = node.textContent.indexOf(target);
        const range = document.createRange();
        range.setStart(node, start);
        range.setEnd(node, start + target.length);
        const rect = range.getBoundingClientRect();
        return { top: rect.top, center: (rect.top + rect.bottom) / 2 };
      };
      const mixedCodeText = mixedCode && textRange(mixedCode, 'code');
      const mixedPlainText = mixedCodeCell && textRange(mixedCodeCell, 'omega');
      return {
        quoteLeft: [outerQuote && textLeft(outerQuote), innerQuote && textLeft(innerQuote), deepestQuote && textLeft(deepestQuote)],
        quotePadding: [outerQuote, innerQuote, deepestQuote].map(line => line && parseFloat(getComputedStyle(line).paddingInlineStart)),
        codeBlocks: headers.map(header => ({ className: header.className, text: header.textContent, header: header.getBoundingClientRect().toJSON(), body: header.nextElementSibling?.getBoundingClientRect().toJSON(), bodyClass: header.nextElementSibling?.className })),
        indentedCodeLines: [...document.querySelectorAll('.cm-md-code-header, .cm-md-code-line')].filter(line => line.textContent.includes('indented')).map(line => ({ text: line.textContent, className: line.className, rect: line.getBoundingClientRect().toJSON() })),
        tableInline: tableCode && { code: tableCode.getBoundingClientRect().toJSON(), cell: pureCodeCell?.getBoundingClientRect().toJSON(), mixedCodeText, mixedPlainText, mixedCell: mixedCodeCell?.getBoundingClientRect().toJSON() },
        quoteCodeLineClasses: [...document.querySelectorAll('.cm-md-code-line')].filter(line => line.textContent.includes('quoted')).map(line => line.className),
      };
    });
    check(renderGeometry.quoteLeft.every(Number.isFinite) && renderGeometry.quoteLeft[1] > renderGeometry.quoteLeft[0] + 2 && renderGeometry.quoteLeft[2] > renderGeometry.quoteLeft[1] + 2 &&
      renderGeometry.quotePadding.every(padding => padding > 0),
      `Nested quote levels did not gain padding and text insets: ${JSON.stringify({ left: renderGeometry.quoteLeft, padding: renderGeometry.quotePadding })}`);
    check(renderGeometry.codeBlocks.length === 4 && renderGeometry.codeBlocks.some(block => block.className.includes('cm-md-code-empty')) &&
      renderGeometry.codeBlocks.filter(block => !block.className.includes('cm-md-code-empty')).every(block => block.bodyClass?.includes('cm-md-code-line') && block.body.top >= block.header.bottom - 1),
      `Fenced code headers did not separate cleanly from their bodies or the empty fence was lost: ${JSON.stringify(renderGeometry.codeBlocks)}`);
    const emptyFence = renderGeometry.codeBlocks.find(block => block.className.includes('cm-md-code-empty'));
    const indentedHeader = renderGeometry.codeBlocks.find(block => block.text.includes('indented'));
    check(renderGeometry.indentedCodeLines.length === 2 && renderGeometry.indentedCodeLines[0].text === 'const indented = 2;' &&
      renderGeometry.indentedCodeLines[0].rect.top < renderGeometry.indentedCodeLines[1].rect.top && indentedHeader?.header.top > emptyFence?.header.bottom,
      `Indented code retained its Markdown prefix or was joined to the preceding empty fence: ${JSON.stringify(renderGeometry.indentedCodeLines)}`);
    check(renderGeometry.quoteCodeLineClasses.length === 2 && renderGeometry.quoteCodeLineClasses.every(className => className.includes('cm-md-quote-depth-1')),
      `Quoted code body lost its quote structure: ${JSON.stringify(renderGeometry.quoteCodeLineClasses)}`);
    check(renderGeometry.tableInline && renderGeometry.tableInline.mixedCodeText && renderGeometry.tableInline.mixedPlainText &&
      renderGeometry.tableInline.code.top >= renderGeometry.tableInline.cell.top && renderGeometry.tableInline.code.bottom <= renderGeometry.tableInline.cell.bottom &&
      Math.abs(renderGeometry.tableInline.mixedCodeText.center - renderGeometry.tableInline.mixedPlainText.center) < 4,
      `Inline code escaped its table cell's text box: ${JSON.stringify(renderGeometry.tableInline)}`);
    const renderCopyButtons = editor.locator('.cm-md-code-copy');
    check(await renderCopyButtons.count() === 3, `Expected copy controls for the quoted, ordinary fenced, and empty fenced blocks, got ${await renderCopyButtons.count()}.`);
    for (const [index, expected] of ['quoted first\n    quoted second\n', 'const fenced = 1;\nconsole.log(fenced);\n', ''].entries()) {
      await renderCopyButtons.nth(index).click();
      await editor.waitForFunction(async value => document.querySelector('#status')?.textContent?.includes('代码已复制') && (await navigator.clipboard.readText()).replace(/\r\n/g, '\n') === value, expected);
      check(await editor.evaluate(() => window.markerTest.clipboardPayloads.at(-1)) === expected,
        `Code copy changed or retained Markdown prefixes in sample ${index}: ${JSON.stringify(await editor.evaluate(() => window.markerTest.clipboardPayloads.at(-1)))}`);
    }
    await editor.locator('.cm-content').click();
    await editor.keyboard.press('Control+Alt+m');
    check(await snapshot(renderSessionId) === renderFixture && (await editor.locator('.cm-content').innerText()).includes('> ```text') && (await editor.locator('.cm-content').innerText()).includes('    const indented = 2;'),
      'Source mode did not preserve the quoted fence and indented code source.');
    await editor.keyboard.press('Control+a');
    await editor.keyboard.insertText('temporary replacement');
    await editor.keyboard.press('Control+z');
    check(await snapshot(renderSessionId) === renderFixture, 'Undo did not restore the independent render fixture exactly.');
    await editor.keyboard.press('Control+Alt+m');
    check(await snapshot(renderSessionId) === renderFixture, 'Source/display round trip changed the independent render fixture.');
    checks.push('quote-depth-geometry-code-headers-table-inline-and-code-copy-source-undo');
    await send({ type: 'initialize', sessionId, text: fixture });
    await editor.locator('.cm-md-table-row').first().waitFor();
    await frames();
    check(await snapshot() === fixture, 'Restoring the original fixture changed its Markdown source.');

    const tableRows = editor.locator('.cm-md-table-row');
    const cells = editor.locator('.cm-md-table-cell');
    check(await tableRows.count() === 4, `Expected one header and three body rows, got ${await tableRows.count()}.`);
    check(await cells.count() === 48, `Expected 12 cells per row, got ${await cells.count()} total.`);
    check(fixture.includes('A \\| B') && fixture.includes('| :--- | :---: | ---: |'), 'Escaped pipe or alignment syntax is absent from the fixture.');
    check(fixture.includes('`inline \\| code`'), 'Escaped pipe inside inline code is absent from the fixture.');
    const tableGeometry = await editor.evaluate(() => {
      const rows = [...document.querySelectorAll('.cm-md-table-row')];
      const row = rows[1];
      const cells = [...row.querySelectorAll('.cm-md-table-cell')];
      const rect = element => { const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height, right: r.right }; };
      const content = document.querySelector('.cm-content');
      const contentStyle = getComputedStyle(content);
      const lineWidth = content.clientWidth - parseFloat(contentStyle.paddingLeft) - parseFloat(contentStyle.paddingRight);
      return {
        viewportWidth: innerWidth, documentWidth: document.documentElement.scrollWidth, lineWidth, row: rect(row),
        first: rect(cells[0]), last: rect(cells.at(-1)), longCell: rect(cells[5]),
        alignments: [1, 2, 3].map(index => ({ className: cells[index].className, textAlign: getComputedStyle(cells[index]).textAlign })),
      };
    });
    check(Math.abs(tableGeometry.row.width - tableGeometry.lineWidth) < 2, `Wide table did not fit the paper's text area: ${JSON.stringify(tableGeometry)}`);
    check(tableGeometry.longCell.height > 0 && tableGeometry.last.right <= tableGeometry.documentWidth + 1, `Long table cell or final column is unreachable: ${JSON.stringify(tableGeometry)}`);
    check(tableGeometry.alignments.every((alignment, index) => alignment.textAlign === ['left', 'center', 'right'][index] && alignment.className.includes(`cm-md-table-align-${['left', 'center', 'right'][index]}`)),
      `Table alignment classes or computed styles are incorrect: ${JSON.stringify(tableGeometry.alignments)}`);
    check(await snapshot() === fixture, 'Table presentation changed escaped pipes or alignment source.');
    await tableRows.first().click();
    await editor.keyboard.press('Control+Alt+m');
    await editor.locator('.cm-content').click();
    await editor.keyboard.press('Control+a');
    await editor.keyboard.press('Control+c');
    check(await readClipboard() === fixture, 'Selecting and copying the source did not preserve the complete Markdown, including wide table rows and escaped pipes.');
    await editor.keyboard.press('Control+Alt+m');
    check(await snapshot() === fixture, 'Table source-mode selection or copy changed the document.');
    checks.push('wide-table-computed-alignment-and-source-select-copy');

    // Collapse the selection and scroll the code header into CodeMirror's virtual viewport.
    await editor.keyboard.press('Control+Home');
    await editor.locator('.cm-scroller').evaluate(element => element.scrollBy(0, element.clientHeight * 0.75));
    await frames();

    const code = fixture.match(/```[^\n]*\n([\s\S]*?)\n```/);
    check(code, 'Long fenced code sample was not found.');
    const codePayload = `${code[1]}\n`;
    const copyButton = editor.locator('.cm-md-code-copy').first();
    await copyButton.waitFor();
    check(await copyButton.getAttribute('aria-label') === '复制代码', 'Code copy button has no accessible name.');
    check(await copyButton.evaluate(element => element.tabIndex >= 0), 'Code copy button is not keyboard focusable.');
    await copyButton.focus();
    await editor.keyboard.press('Enter');
    await editor.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('代码已复制'));
    const copiedCode = await readClipboard();
    check(copiedCode === codePayload, `Clipboard content differs from raw fenced code after newline normalization: expected ${JSON.stringify(codePayload)}, got ${JSON.stringify(copiedCode)}`);
    check(await editor.evaluate(() => window.markerTest.clipboardPayloads.at(-1)) === codePayload, 'Code copy API payload differed from the exact raw Markdown code payload.');
    checks.push('code-copy-keyboard-success-exact-payload');
    await editor.screenshot({ path: 'D:/marker/artifacts/reading-ui-u2-code.png' });

    const codeLine = editor.locator('.cm-md-code-line').filter({ hasText: 'U2_CODE_COPY_BEGIN' }).first();
    await codeLine.click();
    await editor.keyboard.press('Home');
    await editor.keyboard.press('Shift+End');
    await editor.keyboard.press('Control+c');
    check(await readClipboard() === 'U2_CODE_COPY_BEGIN', 'Selecting code did not copy only the selected source text.');
    await editor.keyboard.press('ArrowRight');
    await editor.keyboard.press('End');
    await editor.keyboard.insertText(' EDITED');
    check((await snapshot()).includes('U2_CODE_COPY_BEGIN EDITED'), 'Code text could not be edited in place.');
    await editor.keyboard.press('Control+z');
    check(await snapshot() === fixture, 'Undo did not restore the original code and Markdown source.');
    checks.push('code-selection-copy-and-undo');

    await editor.evaluate(() => { document.querySelector('.cm-scroller').scrollTop = document.querySelector('.cm-scroller').scrollHeight; });
    await frames();
    for (const [language, payload] of [['js', 'list first\nlist second\n'], ['py', 'quote first\nquote second\n']]) {
      const nestedButton = editor.locator('.cm-md-code-tools').filter({ has: editor.getByText(language, { exact: true }) }).locator('.cm-md-code-copy');
      await nestedButton.focus();
      await editor.keyboard.press('Enter');
      await editor.waitForFunction(async expected =>
        document.querySelector('#status')?.textContent?.includes('代码已复制') && (await navigator.clipboard.readText()).replace(/\r\n/g, '\n') === expected, payload);
      check(await readClipboard() === payload, `Nested code copy retained a Markdown container prefix or lost source lines: ${payload}`);
      check(await editor.evaluate(() => window.markerTest.clipboardPayloads.at(-1)) === payload, 'Nested code copy API payload contained a container prefix or changed line endings.');
    }
    checks.push('list-and-blockquote-code-copy-strips-container-prefixes');

    await editor.evaluate(() => Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText: async () => { throw new Error('simulated clipboard denial'); } },
    }));
    await copyButton.focus();
    await editor.keyboard.press('Enter');
    await editor.waitForFunction(() => document.querySelector('#status')?.textContent?.includes('复制代码失败'));
    checks.push('code-copy-failure-feedback');

    await editor.evaluate(() => { document.querySelector('.cm-scroller').scrollTop = document.querySelector('.cm-scroller').scrollHeight; });
    await frames();
    const change = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').at(-1));
    check(change, 'Editor did not report its current document version.');
    const safeUrl = `https://document.marker.example/${sessionId}/image/${'b'.repeat(48)}`;
    const brokenUrl = `https://document.marker.example/${sessionId}/image/${'c'.repeat(48)}`;
    await editor.route('https://document.marker.example/**', async route => {
      if (route.request().url() === brokenUrl) return route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' });
      return route.fulfill({ status: 200, contentType: 'image/png', path: 'D:/marker/src/Marker.App/Assets/Square44x44Logo.png' });
    });
    await send({ type: 'imageResources', version: change.version, resources: [
      { source: 'u2-safe-image.png', url: safeUrl },
      { source: 'u2-missing-image.png', url: brokenUrl },
    ] });
    const image = editor.locator('.cm-md-image img').first();
    await image.waitFor();
    await image.scrollIntoViewIfNeeded();
    await editor.waitForFunction(() => document.querySelector('.cm-md-image img')?.complete && document.querySelector('.cm-md-image img')?.naturalWidth > 0);
    check(await image.getAttribute('alt') === '成功 **粗体** 与 `code` 不重叠', 'Successful image alt text or nested Markdown markers changed unexpectedly.');
    check(await editor.locator('.cm-md-image-caption').count() === 0, 'Image alt text is redundantly displayed as a caption.');
    check(await image.evaluate(element => {
      const wrapper = element.parentElement.cloneNode(true);
      wrapper.querySelector('.cm-md-image-zoom')?.remove();
      return wrapper.children.length === 1 && wrapper.textContent === '';
    }), 'Nested bold/code markers overlapped or appeared beside the image widget.');
    const imageSize = await image.evaluate(element => ({ width: element.getBoundingClientRect().width, height: element.getBoundingClientRect().height, naturalWidth: element.naturalWidth, naturalHeight: element.naturalHeight }));
    check(imageSize.width <= imageSize.naturalWidth && Math.abs(imageSize.width / imageSize.height - imageSize.naturalWidth / imageSize.naturalHeight) < 0.02,
      `Small image was enlarged or its aspect ratio changed: ${JSON.stringify(imageSize)}`);
    const placeholders = editor.locator('.cm-md-image-placeholder');
    await editor.waitForFunction(() => document.querySelectorAll('.cm-md-image-placeholder').length >= 1 && document.querySelector('.cm-md-image-unavailable'));
    const placeholderText = await placeholders.allTextContents();
    check(placeholderText.some(text => text.includes('缺失图片的替代文字')), 'Runtime image failure did not show its alt text.');
    check(placeholderText.some(text => text.includes('相对越界资源')), 'Unmapped relative path did not show a safe placeholder.');
    check(placeholderText.every(text => !/[A-Za-z]:\\|\\\\[^\\]+\\/.test(text) && !text.includes('document.marker.example') && !text.includes('u2-secret-image.png')),
      `Image failure feedback leaked a path or URL: ${JSON.stringify(placeholderText)}`);
    checks.push('safe-image-alt-nested-markers-and-small-size', 'failed-image-placeholder-no-path-leak');
    await editor.screenshot({ path: 'D:/marker/artifacts/reading-ui-u2-images.png' });
    check(await snapshot() === fixture, 'Image resource updates changed Markdown source.');

    const layouts = [];
    await editor.evaluate(() => { document.querySelector('.cm-scroller').scrollTop = 0; });
    await frames();
    for (const state of [
      { name: 'light-default', viewport: 1280, settings: { theme: 'light', fontSize: 16, lineHeight: 1.5, paragraphSpacing: 0.5, highContrast: false } },
      { name: 'dark-large-type', viewport: 1280, settings: { theme: 'dark', fontSize: 20, lineHeight: 1.7, paragraphSpacing: 0.75, highContrast: false } },
      { name: 'narrow-high-contrast', viewport: 720, settings: { theme: 'light', fontSize: 18, lineHeight: 1.6, paragraphSpacing: 0.6, highContrast: true } },
    ]) {
      await editor.setViewportSize({ width: state.viewport, height: 900 });
      await send({ type: 'settings', ...state.settings, lineWrapping: true, reducedMotion: true, colorPalette: 'lavender' });
      await frames();
      await editor.waitForTimeout(350);
      const measurement = await editor.evaluate(() => ({
        viewport: { width: innerWidth, height: innerHeight },
        document: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
        content: (() => { const rect = document.querySelector('.cm-content').getBoundingClientRect(); return { x: rect.x, width: rect.width, fontSize: getComputedStyle(document.querySelector('.cm-content')).fontSize }; })(),
        tableRows: document.querySelectorAll('.cm-md-table-row').length,
      }));
      check(measurement.document.width <= measurement.viewport.width + 1, `${state.name} caused page-level horizontal overflow: ${JSON.stringify(measurement)}`);
      check(measurement.content.fontSize === `${state.settings.fontSize}px`, `${state.name} did not apply its requested font size.`);
      check(await editor.evaluate(() => document.documentElement.dataset.highContrast === 'true') === state.settings.highContrast, `${state.name} did not apply its high-contrast state.`);
      check(measurement.tableRows > 0, `${state.name} did not render any visible table rows.`);
      await editor.screenshot({ path: `D:/marker/artifacts/reading-ui-u2-${state.name}.png`, fullPage: true });
      layouts.push({ name: state.name, ...measurement });
      check(await snapshot() === fixture, `${state.name} changed the original Markdown.`);
    }
    await editor.locator('.cm-md-table-row').first().click();
    await editor.keyboard.press('Control+Alt+m');
    check((await editor.locator('.cm-content').innerText()).includes('A \\| B') && (await editor.locator('.cm-content').innerText()).includes('```text'),
      'Source mode did not expose the original table and code syntax.');
    await editor.keyboard.press('Control+Alt+m');
    check(await snapshot() === fixture, 'Source/display switching changed the Markdown source.');
    const safeImageMarkdown = fixture.split('\n').find(line => line.includes('u2-safe-image.png'));
    check(safeImageMarkdown, 'Successful image Markdown source was not found.');
    await editor.keyboard.press('Control+Alt+m');
    await editor.waitForTimeout(100);
    await editor.evaluate(() => { document.querySelector('.cm-scroller').scrollTop = document.querySelector('.cm-scroller').scrollHeight; });
    await frames();
    await editor.waitForTimeout(100);
    const safeImageLine = editor.locator('.cm-line').filter({ hasText: 'u2-safe-image.png' }).first();
    await editor.screenshot({ path: 'D:/marker/artifacts/reading-ui-u2-source-diagnostic.png' });
    const imageLineGeometry = await safeImageLine.evaluate(element => ({ text: element.textContent, rect: element.getBoundingClientRect().toJSON(), scroller: { top: document.querySelector('.cm-scroller').scrollTop, height: document.querySelector('.cm-scroller').scrollHeight } }));
    await safeImageLine.click({ position: { x: 8, y: 10 } });
    const imageSelection = await safeImageLine.evaluate(element => ({ selection: window.getSelection()?.toString(), sourceMode: document.querySelector('.cm-editor').dataset.sourceMode, active: document.activeElement?.className, rect: element.getBoundingClientRect().toJSON(), selectedTextNode: window.getSelection()?.anchorNode?.textContent }));
    await editor.keyboard.press('Home');
    await editor.keyboard.press('Shift+End');
    await editor.keyboard.press('Backspace');
    const deletedImageSource = await snapshot();
    check(deletedImageSource === fixture.replace(safeImageMarkdown, ''), `Deleting the selected image source line did not remove exactly that line: ${JSON.stringify({ imageSelection, imageLineGeometry, tail: deletedImageSource.slice(-400), length: deletedImageSource.length, expectedLength: fixture.length - safeImageMarkdown.length })}`);
    await editor.keyboard.press('Control+z');
    check(await snapshot() === fixture, 'Undo did not restore the complete image source line.');
    await editor.keyboard.press('Control+Alt+m');
    check(await snapshot() === fixture, 'Image source undo or display-mode round trip changed the document.');
    checks.push('image-source-toggle-delete-undo');
    check(errors.length === 0, `Browser runtime errors: ${errors.join('; ')}`);

    const previewPage = await context.newPage();
    const previewErrors = [];
    const remoteRequests = [];
    previewPage.on('pageerror', error => previewErrors.push(error.message));
    await previewPage.route('https://document.marker.example/**', route => route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' }));
    await previewPage.route('https://example.com/**', route => { remoteRequests.push(route.request().url()); return route.abort(); });
    await previewPage.goto('http://127.0.0.1:5173/preview.html');
    const previewSend = message => previewPage.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
    await previewSend({ type: 'initialize', theme: 'light', fontSize: 16, lineHeight: 1.5 });
    const wrongSession = `https://document.marker.example/${'3'.repeat(32)}/image/${'d'.repeat(48)}`;
    const html = `<p>图片安全回归</p><img src="${safeUrl}" alt="受控资源 404 替代文字"><img src="${wrongSession}" alt="错误会话图片"><img src="https://example.com/remote.png" alt="远程图片"><img src="file:///C:/private/secret.png" alt="文件图片"><script>window.__u2xss = true</script><img src="${safeUrl}" alt="XSS 属性图" onerror="window.__u2xss = true">`;
    await previewSend({ type: 'render', version: 1, html, outline: [] });
    await previewPage.waitForFunction(() => document.querySelectorAll('.image-unavailable').length === 5);
    const previewResult = await previewPage.evaluate(() => ({
      placeholders: [...document.querySelectorAll('.image-unavailable')].map(element => element.textContent),
      images: document.querySelectorAll('img').length,
      scripts: document.querySelectorAll('#preview script').length,
      xss: window.__u2xss,
      text: document.querySelector('#preview').textContent,
    }));
    check(previewResult.images === 0 && previewResult.scripts === 0 && previewResult.xss === false, `Preview accepted an unsafe image or executed injected markup: ${JSON.stringify(previewResult)}`);
    check(previewResult.placeholders.some(text => text.includes('受控资源 404 替代文字')) && previewResult.placeholders.some(text => text.includes('错误会话图片')) &&
      previewResult.placeholders.some(text => text.includes('远程图片')) && previewResult.placeholders.some(text => text.includes('文件图片')),
      `Preview did not preserve safe image fallback text: ${JSON.stringify(previewResult.placeholders)}`);
    check(previewResult.placeholders.every(text => !text.includes('document.marker.example') && !text.includes('example.com') && !/[A-Za-z]:\\/.test(text)),
      `Preview fallback leaked an image URL or absolute path: ${JSON.stringify(previewResult.placeholders)}`);
    check(remoteRequests.length === 0 && previewErrors.length === 0, `Preview attempted a remote image or raised runtime errors: ${JSON.stringify({ remoteRequests, previewErrors })}`);
    checks.push('preview-image-session-url-and-xss-safety');
    return { passed: true, fixture: 'docs/samples/u2-reading.md', checks, tableGeometry, codePayloadLength: codePayload.length, imageSize, placeholderText, layouts, previewResult, remoteRequests, runtimeErrors: errors, previewErrors };
  } finally {
    await context.close();
  }
}
