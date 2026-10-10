// U3 outline, source navigation, and focus-mode checks via the configured Playwright MCP stub.
async (page) => {
  const context = await page.context().browser().newContext({ viewport: { width: 1280, height: 900 } });
  const editor = await context.newPage();
  const sessionId = '55555555555555555555555555555555';
  const errors = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const sourceLines = [
    '# 重复标题', '# 重复标题', '## 中文标题', '[有效链接](#heading-%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98)',
    '[未知链接](#heading-unknown)', '[坏链接](#bad%ZZ)',
    ...Array.from({ length: 220 }, (_, index) => `### 目录 ${String(index + 1).padStart(3, '0')}`),
  ];
  const source = sourceLines.join('\n\n');
  const headings = [];
  let offset = 0;
  for (const line of sourceLines) {
    if (/^#{1,6} /.test(line)) {
      const level = line.match(/^#+/)[0].length;
      const text = line.slice(level + 1);
      const base = `heading-${text.replace(/[^\p{L}\p{N}]+/gu, '-').replace(/-+$/u, '')}`;
      const duplicate = headings.filter(item => item.id === base || item.id.startsWith(`${base}-`)).length;
      headings.push({ id: duplicate ? `${base}-${duplicate + 1}` : base, text, level, offset });
    }
    offset += line.length + 2;
  }
  const send = message => editor.evaluate(packet => window.markerTest.receive(packet), { protocolVersion: 1, sessionId, ...message });
  const latest = type => editor.evaluate(name => window.markerTest.sent.filter(message => message.type === name).at(-1), type);
  let snapshotId = 0;
  const snapshot = async () => {
    const requestId = `nav-${++snapshotId}`;
    await send({ type: 'requestSnapshot', requestId });
    await editor.waitForFunction(id => window.markerTest.sent.some(message => message.type === 'snapshot' && message.requestId === id), requestId);
    return editor.evaluate(id => window.markerTest.sent.findLast(message => message.type === 'snapshot' && message.requestId === id)?.text, requestId);
  };
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
    editor.on('pageerror', error => errors.push(error.message));
    await editor.goto('http://127.0.0.1:5173/index.html');
    await send({ type: 'initialize', text: source });
    await editor.locator('.cm-content').waitFor();
    check(await snapshot() === source, 'Editor changed the Markdown during initialization.');
    const version = 0;
    await send({ type: 'outline', version, headings });

    const toolbar = editor.getByRole('toolbar', { name: '文档工具栏' });
    const outlineToggle = toolbar.getByRole('button', { name: '文档大纲' }).first();
    const nav = editor.getByRole('navigation', { name: '文档大纲' });
    check(await outlineToggle.getAttribute('aria-expanded') === 'false' && !(await nav.isVisible()), 'The outline should start collapsed.');

    // Invalid packets must leave the accepted outline usable and must not navigate.
    await send({ type: 'outline', sessionId: '66666666666666666666666666666666', version, headings });
    await send({ type: 'outline', version: version + 1, headings });
    await send({ type: 'outline', version, headings: [{ ...headings[0], offset: source.length + 1 }] });
    await send({ type: 'outline', version, headings: [headings[0], { ...headings[1], id: headings[0].id }] });
    if (!(await nav.isVisible())) await outlineToggle.click();
    check(await nav.isVisible() && await nav.locator('.marker-outline-heading').count() > 0, 'Rejected outline packets replaced or disabled the accepted outline.');

    // Same-title entries must retain their distinct source offsets; navigation and undo leave the source intact.
    await nav.locator('.marker-outline-heading').filter({ hasText: '重复标题' }).nth(1).click();
    check((await latest('status'))?.line === 3, 'The second repeated title did not navigate to its own source line.');
    check(await snapshot() === source, 'Outline navigation changed the Markdown source.');
    await editor.keyboard.press('Control+z');
    check(await snapshot() === source, 'Undo after outline navigation changed the document.');
    await nav.getByRole('button', { name: '返回跳转前位置' }).click();
    check((await latest('status'))?.line === 1, 'Returning from navigation did not restore the original selection.');
    await nav.getByRole('button', { name: '复制链接：中文标题', exact: true }).click();
    check(await editor.evaluate(() => navigator.clipboard.readText()) === '#heading-%E4%B8%AD%E6%96%87%E6%A0%87%E9%A2%98',
      'The chapter link did not use the encoded Markdig heading ID.');

    // Keyboard close restores the outline toolbar trigger.
    await nav.getByRole('button', { name: '关闭文档大纲' }).focus();
    await editor.keyboard.press('Escape');
    check(!(await nav.isVisible()) && await outlineToggle.evaluate(element => element === document.activeElement), 'Escape did not close the outline and restore trigger focus.');

    // Percent-encoded Chinese fragments jump locally; unknown and malformed fragments never become external links.
    const validLink = editor.locator('.cm-md-link').filter({ hasText: '有效链接' });
    await validLink.click({ modifiers: ['Control'] });
    check((await latest('status'))?.line === 5 && (await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'openLink').length)) === 0,
      'The encoded Chinese fragment did not navigate locally.');
    for (const label of ['未知链接', '坏链接']) {
      await editor.locator('.cm-md-link').filter({ hasText: label }).click({ modifiers: ['Control'] });
    }
    check(await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'openLink').length) === 0,
      'Unknown or malformed anchors were forwarded as external links.');

    // The final paged entry remains reachable in a directory larger than 200 headings.
    if (!(await nav.isVisible())) await outlineToggle.click();
    const nextPage = nav.getByRole('button', { name: '下一页' });
    for (let pageIndex = 0; pageIndex < 20 && !(await nav.getByRole('button', { name: '目录 220', exact: true }).count()); pageIndex++) {
      if (!(await nextPage.isEnabled())) break;
      await nextPage.click();
    }
    const lastHeading = nav.getByRole('button', { name: '目录 220', exact: true });
    check(await lastHeading.count() === 1, 'The last entry in the long outline was not reachable by paging.');
    await lastHeading.click();
    check((await latest('status'))?.line === sourceLines.length * 2 - 1, 'The last paged entry did not navigate to its source offset.');
    const layout = await editor.evaluate(() => ({
      width: innerWidth,
      documentWidth: document.documentElement.scrollWidth,
      toolbar: document.querySelector('.marker-toolbar').getBoundingClientRect().toJSON(),
      editor: document.querySelector('.cm-editor').getBoundingClientRect().toJSON(),
    }));
    check(layout.documentWidth <= layout.width && layout.toolbar.right <= layout.width && layout.toolbar.left >= 0,
      'The outline or toolbar overflowed the viewport.');
    await editor.setViewportSize({ width: 1440, height: 900 });
    await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const docked = await editor.evaluate(() => ({
      paper: document.querySelector('.cm-content').getBoundingClientRect().toJSON(),
      panel: document.querySelector('.marker-outline').getBoundingClientRect().toJSON(),
    }));
    check(docked.paper.width >= 640 && docked.paper.right + 16 <= docked.panel.left, 'The wide outline covered the paper or made it too narrow.');
    await editor.screenshot({ path: 'D:/marker/artifacts/reading-ui/u3-outline-wide.png' });
    await editor.setViewportSize({ width: 720, height: 900 });
    if (await nav.isVisible()) await nav.getByRole('button', { name: '关闭文档大纲' }).click();
    await outlineToggle.click();
    const previousPage = nav.getByRole('button', { name: '上一页' });
    while (await previousPage.isEnabled()) await previousPage.click();
    await nav.getByRole('button', { name: '重复标题', exact: true }).first().click();
    const toolbarBottom = await toolbar.boundingBox().then(box => box ? box.y + box.height : 0);
    const firstHeadingTop = await editor.locator('.cm-md-h1').first().boundingBox().then(box => box?.y ?? Infinity);
    check(await editor.evaluate(() => document.documentElement.scrollWidth <= innerWidth) && firstHeadingTop >= toolbarBottom - 2,
      'At 720px, the page overflowed or the toolbar covered the navigated heading.');
    await editor.screenshot({ path: 'D:/marker/artifacts/reading-ui/u3-outline-narrow.png' });

    // Editing invalidates old offsets; a fresh version restores navigation.
    await editor.locator('.cm-content').click();
    await editor.keyboard.press('Control+End');
    await editor.keyboard.press('Enter');
    await editor.keyboard.insertText('编辑后');
    const edited = await snapshot();
    const editedVersion = await editor.evaluate(() => window.markerTest.sent.filter(message => message.type === 'changes').at(-1).version);
    check(await nav.locator('.marker-outline-heading').count() === 0, 'Editing left stale outline positions available.');
    await send({ type: 'outline', version: editedVersion - 1, headings });
    check(await nav.locator('.marker-outline-heading').count() === 0, 'An old outline version restored stale navigation after editing.');
    const freshHeadings = headings.map(item => ({ ...item }));
    await send({ type: 'outline', version: editedVersion, headings: freshHeadings });
    if (!(await nav.isVisible())) await outlineToggle.click();
    check(await nav.getByRole('button', { name: '重复标题', exact: true }).count() === 2, 'A current-version outline did not restore after editing.');
    check(await snapshot() === edited, 'Refreshing the outline changed the edited source.');

    // Focus mode preserves explicitly hidden actions and keeps save/settings/exit and error status available.
    await send({ type: 'settings', theme: 'light', fontSize: 15, lineHeight: 1.5, lineWrapping: true, hiddenToolbarActions: ['undo'] });
    const more = toolbar.locator('.marker-toolbar-more summary');
    await more.click();
    await toolbar.locator('.marker-toolbar-menu [data-action="toggleFocus"]').click();
    const action = name => toolbar.locator(`[data-action="${name}"]`).first();
    check(await action('save').isVisible() && await action('settings').isVisible() && await action('toggleFocus').isVisible(),
      'Focus mode hid save, settings, or the exit control.');
    check(await action('undo').isHidden(), 'Focus mode changed the persisted hidden-actions setting.');
    await action('save').click();
    check((await latest('command'))?.command === 'save', 'Save stopped working in focus mode.');
    await send({ type: 'toolbarState', title: '', notification: '保存失败：测试错误', busy: false });
    check(await editor.locator('.marker-toolbar-notification').getByText('保存失败：测试错误').isVisible(), 'The save error status was hidden in focus mode.');
    await editor.screenshot({ path: 'D:/marker/artifacts/reading-ui/u3-focus.png' });
    await action('toggleFocus').click();
    check(await action('undo').isHidden() && await action('save').isVisible() && await action('settings').isVisible(),
      'Exiting focus mode did not restore the prior hidden-actions state.');

    // Source-mode changes retain the undo history for the edit made above.
    await editor.locator('.cm-content').click();
    await editor.keyboard.press('Control+End');
    await editor.keyboard.insertText(' 历史');
    const historyText = await snapshot();
    await editor.keyboard.press('Control+Alt+m');
    await editor.keyboard.press('Control+Alt+m');
    await editor.keyboard.press('Control+z');
    check(await snapshot() === edited, 'Switching source mode rebuilt or discarded the undo history.');
    check(historyText !== edited && errors.length === 0, `Unexpected browser error or missing edit: ${errors.join('; ')}`);
    return { passed: true, checks: [
      'outline-collapsed-and-keyboard-close-focus', 'invalid-outline-atomicity', 'duplicate-title-offset-and-no-doc-history-change',
      'encoded-local-and-invalid-fragment-links', 'paged-outline-over-200-and-720px-toolbar-clearance',
      'stale-version-invalidation-and-fresh-version-restore', 'temporary-focus-mode-preserves-hidden-actions-and-status',
      'source-mode-preserves-undo-history', 'return-selection-and-copy-chapter-anchor',
    ] };
  } finally { await context.close(); }
}
