// Run with the existing Playwright MCP browser_run_code_unsafe (filename).
// Serve Marker.Web production dist with Vite preview on 127.0.0.1:5173 first.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 720 } });
  const externalRequests = [];
  context.on('request', request => {
    if (request.url().includes('external.invalid')) externalRequests.push(request.url());
  });
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = {
      sent: [],
      receive: data => handlers.forEach(handler => handler({ data }))
    };
    window.chrome = { webview: {
      postMessage: data => window.markerTest.sent.push(data),
      addEventListener: (type, handler) => { if (type === 'message') handlers.push(handler); }
    } };
  });
  const preview = await context.newPage();
  let stage = 'load';
  try {
    await preview.goto('http://127.0.0.1:5173/preview.html');
    await preview.waitForFunction(() => window.markerTest?.sent.some(message => message.type === 'ready'));
    const sessionId = '11111111111111111111111111111111';
    const send = message => preview.evaluate(message => window.markerTest.receive(message), message);
    await send({ type: 'initialize', protocolVersion: 1, sessionId });

    stage = 'sanitization and AST outline';
    await send({
      type: 'render', protocolVersion: 1, sessionId, version: 9,
      html: '<h1 onclick="window.markerPwn=1">目录目标</h1><h2>第二标题</h2><p onclick="window.markerPwn=2">正文</p>' +
        '<script>window.markerPwn=3</script><img src="https://external.invalid/p.png" onerror="window.markerPwn=4">' +
        '<a href="javascript:window.markerPwn=5">危险链接</a><iframe src="https://external.invalid/"></iframe><input autofocus>' +
        '<ul class="contains-task-list"><li><input type="checkbox" disabled checked>已完成任务</li>' +
        '<li><input type="checkbox" disabled>待办任务</li></ul>' +
        '<a href="#heading-%E7%9B%AE%E5%BD%95%E7%9B%AE%E6%A0%87">编码标题链接</a>' +
        '<table><tr><td align="left" style="text-align:left">左</td><td align="center" style="text-align:center">中</td><td align="right" style="text-align:right">右</td></tr></table>',
      outline: [
        { id: 'heading-目录目标', text: '目录目标', level: 1, offset: 12 },
        { id: 'heading-第二标题', text: '第二标题', level: 2, offset: 28 }
      ]
    });
    await preview.locator('#preview h1').waitFor();
    check(await preview.locator('#preview h1').getAttribute('id') === 'heading-目录目标', 'outline id assigned from validated outline');
    check(await preview.locator('#preview [data-marker-fragment]').getAttribute('data-marker-fragment') === 'heading-目录目标', 'percent-encoded Chinese heading fragment resolves safely');
    await preview.locator('#preview [data-marker-fragment]').click();
    check(await preview.locator('#outline > summary').innerText() === '文档大纲', 'Chinese outline summary remains available');
    check(await preview.locator('#preview script, #preview img, #preview iframe, #preview input, #preview [onclick], #preview a[href]').count() === 0,
      'dangerous nodes, event attributes, remote images and unsafe URLs are removed');
    check((await preview.locator('#preview ul').textContent()) === '☑ 已完成任务☐ 待办任务',
      'disabled Markdig task checkboxes become inert checked/unchecked text glyphs');
    check(await preview.evaluate(() => !window.markerPwn), 'dangerous markup never executes');
    check(await preview.locator('#preview td').evaluateAll(cells =>
      cells.every((cell, index) => cell.getAttribute('align') === ['left', 'center', 'right'][index] &&
        !cell.hasAttribute('style') && getComputedStyle(cell).textAlign.endsWith(['left', 'center', 'right'][index]))),
      'table alignment survives without allowing inline styles');

    stage = 'outline reveal bridge';
    await preview.locator('#outline').evaluate(element => { element.open = true; });
    await preview.locator('#outline button').first().click();
    let reveal = await preview.evaluate(() => window.markerTest.sent.filter(message => message.type === 'revealSource').at(-1));
    check(reveal?.protocolVersion === 1 && reveal.sessionId === sessionId && reveal.version === 9 && reveal.offset === 12,
      'outline click posts current session/version and source offset');

    stage = 'external link bridge';
    await send({
      type: 'render', protocolVersion: 1, sessionId, version: 10,
      html: '<h1>链接测试</h1><a href="http://external.invalid/article">外部链接</a>',
      outline: [{ id: 'heading-链接测试', text: '链接测试', level: 1, offset: 0 }]
    });
    await preview.locator('#preview [data-marker-url]').click();
    const openLink = await preview.evaluate(() => window.markerTest.sent.filter(message => message.type === 'openLink').at(-1));
    check(openLink?.protocolVersion === 1 && openLink.sessionId === sessionId && openLink.version === 10 &&
      openLink.url === 'http://external.invalid/article', 'HTTP click posts a controlled host message');
    check(preview.url() === 'http://127.0.0.1:5173/preview.html' && externalRequests.length === 0, 'external click does not navigate or request the URL');

    stage = 'stale and wrong session';
    await send({ type: 'render', protocolVersion: 1, sessionId: '22222222222222222222222222222222', version: 11, html: '<h1>错误会话</h1>', outline: [] });
    await send({ type: 'render', protocolVersion: 1, sessionId, version: 9, html: '<h1>旧版本</h1>', outline: [] });
    check(await preview.locator('#preview h1').innerText() === '链接测试', 'wrong-session and stale render are ignored');
    check(await preview.evaluate(() => window.markerTest.sent.filter(message => message.type === 'rendered').map(message => message.version).join(',') === '9,10'),
      'only accepted renders receive acknowledgements');

    stage = 'JavaScript highlighting';
    const javascript = 'const answer = 42;\nconsole.log(answer);';
    await send({
      type: 'render', protocolVersion: 1, sessionId, version: 11,
      html: `<pre><code class="language-js">${javascript}</code></pre>`, outline: []
    });
    const highlighted = preview.locator('#preview pre > code');
    await highlighted.waitFor();
    check(await highlighted.textContent() === javascript, 'highlight spans preserve exact code text');
    check(await highlighted.locator('span[class^="tok-"]').count() > 0, 'JavaScript tokens are represented by safe span nodes');

    stage = 'unknown language fallback';
    const unknown = 'using System;\nConsole.WriteLine("plain");';
    await send({
      type: 'render', protocolVersion: 1, sessionId, version: 12,
      html: `<pre><code class="language-csharp">${unknown.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')}</code></pre>`,
      outline: []
    });
    const plain = preview.locator('#preview pre > code');
    check(await plain.textContent() === unknown && await plain.locator('span').count() === 0, 'unsupported language remains plain text');

    stage = 'settings preserve DOM and scrolling';
    const longHtml = '<p>滚动保留测试内容</p>'.repeat(100);
    await send({ type: 'render', protocolVersion: 1, sessionId, version: 13, html: longHtml, outline: [] });
    await preview.evaluate(() => window.scrollTo({ top: 300, behavior: 'instant' }));
    await preview.waitForFunction(() => Math.abs(document.scrollingElement.scrollTop - 300) < 2);
    await send({ type: 'render', protocolVersion: 1, sessionId, version: 14, html: '<p>更新后的正文</p>' + longHtml, outline: [] });
    await preview.getByText('更新后的正文').waitFor();
    await preview.waitForFunction(() => Math.abs(document.scrollingElement.scrollTop - 300) < 2);
    check(await preview.locator('#preview').innerText().then(text => text.startsWith('更新后的正文')),
      'render update replaces preview content and preserves document scrollingElement position');

    stage = 'theme setting preserves scroll';
    await send({ protocolVersion: 1, type: 'settings', sessionId, theme: 'dark' });
    const afterTheme = await preview.evaluate(() => ({
      theme: document.documentElement.dataset.theme,
      scrollTop: document.scrollingElement.scrollTop
    }));
    check(afterTheme.theme === 'dark' && Math.abs(afterTheme.scrollTop - 300) < 2, 'theme update preserves the middle scroll position');

    stage = 'typography settings preserve DOM';
    await preview.evaluate(() => { window.markerTest.savedNode = document.querySelector('#preview').firstChild; });
    await send({ protocolVersion: 1, type: 'settings', sessionId, theme: 'dark', fontSize: 18, lineHeight: 1.2, lineWrapping: true });
    const afterSettings = await preview.evaluate(() => ({
      sameNode: document.querySelector('#preview').firstChild === window.markerTest.savedNode,
      scrollTop: document.scrollingElement.scrollTop,
      fontSize: getComputedStyle(document.body).fontSize,
      lineHeight: getComputedStyle(document.documentElement).getPropertyValue('--preview-line-height').trim(),
      theme: document.documentElement.dataset.theme,
      wrapping: document.documentElement.dataset.lineWrapping
    }));
    check(afterSettings.sameNode && afterSettings.scrollTop > 0 && afterSettings.fontSize === '18px' &&
      afterSettings.lineHeight === '1.2' && afterSettings.theme === 'dark' && afterSettings.wrapping === 'true',
      'typography settings update styles without rebuilding the preview DOM or resetting scroll');
    check(await preview.evaluate(() => window.markerTest.sent.filter(message => message.type === 'rendered').at(-1).version === 14),
      'settings do not require or trigger a render');

    return {
      passed: true,
      checks: [
        'dangerous markup sanitization', 'outline summary/navigation and source reveal protocol',
        'HTTP links are host-mediated without page navigation', 'wrong-session/stale render and acknowledgement behavior',
        'JavaScript syntax spans preserve exact source text', 'unknown language plain-text fallback',
        'render updates preserve document scrollingElement position', 'settings preserve DOM and scroll'
      ]
    };
  } catch (error) {
    throw new Error(`${stage}: ${error.message}; ${JSON.stringify(await preview.evaluate(() => ({
      sent: window.markerTest?.sent,
      title: document.querySelector('#preview')?.textContent?.slice(0, 300),
      scrollTop: document.scrollingElement?.scrollTop,
      errors: window.markerTest?.errors
    })))}`);
  } finally { await context.close(); }
}
