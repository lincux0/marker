// Existing Playwright MCP snippet. Launch only the test Marker process with
// WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222 first.
// Close that process after running. Never enable this port in release configuration.
async (page) => {
  const browser = await page.context().browser().browserType().connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const editor = context.pages().find(p => p.url() === 'https://editor.marker.example/index.html');
  const preview = context.pages().find(p => p.url() === 'https://preview.marker.example/preview.html');
  const check = (condition, reason) => { if (!condition) throw new Error(reason); };
  check(editor && preview, 'Expected isolated editor and preview pages');
  const requested = [];
  const captureRequest = request => requested.push(request);
  context.on('request', captureRequest);
  await editor.locator('.cm-content').fill('# 安全集成样例\n\n<script>window.pwned=1</script>\n\n[危险链接](javascript:alert(1))\n\n![图片](https://example.com/marker-test.png)\n\n**末尾标记**');
  await preview.locator('h1').filter({ hasText: '安全集成样例' }).waitFor();
  await preview.locator('strong').filter({ hasText: '末尾标记' }).waitFor();
  check(await preview.locator('#preview script, #preview img, #preview iframe, #preview a, #preview [href]').count() === 0, 'Unsafe document markup');
  check(await preview.evaluate(() => !window.pwned), 'Raw HTML executed');
  const fetchBlocked = await editor.evaluate(async () => {
    try { await fetch('https://example.com/marker-test'); return false; } catch { return true; }
  });
  check(fetchBlocked, 'External connection allowed');
  const localFileBlocked = await preview.evaluate(async () => {
    try { await fetch('file:///C:/Windows/win.ini'); return false; } catch { return true; }
  });
  check(localFileBlocked, 'Arbitrary local file allowed');
  const initialPages = context.pages().length;
  await editor.evaluate(() => window.open('https://example.com/marker-test'));
  await editor.waitForTimeout(300);
  check(context.pages().length === initialPages, 'New window allowed');
  for (const target of ['https://example.com/marker-test', 'https://preview.marker.example/preview.html', 'file:///C:/Windows/win.ini']) {
    let cancelled = false;
    try { await editor.goto(target, { timeout: 5000 }); } catch { cancelled = true; }
    check(cancelled && editor.url() === 'https://editor.marker.example/index.html', `Navigation allowed: ${target}`);
  }
  // Playwright emits request even for cancelled navigation; require failure, not absence.
  await editor.waitForTimeout(300);
  check(requested.filter(request => /^https:\/\/example\.com/.test(request.url())).every(request => request.failure()), 'External request completed instead of being blocked');
  const before = await preview.locator('#preview').innerHTML();
  await editor.evaluate(() => window.chrome.webview.postMessage({ type: 'snapshot', sessionId: 'wrong-session', version: 999, text: '# 不得接受' }));
  await editor.waitForTimeout(300);
  check(await preview.locator('#preview').innerHTML() === before, 'Wrong-session snapshot accepted');
  await preview.evaluate(() => window.chrome.webview.postMessage({ type: 'snapshot', sessionId: 'wrong-session', version: 1000, text: '# 不得接受' }));
  await editor.waitForTimeout(300);
  check(await preview.locator('#preview').innerHTML() === before, 'Preview gained editor capability');
  context.off('request', captureRequest);
  return { passed: true, checks: ['real host parsing/sanitization', 'CSP external connection', 'local file block', 'new window block', 'external/cross-view/file navigation', 'wrong session', 'preview message whitelist'], windowsIme: 'not tested' };
}
