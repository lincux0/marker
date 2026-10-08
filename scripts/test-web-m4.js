// Run with Playwright MCP browser_run_code_unsafe (filename).
// Requires the production Web dist on 127.0.0.1:5173.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const context = await page.context().browser().newContext({ viewport: { width: 1000, height: 760 } });
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = {
      sent: [],
      additional: [],
      receive: data => handlers.forEach(handler => handler({ data }))
    };
    window.chrome = { webview: {
      postMessage: data => window.markerTest.sent.push(data),
      postMessageWithAdditionalObjects: (message, objects) => window.markerTest.additional.push({ message, objects }),
      addEventListener: (type, handler) => { if (type === 'message') handlers.push(handler); }
    } };
  });
  const editor = await context.newPage();
  let stage = 'editor load';
  try {
    await editor.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await editor.goto('http://127.0.0.1:5173/index.html');
    await editor.waitForFunction(() => window.markerTest?.sent.some(message => message.type === 'ready'));
    const sessionId = '44444444444444444444444444444444';
    const sendEditor = message => editor.evaluate(message => window.markerTest.receive(message), message);
    await sendEditor({ type: 'initialize', protocolVersion: 1, sessionId, text: '' });
    await editor.locator('#editor .cm-content').waitFor();
    await editor.waitForFunction(() => window.markerTest.sent.some(message => message.type === 'snapshot'));

    stage = 'host motion and high-contrast settings';
    await sendEditor({
      type: 'settings', protocolVersion: 1, sessionId, theme: 'light',
      fontSize: 15, lineHeight: 1.65, lineWrapping: true, reducedMotion: true, highContrast: true
    });
    const initial = await editor.evaluate(() => ({
      empty: document.querySelector('#editor').dataset.empty,
      hint: getComputedStyle(document.querySelector('#editor'), '::after').content,
      reducedMotion: document.documentElement.dataset.reducedMotion,
      highContrast: document.documentElement.dataset.highContrast,
      foreground: getComputedStyle(document.querySelector('#editor')).color,
      background: getComputedStyle(document.querySelector('#editor')).backgroundColor
    }));
    check(initial.empty === 'true' && initial.hint.includes('Ctrl + Enter'), 'empty document shows the writing hint');
    check(initial.reducedMotion === 'true' && initial.highContrast === 'true', 'host accessibility flags are applied');
    check(initial.foreground !== initial.background, 'editor text remains distinguishable in forced-colors mode');

    stage = 'reduced motion';
    const motion = await editor.evaluate(() => {
      const seconds = value => Math.max(...value.split(',').map(part => {
        const number = parseFloat(part) || 0;
        return part.trim().endsWith('ms') ? number / 1000 : number;
      }));
      return [...document.querySelectorAll('*')].flatMap(element => {
        const style = getComputedStyle(element);
        return [seconds(style.animationDuration), seconds(style.transitionDuration)];
      });
    });
    check(motion.every(duration => duration <= 0.00001), 'reduced-motion setting stops editor animations and transitions');

    stage = 'search panel and keyboard focus';
    await editor.locator('#editor .cm-content').click();
    await editor.keyboard.press('Control+h');
    const replace = editor.locator('.cm-search-panel input[type="text"]');
    await replace.waitFor();
    await editor.waitForFunction(() => document.activeElement?.getAttribute('aria-label') === '替换为');
    const searchStyle = await replace.evaluate(element => ({
      foreground: getComputedStyle(element).color,
      background: getComputedStyle(element).backgroundColor,
      outlineStyle: getComputedStyle(element).outlineStyle,
      outlineWidth: getComputedStyle(element).outlineWidth
    }));
    check(searchStyle.foreground !== searchStyle.background, 'search input keeps readable forced-colors contrast');
    check(searchStyle.outlineStyle !== 'none' && searchStyle.outlineWidth !== '0px', 'keyboard focus has a visible search-panel focus ring');
    await editor.getByRole('button', { name: '关闭', exact: true }).click();

    stage = 'document and history survive settings';
    await editor.locator('#editor .cm-content').click();
    await editor.keyboard.insertText('draft');
    check(await editor.locator('#editor').getAttribute('data-empty') === 'false', 'typing dismisses the empty-document hint');
    await sendEditor({
      type: 'settings', protocolVersion: 1, sessionId, theme: 'dark',
      fontSize: 18, lineHeight: 1.8, lineWrapping: false, reducedMotion: true, highContrast: true
    });
    check((await editor.locator('#editor .cm-content').innerText()).includes('draft'), 'settings preserve the current document');
    await sendEditor({ type: 'editorCommand', protocolVersion: 1, sessionId, command: 'undo' });
    check(await editor.locator('#editor').getAttribute('data-empty') === 'true', 'settings preserve editor undo history');

    stage = 'status accessibility contrast';
    await editor.locator('#editor .cm-content').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true })));
    await sendEditor({ type: 'editorCommand', protocolVersion: 1, sessionId, command: 'undo' });
    const status = editor.locator('#status');
    await editor.waitForFunction(() => !document.querySelector('#status').hidden);
    const statusStyle = await status.evaluate(element => ({
      visible: element.getBoundingClientRect().width > 0,
      foreground: getComputedStyle(element).color,
      background: getComputedStyle(element).backgroundColor,
      borderWidth: getComputedStyle(element).borderTopWidth,
      borderStyle: getComputedStyle(element).borderTopStyle
    }));
    check(statusStyle.visible && statusStyle.foreground !== statusStyle.background &&
      statusStyle.borderStyle !== 'none' && statusStyle.borderWidth !== '0px',
      'status remains visible with distinct text and border in forced-colors mode');
    await editor.locator('#editor .cm-content').evaluate(element => element.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true })));

    stage = 'native file object handoff';
    const fileDrop = await editor.evaluate(() => {
      const content = document.querySelector('#editor .cm-content');
      const textBefore = content.textContent;
      const changesBefore = window.markerTest.sent.filter(message => message.type === 'changes').length;
      const file = new File(['must not enter the JSON message'], 'notes.md', { type: 'text/markdown' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      const dragover = new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer });
      content.dispatchEvent(dragover);
      const feedback = document.documentElement.dataset.fileDrag;
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      content.dispatchEvent(drop);
      const sent = window.markerTest.additional.at(-1);
      return {
        accepted: dragover.defaultPrevented && feedback === 'true' && drop.defaultPrevented,
        dragoverPrevented: dragover.defaultPrevented,
        dragoverTypes: [...dragover.dataTransfer.types],
        dragoverFiles: dragover.dataTransfer.files.length,
        dragoverEffect: dragover.dataTransfer.dropEffect,
        dropPrevented: drop.defaultPrevented,
        cleared: !document.documentElement.hasAttribute('data-file-drag'),
        fileIdentity: sent?.objects?.[0] === file,
        fileType: sent?.objects?.[0] instanceof File,
        message: sent?.message,
        textBefore,
        textAfter: content.textContent,
        changesBefore,
        changesAfter: window.markerTest.sent.filter(message => message.type === 'changes').length
      };
    });
    check(fileDrop.accepted && fileDrop.cleared, 'file drag feedback accepts only file drops and clears on release: ' + JSON.stringify(fileDrop));
    check(fileDrop.fileType && fileDrop.fileIdentity && fileDrop.message?.sessionId === sessionId &&
      fileDrop.message.protocolVersion === 1 && fileDrop.message.type === 'filesDropped' && fileDrop.message.count === 1,
      'file objects are passed separately with only the current session and count in JSON');
    check(!('paths' in fileDrop.message) && !('version' in fileDrop.message) &&
      fileDrop.textBefore === fileDrop.textAfter && fileDrop.changesBefore === fileDrop.changesAfter,
      'drop neither serializes file paths nor edits the current document');
    const countBeforeOversize = await editor.evaluate(() => window.markerTest.additional.length);
    await editor.evaluate(() => {
      const transfer = new DataTransfer();
      for (let index = 0; index < 65; index++) transfer.items.add(new File([], 'file-' + index + '.md'));
      document.querySelector('#editor .cm-content').dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer }));
    });
    check(await editor.evaluate(() => window.markerTest.additional.length) === countBeforeOversize, 'drops above 64 files are not forwarded');

    stage = 'normal dark syntax contrast';
    await editor.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
    await sendEditor({ type: 'settings', protocolVersion: 1, sessionId, theme: 'dark', fontSize: 16,
      lineHeight: 1.5, lineWrapping: true, reducedMotion: false, highContrast: false });
    await editor.locator('.cm-content').click();
    await editor.keyboard.insertText('# 标题\n\n`代码`');
    const contrast = await editor.evaluate(() => {
      const luminance = color => {
        const values = color.match(/\d+/g).slice(0, 3).map(Number).map(value => {
          const c = value / 255;
          return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
        });
        return values[0] * 0.2126 + values[1] * 0.7152 + values[2] * 0.0722;
      };
      const background = luminance(getComputedStyle(document.querySelector('#editor')).backgroundColor);
      return [...document.querySelectorAll('.cm-content span')].map(span => {
        const foreground = luminance(getComputedStyle(span).color);
        return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
      });
    });
    check(contrast.length > 0 && contrast.every(ratio => ratio >= 4.5), 'dark Markdown tokens retain readable contrast');

    stage = 'preview accessibility and plain code';
    const preview = await context.newPage();
    await preview.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await preview.goto('http://127.0.0.1:5173/preview.html');
    await preview.waitForFunction(() => window.markerTest?.sent.some(message => message.type === 'ready'));
    const previewSession = '55555555555555555555555555555555';
    const sendPreview = message => preview.evaluate(message => window.markerTest.receive(message), message);
    await sendPreview({
      type: 'initialize', protocolVersion: 1, sessionId: previewSession,
      settings: { theme: 'light', fontSize: 16, lineHeight: 1.72, lineWrapping: true, reducedMotion: true, highContrast: true }
    });
    await sendPreview({
      type: 'render', protocolVersion: 1, sessionId: previewSession, version: 1,
      html: '<h1>高对比阅读</h1><p>正文保持清楚。</p><pre><code class="language-csharp">const marker = true;</code></pre>',
      outline: [{ id: 'heading-高对比阅读', text: '高对比阅读', level: 1, offset: 0 }]
    });
    await preview.locator('#preview pre code').waitFor();
    await preview.locator('#outline summary').click();
    const previewState = await preview.evaluate(() => {
      const body = getComputedStyle(document.body);
      const outline = getComputedStyle(document.querySelector('#outline summary'));
      const code = document.querySelector('#preview pre code');
      const pre = getComputedStyle(code.parentElement);
      const seconds = value => Math.max(...value.split(',').map(part => {
        const number = parseFloat(part) || 0;
        return part.trim().endsWith('ms') ? number / 1000 : number;
      }));
      const durations = [...document.querySelectorAll('*')].flatMap(element => {
        const style = getComputedStyle(element);
        return [seconds(style.animationDuration), seconds(style.transitionDuration)];
      });
      return {
        highContrast: document.documentElement.dataset.highContrast,
        reducedMotion: document.documentElement.dataset.reducedMotion,
        outlineVisible: document.querySelector('#outline nav').getBoundingClientRect().height > 0,
        outlineContrast: outline.color !== body.backgroundColor,
        codeContrast: pre.color !== pre.backgroundColor,
        codeText: code.textContent,
        codeSpans: code.querySelectorAll('span').length,
        durations
      };
    });
    check(previewState.highContrast === 'true' && previewState.reducedMotion === 'true', 'preview receives host accessibility flags');
    check(previewState.outlineVisible && previewState.outlineContrast, 'expanded outline is visible with high-contrast text');
    check(previewState.codeContrast && previewState.codeText === 'const marker = true;' && previewState.codeSpans === 0,
      'unsupported language stays readable plain code in forced-colors mode');
    check(previewState.durations.every(duration => duration <= 0.00001), 'reduced-motion setting stops preview animations and transitions');
    const previewDrop = await preview.evaluate(() => {
      const file = new File(['image bytes are not read by the page'], 'image.png', { type: 'image/png' });
      const transfer = new DataTransfer();
      transfer.items.add(file);
      document.querySelector('#preview').dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: transfer }));
      const feedback = document.documentElement.dataset.fileDrag;
      const drop = new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: transfer });
      document.querySelector('#preview').dispatchEvent(drop);
      const sent = window.markerTest.additional.at(-1);
      return {
        accepted: feedback === 'true' && drop.defaultPrevented,
        cleared: !document.documentElement.hasAttribute('data-file-drag'),
        fileIdentity: sent?.objects?.[0] === file && sent.objects[0] instanceof File,
        message: sent?.message,
        text: document.querySelector('#preview').innerText
      };
    });
    check(previewDrop.accepted && previewDrop.cleared && previewDrop.fileIdentity &&
      previewDrop.message?.sessionId === previewSession && previewDrop.message.count === 1 && previewDrop.message.type === 'filesDropped',
      'preview forwards the dropped File separately using its ready session');
    check(previewDrop.text.includes('const marker = true;'), 'preview drop leaves rendered content untouched');

    return {
      passed: true,
      checks: [
        'empty-document writing hint', 'host reduced-motion and high-contrast flags',
        'search focus ring and document/history preservation', 'forced-colors status contrast',
        'high-contrast outline and plain-code readability', 'reduced-motion transition/animation durations',
        'additional File objects forwarded separately from JSON in both pages', 'normal dark Markdown token contrast'
      ]
    };
  } catch (error) {
    throw new Error(String(stage) + ': ' + error.message);
  } finally {
    await context.close();
  }
}
