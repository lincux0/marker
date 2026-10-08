// Existing Playwright MCP snippet; use only the test Marker CDP endpoint.
// Controlled browser paste events, not an OS clipboard/IME or frame-rate guarantee.
async (page) => {
  const browser = await page.context().browser().browserType().connectOverCDP('http://127.0.0.1:9222');
  const context = browser.contexts()[0];
  const editor = context.pages().find(p => p.url() === 'https://editor.marker.example/index.html');
  const preview = context.pages().find(p => p.url() === 'https://preview.marker.example/preview.html');
  if (!editor || !preview) throw new Error('Expected test Marker pages');
  const measurements = [];
  for (const size of [65536, 262144, 1000000]) {
    const prefix = '# M3 performance 中文 😀\n\n';
    const paragraph = 'A paragraph with **bold**, `code` and ordinary Markdown text. '.repeat(3) + '\n\n';
    const tail = `\n\nM3_TAIL_${size}`;
    const text = prefix + paragraph.repeat(Math.ceil(size / paragraph.length)).slice(0, size - prefix.length - tail.length) + tail;
    const started = Date.now();
    try {
      await editor.locator('.cm-content').click();
      await editor.keyboard.press('Control+a');
      await editor.evaluate(text => {
        const transfer = new DataTransfer();
        transfer.setData('text/plain', text);
        const event = new ClipboardEvent('paste', { bubbles: true, cancelable: true, clipboardData: transfer });
        document.querySelector('.cm-content').dispatchEvent(event);
        if (!event.defaultPrevented) throw new Error('CodeMirror did not handle paste');
      }, text);
      await preview.waitForFunction(marker => document.querySelector('#preview')?.textContent?.includes(marker), `M3_TAIL_${size}`, { timeout: 30000 });
    } catch (error) {
      return { passed: false, failedSize: size, measurements, error: error.message.split('\n')[0] };
    }
    const inputToPreviewMs = Date.now() - started;
    await editor.keyboard.press('Control+End');
    const marker = `M3_EDIT_${size}`;
    const editStarted = Date.now();
    await editor.keyboard.insertText(marker);
    await preview.waitForFunction(marker => document.querySelector('#preview')?.textContent?.includes(marker), marker, { timeout: 30000 });
    measurements.push({ utf16Units: text.length, inputToPreviewMs, singleEditToPreviewMs: Date.now() - editStarted, htmlUnits: await preview.locator('#preview').evaluate(element => element.innerHTML.length) });
  }
  return { passed: true, measurements, limits: 'Synthetic paste and a short keyboard insertion; single samples include CDP and host 100 ms quiet window. Not OS clipboard, continuous typing, IME or a performance guarantee.' };
}
