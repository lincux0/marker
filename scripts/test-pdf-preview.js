// Existing Playwright MCP runner; mock host exercises print preparation and browser PDF layout.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1000, height: 900 } });
  const preview = await context.newPage();
  const sessionId = '88888888888888888888888888888888';
  const requestId = '99999999999999999999999999999999';
  try {
    await preview.addInitScript(() => {
      const handlers = [];
      window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
      window.chrome = { webview: { postMessage: data => window.markerTest.sent.push(data), addEventListener: (_, handler) => handlers.push(handler) } };
    });
    await preview.goto('http://127.0.0.1:5173/preview.html');
    const receive = message => preview.evaluate(data => window.markerTest.receive(data), { protocolVersion: 1, sessionId, ...message });
    await receive({ type: 'initialize' });
    await receive({ type: 'settings', theme: 'dark', fontSize: 16, lineHeight: 1.5, lineWrapping: true });
    const html = '<h1>中文 PDF 导出</h1><p>尚未保存的正文。<strong>粗体</strong></p><p><span class="math">\\(x^2+1\\)</span></p><pre><code class="language-mermaid">flowchart LR\nA[开始] --> B[完成]</code></pre><table><thead><tr><th>标题</th><th>值</th></tr></thead><tbody><tr><td>中文</td><td>123</td></tr></tbody></table>' + Array.from({ length: 70 }, (_, i) => '<p>分页内容 ' + i + '：中文字符与 English text</p>').join('') + '<p>PDF_EXPORT_TAIL</p>';
    await receive({ type: 'render', version: 0, html, outline: [] });
    await receive({ type: 'preparePdf', version: 0, requestId });
    await preview.waitForFunction(id => window.markerTest.sent.some(message => message.type === 'pdfReady' && message.requestId === id), requestId, { timeout: 30000 });
    const ready = await preview.evaluate(id => window.markerTest.sent.find(message => message.type === 'pdfReady' && message.requestId === id), requestId);
    if (!ready.success) throw new Error('Print preparation failed');
    const rendered = await preview.locator('.marker-print-mermaid svg').count();
    if (rendered !== 1) throw new Error('Mermaid was not rendered for export');
    if (!await preview.locator('.katex').count()) throw new Error('Math was not rendered for export');
    await preview.emulateMedia({ media: 'print' });
    const color = await preview.locator('body').evaluate(element => getComputedStyle(element).color);
    if (color !== 'rgb(34, 34, 34)') throw new Error('Dark theme leaked into PDF');
    await preview.pdf({ path: 'D:/marker/artifacts/pdf-export-web.pdf', format: 'A4', margin: { top: '15mm', bottom: '15mm', left: '15mm', right: '15mm' }, printBackground: true });
    await receive({ type: 'finishPdf' });
    if (await preview.evaluate(() => document.documentElement.dataset.pdf)) throw new Error('Print state not cleared');
    return { passed: true, renderedMermaid: rendered, pdf: 'artifacts/pdf-export-web.pdf', checks: ['math', 'mermaid', 'light print palette', 'multi-page complete content', 'cleanup'] };
  } finally { await context.close(); }
}
