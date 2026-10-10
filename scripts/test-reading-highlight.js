// Run with Playwright MCP browser_run_code_unsafe (filename) against the built Web app at 127.0.0.1:5173.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const context = await page.context().browser().newContext({ viewport: { width: 1000, height: 760 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5173" });
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = {
      sent: [],
      receive: data => handlers.forEach(handler => handler({ data })),
    };
    window.chrome = { webview: {
      postMessage: data => window.markerTest.sent.push(data),
      addEventListener: (type, handler) => { if (type === "message") handlers.push(handler); },
    } };
  });
  const editor = await context.newPage();
  let stage = "editor load";
  let sessionId = "66666666666666666666666666666666";
  const source = [
    "```javascript",
    'const jsValue = "JAVASCRIPT_TOKEN";',
    "```",
    "",
    "```typescript",
    "type MarkerShape = { width: number };",
    "```",
    "",
    "```python",
    "def marker_python(value: int) -> int:",
    "    return value + 1",
    "```",
    "",
    "```json",
    '{ "marker": true, "count": 3 }',
    "```",
    "",
    "```csharp",
    "public class Marker { public int Value => 1; }",
    "```",
    "",
    "```shell",
    "#!/bin/sh",
    'echo "SHELL_TOKEN"',
    "```",
    "",
    "```not-a-language",
    "plain_unknown_token <literal>",
    "```",
  ].join("\n");
  const send = message => editor.evaluate(message => window.markerTest.receive(message), message);
  const snapshot = async requestId => {
    await send({ type: "requestSnapshot", protocolVersion: 1, sessionId, requestId });
    await editor.waitForFunction(id => window.markerTest.sent.some(message => message.type === "snapshot" && message.requestId === id), requestId);
    return editor.evaluate(id => window.markerTest.sent.findLast(message => message.type === "snapshot" && message.requestId === id), requestId);
  };
  try {
    await editor.emulateMedia({ forcedColors: "none", reducedMotion: "no-preference" });
    await editor.goto("http://127.0.0.1:5173/index.html");
    await editor.waitForFunction(() => window.markerTest?.sent.some(message => message.type === "ready"));
    await send({ type: "initialize", protocolVersion: 1, sessionId, text: source });
    await editor.locator("#editor .cm-content").waitFor();
    await editor.waitForFunction(() => window.markerTest.sent.some(message => message.type === "snapshot"));
    await send({ type: "settings", protocolVersion: 1, sessionId, theme: "dark", fontSize: 16,
      lineHeight: 1.5, lineWrapping: true, highContrast: false });

    stage = "language highlighting and unknown-language fallback";
    const languages = await editor.evaluate(() => [...document.querySelectorAll(".cm-md-code-language")].map(label => {
      const header = label.closest(".cm-line");
      const lines = [];
      let line = header?.nextElementSibling;
      while (line?.classList.contains("cm-md-code-line")) {
        lines.push(line);
        if (line.classList.contains("cm-md-code-last")) break;
        line = line.nextElementSibling;
      }
      return {
        name: label.textContent,
        text: lines.map(item => item.textContent).join("\n"),
        tokens: lines.reduce((count, item) => {
          const lineColor = getComputedStyle(item).color;
          return count + [...item.querySelectorAll("span")].filter(token => getComputedStyle(token).color !== lineColor).length;
        }, 0),
      };
    }));
    for (const language of ["javascript", "typescript", "python", "json", "csharp", "shell"]) {
      const result = languages.find(item => item.name === language);
      check(result && result.tokens > 0, `${language} code receives syntax highlighting`);
    }
    const unknown = languages.find(item => item.name === "not-a-language");
    check(unknown && unknown.text === "plain_unknown_token <literal>" && unknown.tokens === 0,
      "unknown language remains readable as plain code");

    stage = "copy fidelity";
    await editor.locator(".cm-md-code-copy").first().click();
    await editor.getByRole("button", { name: "复制代码" }).first().waitFor();
    await editor.waitForFunction(() => document.querySelector("#status")?.textContent === "代码已复制。");
    const copied = (await editor.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
    check(copied === 'const jsValue = "JAVASCRIPT_TOKEN";\n', "copy preserves exact code text and trailing newline");

    stage = "source view and document fidelity";
    await send({ type: "editorCommand", protocolVersion: 1, sessionId, command: "toggleSource" });
    await editor.waitForFunction(() => document.querySelector("#editor .cm-editor").dataset.sourceMode === "true");
    check((await snapshot("source-snapshot")).text === source, "source view preserves the exact Markdown document");
    await send({ type: "editorCommand", protocolVersion: 1, sessionId, command: "toggleSource" });
    await editor.waitForFunction(() => document.querySelector("#editor .cm-editor").dataset.sourceMode === "false");

    stage = "undo fidelity";
    await editor.locator("#editor .cm-content").click();
    await editor.keyboard.press("Control+End");
    await editor.keyboard.insertText("temporary edit");
    check((await snapshot("edited-snapshot")).text.endsWith("temporary edit"), "edit is recorded before undo");
    await editor.keyboard.press("Control+z");
    check((await snapshot("undo-snapshot")).text === source, "undo restores the exact original Markdown");

    stage = "dark and high-contrast presentation";
    await editor.evaluate(() => {
      const luminance = color => {
        const rgb = color.match(/\d+/g).slice(0, 3).map(Number).map(value => {
          const channel = value / 255;
          return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
        });
        return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
      };
      const editorElement = document.querySelector("#editor");
      const background = luminance(getComputedStyle(editorElement).backgroundColor);
      return [...editorElement.querySelectorAll(".cm-md-code-line")].flatMap(line => {
        const lineColor = getComputedStyle(line).color;
        return [...line.querySelectorAll("span")].filter(token => getComputedStyle(token).color !== lineColor).map(token => {
          const foreground = luminance(getComputedStyle(token).color);
          return (Math.max(background, foreground) + 0.05) / (Math.min(background, foreground) + 0.05);
        });
      });
    }).then(ratios => check(ratios.length > 0 && ratios.every(ratio => ratio >= 4.5), "dark syntax colors remain readable"));
    await editor.emulateMedia({ forcedColors: "active" });
    await send({ type: "settings", protocolVersion: 1, sessionId, theme: "dark", fontSize: 16,
      lineHeight: 1.5, lineWrapping: true, highContrast: true });
    const contrast = await editor.evaluate(() => {
      const editorElement = document.querySelector("#editor");
      return {
        theme: editorElement.dataset.theme,
        highContrast: document.documentElement.dataset.highContrast,
        foreground: getComputedStyle(editorElement).color,
        background: getComputedStyle(editorElement).backgroundColor,
      };
    });
    check(contrast.theme === "dark" && contrast.highContrast === "true" && contrast.foreground !== contrast.background,
      "dark high-contrast mode keeps editor text distinct from its background");

    stage = "large fenced-code fallback and recovery";
    const longSessionId = "77777777777777777777777777777777";
    const longCode = `const markerLong = "${"x".repeat(104000)}";`;
    const longDocument = `\`\`\`javascript\n${longCode}\n\`\`\``;
    sessionId = longSessionId;
    await send({ type: "initialize", protocolVersion: 1, sessionId, text: longDocument });
    await editor.waitForFunction(() => document.querySelector("#editor .cm-editor") !== null);
    await editor.waitForFunction(() => window.markerTest.sent.some(message => message.type === "snapshot" && message.text.length > 100000));
    const longBlock = editor.locator(".cm-md-code-language").filter({ hasText: "javascript" }).first();
    await longBlock.waitFor();
    const unhighlighted = await editor.evaluate(() => {
      const line = document.querySelector(".cm-md-code-line");
      const foreground = getComputedStyle(line).color;
      return [...line.querySelectorAll("span")].filter(token => getComputedStyle(token).color !== foreground).length;
    });
    check(unhighlighted === 0, "large fenced code falls back to plain text without token parsing");
    await editor.locator(".cm-md-code-copy").first().click();
    await editor.waitForFunction(() => document.querySelector("#status")?.textContent === "代码已复制。");
    const copiedLongMatches = await editor.evaluate(expected => navigator.clipboard.readText().then(text => text.replace(/\r\n/g, "\n") === expected), `${longCode}\n`);
    check(copiedLongMatches, "large plain-code fallback copies the exact source and trailing newline");
    await send({ type: "editorCommand", protocolVersion: 1, sessionId, command: "toggleSource" });
    await editor.waitForFunction(() => document.querySelector("#editor .cm-editor").dataset.sourceMode === "true");
    check((await snapshot("long-source-snapshot")).text === longDocument, "large source view preserves the complete document");
    await send({ type: "editorCommand", protocolVersion: 1, sessionId, command: "toggleSource" });
    await editor.waitForFunction(() => document.querySelector("#editor .cm-editor").dataset.sourceMode === "false");

    await send({ type: "editorCommand", protocolVersion: 1, sessionId, command: "toggleSource" });
    await editor.locator("#editor .cm-content").focus();
    const shortCode = longCode.slice(0, 99000);
    const shortDocument = `\`\`\`javascript
${shortCode}
\`\`\``;
    await editor.keyboard.press("Control+a");
    await editor.keyboard.insertText(shortDocument);
    await send({ type: "editorCommand", protocolVersion: 1, sessionId, command: "toggleSource" });
    check((await snapshot("short-snapshot")).text === shortDocument, "deleting the tail preserves surrounding Markdown");
    const highlightedAgain = await editor.evaluate(() => {
      const line = document.querySelector(".cm-md-code-line");
      const foreground = getComputedStyle(line).color;
      return [...line.querySelectorAll("span")].filter(token => getComputedStyle(token).color !== foreground).length;
    });
    check(highlightedAgain > 0, "crossing below 100K re-enables fenced-code highlighting");
    await editor.keyboard.press("Control+z");
    check((await snapshot("long-undo-snapshot")).text === longDocument, "undo restores the complete large document");
    const undoTokens = await editor.evaluate(() => {
      const line = document.querySelector(".cm-md-code-line");
      const foreground = getComputedStyle(line).color;
      return [...line.querySelectorAll("span")].filter(token => getComputedStyle(token).color !== foreground).length;
    });
    check(undoTokens === 0, "undo restores the large-document plain-code fallback");
    return { passed: true, languages: languages.map(item => item.name), checks: [
      "JavaScript, TypeScript, Python, JSON, C# and Shell highlighting", "unknown language plain-text fallback",
      "exact code copy", "source view and Markdown snapshot fidelity", "undo restores the original document",
      "dark syntax contrast and dark high-contrast readability", "large-code fallback, copy/source fidelity, threshold recovery and undo",
    ] };
  } catch (error) {
    throw new Error(`${stage}: ${error.message}`);
  } finally {
    await context.close();
  }
}
