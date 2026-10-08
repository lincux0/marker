// Existing Playwright MCP snippet. Start only the test Marker with CDP port 9222.
// Requires split view and the two m4-drop-fixture-*.md files described in the guide.
// CDP supplies real disk-backed File objects; this does not prove Explorer OLE drag.
async (page) => {
  const browser = await page.context().browser().browserType().connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const editor = context.pages().find(p => p.url() === 'https://editor.marker.example/index.html');
  const preview = context.pages().find(p => p.url() === 'https://preview.marker.example/preview.html');
  if (!editor || !preview) throw new Error('Expected both Marker WebView2 pages');
  const check = (value, message) => { if (!value) throw new Error(message); };
  const before = await editor.locator('.cm-content').textContent();
  await editor.evaluate(() => {
    const original = chrome.webview.postMessageWithAdditionalObjects.bind(chrome.webview);
    window.markerM4Drop = [];
    chrome.webview.postMessageWithAdditionalObjects = (message, objects) => {
      window.markerM4Drop.push(message);
      original(message, objects);
    };
    const transfer = new DataTransfer();
    transfer.items.add(new File(['must not be inserted'], 'forged.md'));
    document.querySelector('.cm-content').dispatchEvent(new DragEvent('drop', {
      bubbles: true, cancelable: true, dataTransfer: transfer
    }));
    const packet = window.markerM4Drop.at(-1);
    chrome.webview.postMessage({ ...packet, paths: ['C:\\Windows\\win.ini.md'] });
    chrome.webview.postMessage(packet); // no native objects
  });
  await editor.waitForTimeout(250);
  check(await editor.locator('.cm-content').textContent() === before, 'Forged File/JSON changed the document');
  for (const [index, target] of [editor, preview].entries()) {
    const name = index === 0 ? 'editor' : 'preview';
    const heading = 'M4_NATIVE_DROP_' + name.toUpperCase();
    const filePath = 'D:\\marker\\artifacts\\m4-drop-fixture-' + name + '.md';
    const cdp = await context.newCDPSession(target);
    try {
      const data = { items: [], files: [filePath], dragOperationsMask: 1 };
      for (const type of ['dragEnter', 'dragOver', 'drop'])
        await cdp.send('Input.dispatchDragEvent', { type, x: 100, y: 100, data });
      await preview.locator('#preview h1').filter({ hasText: heading }).waitFor();
      check((await editor.locator('.cm-content').textContent()).startsWith('# ' + heading), 'Dropped file did not replace the document');
      check(!await editor.locator('.cm-content').textContent().then(text => text.includes('must not be inserted')), 'File bytes leaked into prior document');
    } finally { await cdp.detach(); }
  }
  return { passed: true, forgedFileAndJsonIgnored: true, nativeFileObjects: ['editor', 'preview'], explorerOle: 'separate test' };
}
