// Short layout regression and screenshot using the existing Playwright MCP (not Windows acceptance).
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1200, height: 900 } });
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
    window.chrome = { webview: { postMessage: data => window.markerTest.sent.push(data), addEventListener: (_, handler) => handlers.push(handler) } };
  });
  const editor = await context.newPage();
  let sessionId = '66666666666666666666666666666666';
  const receive = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
  const check = (value, message) => { if (!value) throw new Error(message); };
  try {
    await editor.goto('http://127.0.0.1:5173/index.html');
    await receive({ type: 'initialize', text: Array.from({ length: 6 }, (_, index) => '#'.repeat(index + 1) + ' 标题层次 ' + (index + 1)).join('\n\n') });
    await editor.locator('.cm-md-h6').waitFor();
    const sizes = await editor.locator('.cm-md-heading').evaluateAll(elements => elements.map(element => parseFloat(getComputedStyle(element).fontSize)));
    check(sizes.length === 6 && sizes.every((size, index) => !index || sizes[index - 1] > size), 'Heading levels are not distinct');
    const source = '## 清晰的写作界面\n\n- [ ] 确认项目结构和文件安全\n- [x] 完成排版与编辑体验\n\n| 阶段 | 目标 | 前置依赖 | 估算 |\n| --- | --- | --- | --- |\n| M0 | 锁定基础工程、支持边界和分发可行性 | 无 | 3–4 天 |\n| M1 | 验证编辑器、预览、输入法和最低安全边界 | M0 可构建 | 5–8 天 |\n| M2 | 建立可恢复、可冲突处理的本地文档工作流 | M1 退出 | 7–10 天 |\n';
    sessionId = '77777777777777777777777777777777';
    await receive({ type: 'initialize', text: source });
    await editor.locator('.cm-md-table-last').waitFor();
    const layout = await editor.evaluate(() => {
      const rows = [...document.querySelectorAll('.cm-md-table-row')];
      const taskOffset = element => {
        const range = document.createRange();
        const line = element.closest('.cm-line');
        const walker = document.createTreeWalker(line, NodeFilter.SHOW_TEXT);
        let node;
        while (node = walker.nextNode()) if (node.textContent.trim()) break;
        range.selectNodeContents(node);
        return element.getBoundingClientRect().bottom - range.getBoundingClientRect().bottom;
      };
      const tasks = [...document.querySelectorAll('.cm-md-task')];
      return {
        rows: rows.map(row => ({ height: row.getBoundingClientRect().height, rule: getComputedStyle(row).backgroundImage })),
        bottomRadius: getComputedStyle(rows.at(-1)).borderBottomLeftRadius,
        tasks: tasks.map(task => ({ width: task.getBoundingClientRect().width, height: task.getBoundingClientRect().height, offset: taskOffset(task) })),
        tick: getComputedStyle(tasks[1], '::after').borderBottomWidth,
      };
    });
    check(layout.rows.every(row => row.rule.includes('linear-gradient')), 'Row-wide table rules missing');
    check(parseFloat(layout.bottomRadius) > 0, 'Last table row lacks rounded corners');
    check(Math.abs(layout.tasks[0].height - layout.tasks[1].height) < .1 && Math.abs(layout.tasks[0].offset - layout.tasks[1].offset) < .5, 'Task states have different baselines');
    check(parseFloat(layout.tick) > 0, 'Straight-stroke check mark missing');
    await editor.screenshot({ path: 'D:/marker/artifacts/ui-refinement-web.png' });
    await receive({ type: 'settings', theme: 'dark', fontSize: 24, lineHeight: 2, lineWrapping: true, reducedMotion: true, highContrast: false });
    check(await editor.locator('.cm-md-table-last').count() === 1, 'Settings removed table layout');
    return { passed: true, headingSizes: sizes, layout, screenshot: 'D:/marker/artifacts/ui-refinement-web.png' };
  } finally { await context.close(); }
}
