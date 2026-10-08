// Run with the existing Playwright MCP browser_run_code_unsafe (filename).
// Serve Marker.Web production dist with Vite preview on 127.0.0.1:5173 first.
// This isolates CodeMirror + the page bridge mock from the native host/Markdig preview.
async (page) => {
  const context = await page.context().browser().newContext();
  await context.addInitScript(() => {
    const handlers = [];
    const nativeStringify = JSON.stringify.bind(JSON);
    const NativeTextEncoder = TextEncoder;
    window.markerPerf = { messages: [], stringifyMs: 0, stringifyCalls: 0, maxStringifyUnits: 0, encodeMs: 0, encodeCalls: 0, maxEncodedBytes: 0, longTasks: [] };
    JSON.stringify = (...args) => {
      const start = performance.now();
      const result = nativeStringify(...args);
      window.markerPerf.stringifyMs += performance.now() - start;
      window.markerPerf.stringifyCalls++;
      window.markerPerf.maxStringifyUnits = Math.max(window.markerPerf.maxStringifyUnits, result.length);
      return result;
    };
    window.TextEncoder = class extends NativeTextEncoder {
      encode(value) {
        const start = performance.now();
        const bytes = super.encode(value);
        window.markerPerf.encodeMs += performance.now() - start;
        window.markerPerf.encodeCalls++;
        window.markerPerf.maxEncodedBytes = Math.max(window.markerPerf.maxEncodedBytes, bytes.byteLength);
        return bytes;
      }
    };
    window.chrome = { webview: {
      postMessage(message) {
        window.markerPerf.messages.push({
          type: message.type,
          version: message.version,
          baseVersion: message.baseVersion,
          changeCount: message.changes?.length,
          insertedUnits: message.changes?.reduce((sum, change) => sum + change.insert.length, 0),
          textUnits: message.text?.length,
        });
      },
      addEventListener(type, handler) { if (type === 'message') handlers.push(handler); },
    } };
    window.markerTest = { receive: data => handlers.forEach(handler => handler({ data })) };
    if ('PerformanceObserver' in window) {
      try {
        new PerformanceObserver(list => window.markerPerf.longTasks.push(...list.getEntries().map(entry => entry.duration)))
          .observe({ type: 'longtask', buffered: true });
      } catch { /* Long Task API is optional in the selected browser build. */ }
    }
  });

  const results = [];
  const sessionId = '44444444444444444444444444444444';
  try {
    const sizes = [65536, 262144];
    for (const size of sizes) {
      const prefix = '# M3 bulk edit 中文 😀\n\n';
      const paragraph = 'A paragraph with **bold**, `code`, and ordinary Markdown text. '.repeat(3) + '\n\n';
      const tail = `\n\nTAIL_${size}`;
      const markdownText = prefix + paragraph.repeat(Math.ceil(size / paragraph.length)).slice(0, size - prefix.length - tail.length) + tail;
      const runEditor = async mode => {
        let editor;
        let started = Date.now();
        try {
          editor = await context.newPage();
          await editor.goto('http://127.0.0.1:5173/index.html');
          await editor.evaluate(sessionId => window.markerTest.receive({
            protocolVersion: 1, type: 'initialize', sessionId, text: '',
          }), sessionId);
          const content = editor.locator('#editor .cm-content');
          await content.waitFor();
          await content.click();
          const heapBefore = await editor.evaluate(() => performance.memory?.usedJSHeapSize ?? null);
          started = Date.now();
          if (mode === 'fill') {
            await content.fill(markdownText);
          } else {
            await content.press('Control+a');
            await editor.evaluate(text => {
              const transfer = new DataTransfer();
              transfer.setData('text/plain', text);
              const event = new ClipboardEvent('paste', {
                bubbles: true,
                cancelable: true,
                clipboardData: transfer,
              });
              document.querySelector('#editor .cm-content').dispatchEvent(event);
              if (!event.defaultPrevented) throw new Error('CodeMirror did not handle the synthetic paste event');
            }, markdownText);
          }
          const elapsedMs = Date.now() - started;
          await editor.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
          const details = await editor.evaluate(heapBefore => ({
            messages: window.markerPerf.messages,
            stringifyMs: window.markerPerf.stringifyMs,
            stringifyCalls: window.markerPerf.stringifyCalls,
            maxStringifyUnits: window.markerPerf.maxStringifyUnits,
            encodeMs: window.markerPerf.encodeMs,
            encodeCalls: window.markerPerf.encodeCalls,
            maxEncodedBytes: window.markerPerf.maxEncodedBytes,
            longTasks: window.markerPerf.longTasks,
            renderedLineNodes: document.querySelectorAll('.cm-line').length,
            heapBefore,
            heapAfter: performance.memory?.usedJSHeapSize ?? null,
          }), heapBefore);
          return { elapsedMs, details, errorCode: 0 };
        } catch (error) {
          return {
            elapsedMs: Date.now() - started,
            details: null,
            // 1 = Playwright timeout; 2 = other page/interaction failure.
            errorCode: error?.name === 'TimeoutError' ? 1 : 2,
          };
        } finally {
          if (editor) await editor.close();
        }
      };

      const fill = size <= 262144 ? await runEditor('fill') : null;
      const paste = await runEditor('paste');

      const control = size <= 262144 ? await context.newPage() : null;
      let textareaMs = null;
      let textareaErrorCode = 0;
      try {
        if (control) {
          await control.setContent('<textarea style="width:100%;height:100%"></textarea>');
          const start = Date.now();
          await control.locator('textarea').fill(markdownText);
          textareaMs = Date.now() - start;
        }
      } catch (error) {
        textareaErrorCode = error?.name === 'TimeoutError' ? 1 : 2;
      } finally {
        if (control) await control.close();
      }
      results.push({
        utf16Units: markdownText.length,
        editorFillMs: fill?.elapsedMs ?? null,
        editorFillErrorCode: fill?.errorCode ?? 0,
        editorPasteMs: paste.elapsedMs,
        editorPasteErrorCode: paste.errorCode,
        textareaFillMs: textareaMs,
        textareaFillErrorCode: textareaErrorCode,
        fill: fill?.details ?? null,
        paste: paste.details,
      });

      // Keep the potentially expensive 1 MiB trial conditional on paste being materially faster.
      if (size === 262144 && fill?.errorCode === 0 && paste.errorCode === 0 && paste.elapsedMs < fill.elapsedMs * 0.7) sizes.push(1048576);
    }
    return {
      passed: true,
      results,
      scope: 'Editor mock only: excludes WebView2 native message serialization, C# BridgeSession, Markdig, preview DOMPurify, and disk work. Timings are diagnostic samples, not release performance claims.',
    };
  } finally {
    await context.close();
  }
}
