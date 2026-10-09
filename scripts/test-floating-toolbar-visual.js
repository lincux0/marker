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
      const barRect=bar.getBoundingClientRect(), paperRect=content.getBoundingClientRect();
      return { gap: paperRect.top-barRect.bottom, toolbarWidth:barRect.width, paperWidth:paperRect.width,
        centered:Math.abs((barRect.left+barRect.right)/2-innerWidth/2)<1,
        logoLeft: logo.getBoundingClientRect().right < title.getBoundingClientRect().left,
        blur: getComputedStyle(bar).backdropFilter };
    });
    if (layout.gap < 28 || layout.toolbarWidth-layout.paperWidth < 63 || layout.toolbarWidth-layout.paperWidth > 65 ||
      !layout.centered || !layout.logoLeft || !layout.blur.includes("blur(32px)")) throw Error(JSON.stringify(layout));
    const viewportLayouts=[];
    for (const width of [1400,2000,720]) {
      await editor.setViewportSize({width,height:760});
      await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      const sizing=await editor.evaluate(()=>{
        const bar=document.querySelector('.marker-toolbar').getBoundingClientRect();
        const paper=document.querySelector('.cm-content').getBoundingClientRect();
        return {viewport:innerWidth,toolbar:bar.width,paper:paper.width,center:Math.abs((bar.left+bar.right)/2-innerWidth/2)};
      });
      const delta=sizing.toolbar-sizing.paper;
      if (sizing.center>=1 || delta<=0 ||
        (width>800 && (delta<63 || delta>65)) || (width<=800 && (delta<20 || delta>64))) throw Error(JSON.stringify(sizing));
      viewportLayouts.push(sizing);
    }
    await editor.setViewportSize({width:1100,height:760});
    await editor.screenshot({path:'D:/marker/artifacts/glass-spacing-top.png'});
    await editor.locator('.cm-scroller').evaluate(e => { e.scrollTop=500; });
    await editor.screenshot({path:'D:/marker/artifacts/glass-spacing-scrolled.png'});
    await editor.locator('.cm-content').evaluate(e => {
      e.style.backgroundImage='repeating-linear-gradient(90deg, #202040 0px, #202040 4px, #ffffff 4px, #ffffff 8px)';
    });
    const clip={x:420,y:24,width:120,height:24};
    const filtered = await editor.screenshot({path:'D:/marker/artifacts/glass-filtered.png',clip});
    await editor.locator('.marker-toolbar').evaluate(e => {e.style.backdropFilter='none';e.style.webkitBackdropFilter='none';});
    const unfiltered = await editor.screenshot({path:'D:/marker/artifacts/glass-unfiltered.png',clip});
    if (filtered.equals(unfiltered)) throw Error('Backdrop filtering did not change actual pixels');
    return {passed:true,layout,viewportLayouts,pixelEvidence:['glass-filtered.png','glass-unfiltered.png']};
  } finally { await context.close(); }
}
