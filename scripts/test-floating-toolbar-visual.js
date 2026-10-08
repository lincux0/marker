// Visual regression: compare actual filtered pixels, not only computed CSS.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1100, height: 760 } });
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = { receive: data => handlers.forEach(handler => handler({ data })) };
    window.chrome = { webview: { postMessage: () => {}, addEventListener: (_, handler) => handlers.push(handler) } };
  });
  const editor = await context.newPage();
  const sessionId = '88888888888888888888888888888888';
  const send = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    await send({ type: 'initialize', text: Array.from({length: 100}, (_, i) => `## 标题 ${i}\n\n正文内容用于观察真实玻璃模糊。\n\n`).join('') });
    await send({ type: 'settings', theme: 'light', fontSize: 16, lineHeight: 1.5, lineWrapping: true, reducedMotion: true, highContrast: false });
    await send({ type: 'toolbarState', title: '玻璃效果检查.md', notification: '', busy: false });
    const layout = await editor.evaluate(() => {
      const bar=document.querySelector('.marker-toolbar'), content=document.querySelector('.cm-content');
      const logo=bar.querySelector('img'), title=bar.querySelector('.marker-toolbar-title');
      return { gap: content.getBoundingClientRect().top-bar.getBoundingClientRect().bottom,
        logoLeft: logo.getBoundingClientRect().right < title.getBoundingClientRect().left,
        blur: getComputedStyle(bar).backdropFilter };
    });
    if (layout.gap < 28 || !layout.logoLeft || !layout.blur.includes("blur(32px)")) throw Error(JSON.stringify(layout));
    await editor.screenshot({path:'D:/marker/artifacts/glass-spacing-top.png'});
    await editor.locator('.cm-scroller').evaluate(e => { e.scrollTop=500; });
    await editor.screenshot({path:'D:/marker/artifacts/glass-spacing-scrolled.png'});
    await editor.locator('.cm-content').evaluate(e => {
      e.style.backgroundImage='repeating-linear-gradient(90deg, #202040 0px, #202040 4px, #ffffff 4px, #ffffff 8px)';
    });
    const clip={x:300,y:24,width:120,height:24};
    const filtered = await editor.screenshot({path:'D:/marker/artifacts/glass-filtered.png',clip});
    await editor.locator('.marker-toolbar').evaluate(e => {e.style.backdropFilter='none';e.style.webkitBackdropFilter='none';});
    const unfiltered = await editor.screenshot({path:'D:/marker/artifacts/glass-unfiltered.png',clip});
    if (filtered.equals(unfiltered)) throw Error('Backdrop filtering did not change actual pixels');
    return {passed:true,layout,pixelEvidence:['glass-filtered.png','glass-unfiltered.png']};
  } finally { await context.close(); }
}
