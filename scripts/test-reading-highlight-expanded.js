// Run with the existing Playwright MCP browser_run_code_unsafe (filename) against the built Web app at 127.0.0.1:5173.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const samples = [
    ["html", '<main class="marker">HTML_TOKEN</main>'], ["xml", '<marker value="XML_TOKEN"/>'],
    ["css", "#marker { color: red; }"], ["sql", "SELECT marker_value FROM markers WHERE marker_id = 1;"],
    ["sqlite", "SELECT marker_value FROM markers WHERE marker_id = 1;"],
    ["postgres", "SELECT marker_value FROM markers WHERE marker_id = 1;"],
    ["postgresql", "SELECT marker_value FROM markers WHERE marker_id = 1;"],
    ["pgsql", "SELECT marker_value FROM markers WHERE marker_id = 1;"],
    ["mysql", "SELECT marker_value FROM markers WHERE marker_id = 1;"],
    ["c", "int main(void) { return 0; }"], ["cpp", "int main() { return 0; }"],
    ["c++", "int main() { return 0; }"], ["cxx", "int main() { return 0; }"],
    ["java", "class Marker { int value = 1; }"], ["kotlin", "fun marker() = 1"], ["kt", "fun marker() = 1"],
    ["go", 'package main\nfunc main() { println("go") }'], ["golang", 'package main\nfunc main() { println("go") }'],
    ["rust", "fn main() { let marker = 1; }"], ["rs", "fn main() { let marker = 1; }"],
    ["swift", 'let marker = "swift"'], ["php", '<?php echo "php";'], ["php", 'echo "php without opening tag";'],
    ["ruby", 'def marker\n  puts "ruby"\nend'], ["rb", 'def marker\n  puts "ruby"\nend'],
    ["yaml", "marker:\n  enabled: true"], ["yml", "marker:\n  enabled: true"],
    ["toml", "[marker]\nenabled = true"], ["ini", "[marker]\nenabled=true"],
    ["properties", "marker.enabled=true"], ["powershell", '$marker = "shell"\nWrite-Output $marker'],
    ["ps1", '$marker = "shell"\nWrite-Output $marker'], ["lua", 'local marker = "lua"'],
    ["dockerfile", "FROM alpine:3.20\nRUN echo marker"], ["docker", "FROM alpine:3.20\nRUN echo marker"],
    ["diff", "+added marker\n-removed marker"], ["patch", "+added marker\n-removed marker"],
  ];
  const context = await page.context().browser().newContext({ viewport: { width: 1000, height: 760 } });
  await context.grantPermissions(["clipboard-read", "clipboard-write"], { origin: "http://127.0.0.1:5173" });
  await context.addInitScript(() => {
    const handlers = [];
    window.markerTest = { sent: [], receive: data => handlers.forEach(handler => handler({ data })) };
    window.chrome = { webview: {
      postMessage: data => window.markerTest.sent.push(data),
      addEventListener: (type, handler) => { if (type === "message") handlers.push(handler); },
    } };
  });
  const editor = await context.newPage();
  const preview = await context.newPage();
  const send = (target, message) => target.evaluate(data => window.markerTest.receive(data), message);
  const pageErrors = [];
  editor.on("pageerror", error => pageErrors.push(`editor: ${error.message}`));
  preview.on("pageerror", error => pageErrors.push(`preview: ${error.message}`));
  const themes = ["light", "dark"];
  const settings = { type: "settings", protocolVersion: 1, fontSize: 16,
    lineHeight: 1.5, lineWrapping: true, highContrast: false };
  let stage = "load";
  let sessionIndex = 0;
  try {
    await Promise.all([editor.goto("http://127.0.0.1:5173/index.html"), preview.goto("http://127.0.0.1:5173/preview.html")]);
    await Promise.all([
      editor.waitForFunction(() => window.markerTest?.sent.some(message => message.type === "ready")),
      preview.waitForFunction(() => window.markerTest?.sent.some(message => message.type === "ready")),
    ]);
    const themeResults = [];
    for (const theme of themes) {
      const highlighted = [];
      let diffColors = null;
      for (const [language, code] of samples) {
      const sampleName = language === "php" && !code.startsWith("<?") ? "php without opening tag" : language;
      stage = `${theme}/${sampleName} editor highlighting`;
      const sessionId = (sessionIndex++).toString(16).padStart(32, "0");
      const markdown = `\`\`\`${language}\n${code}\n\`\`\``;
      await send(editor, { type: "initialize", protocolVersion: 1, sessionId, text: markdown });
      await send(editor, { ...settings, theme, sessionId });
      const label = editor.locator("#editor .cm-md-code-language");
      await label.waitFor();
      await editor.waitForFunction(({ name, text }) =>
        document.querySelector("#editor .cm-md-code-language")?.textContent === name &&
        [...document.querySelectorAll("#editor .cm-md-code-line")].map(line => line.textContent).join("\n") === text,
        { name: language, text: code });
      check(await editor.locator("#editor").getAttribute("data-theme") === theme, `${theme} editor theme is active`);
      await editor.locator("#editor .cm-md-code-line").first().scrollIntoViewIfNeeded();
      const editorResult = await editor.evaluate(() => {
        const lines = [...document.querySelectorAll("#editor .cm-md-code-line")];
        const text = lines.map(line => line.textContent).join("\n");
        const spans = lines.flatMap(line => [...line.querySelectorAll("span")]);
        const base = lines[0] ? getComputedStyle(lines[0]).color : "";
        const diffColor = prefix => {
          const line = lines.find(item => item.textContent?.startsWith(prefix));
          return line && [...line.querySelectorAll("span")].map(span => getComputedStyle(span).color).find(color => color !== base);
        };
        return { text, tokens: spans.length, colored: spans.some(span => getComputedStyle(span).color !== base),
          insertedColor: diffColor("+"), deletedColor: diffColor("-") };
      });
      check(editorResult.text === code, `${language} editor preserves code text`);
      check(editorResult.tokens > 0, `${language} editor renders syntax tokens`);
      check(editorResult.colored, `${language} editor syntax tokens have visible colors`);
      if (language === "diff") {
        await editor.locator(".cm-md-code-copy").click();
        await editor.waitForFunction(() => document.querySelector("#status")?.textContent === "代码已复制。");
        const copied = (await editor.evaluate(() => navigator.clipboard.readText())).replace(/\r\n/g, "\n");
        check(copied === `${code}\n`, "Diff copy preserves plus/minus markers and trailing newline");
      }

      stage = `${theme}/${sampleName} hidden preview highlighting`;
      await send(preview, { type: "initialize", protocolVersion: 1, sessionId });
      await send(preview, { ...settings, theme, sessionId });
      const escaped = code.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
      await send(preview, {
        type: "render", protocolVersion: 1, sessionId, version: 1,
        html: `<pre><code class="language-${language}">${escaped}</code></pre>`, outline: [],
      });
      const previewCode = preview.locator("#preview pre > code");
      await previewCode.waitFor();
      await preview.waitForFunction(({ name, text }) => {
        const code = document.querySelector("#preview pre > code");
        return code?.dataset.language === name && code.textContent === text;
      }, { name: language, text: code });
      check(await preview.locator("html").getAttribute("data-theme") === theme, `${theme} preview theme is active`);
      const previewResult = await previewCode.evaluate(codeElement => ({
        text: codeElement.textContent,
        tokens: codeElement.querySelectorAll("span[class^='tok-']").length,
        colored: [...codeElement.querySelectorAll("span[class^='tok-']")].some(span => getComputedStyle(span).color !== getComputedStyle(codeElement).color),
        insertedColor: codeElement.querySelector(".tok-inserted") && getComputedStyle(codeElement.querySelector(".tok-inserted")).color,
        deletedColor: codeElement.querySelector(".tok-deleted") && getComputedStyle(codeElement.querySelector(".tok-deleted")).color,
        safeClasses: [...codeElement.querySelectorAll("span")].every(span => [...span.classList].every(name => /^tok-[a-zA-Z0-9]+$/.test(name))),
      }));
      check(previewResult.text === code, `${language} preview preserves exact code text`);
      check(previewResult.tokens > 0 && previewResult.safeClasses, `${language} preview emits safe syntax-token spans`);
      check(previewResult.colored, `${language} preview syntax tokens have visible colors`);
      if (language === "diff") {
        check(editorResult.insertedColor && editorResult.deletedColor && editorResult.insertedColor !== editorResult.deletedColor,
          `${theme} Diff editor colors distinguish inserted and deleted lines`);
        check(previewResult.insertedColor && previewResult.deletedColor && previewResult.insertedColor !== previewResult.deletedColor,
          `${theme} Diff preview colors distinguish inserted and deleted lines`);
        diffColors = { editor: [editorResult.insertedColor, editorResult.deletedColor], preview: [previewResult.insertedColor, previewResult.deletedColor] };
        await editor.screenshot({ path: `D:/marker/artifacts/reading-ui/highlight-expanded-${theme}.png`, fullPage: true });
      }
      highlighted.push(sampleName);
      }
      themeResults.push({ theme, languages: highlighted, diffColors });
    }
    check(pageErrors.length === 0, `editor and preview pages have no errors: ${pageErrors.join("; ")}`);
    return { passed: true, themes: themeResults };
  } catch (error) {
    throw new Error(`${stage}: ${error.message}`);
  } finally {
    await context.close();
  }
}
