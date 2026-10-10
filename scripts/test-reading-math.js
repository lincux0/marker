// Run with Playwright MCP browser_run_code_unsafe (filename) against Vite at 127.0.0.1:5173.
async (page) => {
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const externalRequests = [];
  page.on("request", request => { if (request.url().includes("example.invalid")) externalRequests.push(request.url()); });
  await page.goto("http://127.0.0.1:5173/index.html");
  const result = await page.evaluate(async () => {
    const { MathWidget, renderMath } = await import("/src/math.ts");
    const container = document.createElement("main");
    const addMath = (display, tex) => {
      const node = document.createElement(display ? "div" : "span");
      node.className = "math";
      node.textContent = tex;
      container.append(node);
      return node;
    };
    document.body.append(container);
    const roots = addMath(false, "\\sqrt{x}");
    const arrow = addMath(true, "\\[a\\xrightarrow{n}b\\]");
    const malicious = [
      "\\href{javascript:alert(1)}{x}",
      "\\includegraphics{https://example.invalid/image}",
      "\\htmlStyle{background:url(https://example.invalid/x)}{x}",
    ].map(tex => addMath(false, tex));
    renderMath(container);
    const editorWidget = new MathWidget("x+1", false, 23).toDOM();
    const offsets = [];
    editorWidget.addEventListener("marker-rich-edit", event => { offsets.push(event.detail.offset); });
    editorWidget.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    editorWidget.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
    const overflow = new MathWidget("x".repeat(8193), false, 0).toDOM();
    const malformed = new MathWidget("\\frac{", false, 0).toDOM();
    const macroDefinition = new MathWidget("\\def\\marker{x}\\marker", false, 0).toDOM();
    const isolatedMacro = new MathWidget("\\marker", false, 0).toDOM();
    const expansionLimit = new MathWidget("\\def\\loop{\\loop}\\loop", false, 0).toDOM();
    const sizeLimit = new MathWidget("\\rule{100em}{1em}", false, 0).toDOM();
    const renderedCount = container.querySelectorAll(".katex").length;
    return {
      inlineRendered: !!roots.querySelector(".katex"),
      blockRendered: !!arrow.querySelector(".katex"),
      svg: [...container.querySelectorAll(".katex svg")].map(node => ({
        path: !!node.querySelector("path"),
        visible: node.getBoundingClientRect().width > 0 && node.getBoundingClientRect().height > 0,
      })),
      mathml: !!roots.querySelector(".katex math") && !!arrow.querySelector(".katex math"),
      dangerousElements: container.querySelectorAll("a[href], img, iframe, script, foreignObject, use, svg [href], [onclick], [onload]").length,
      unsafeStyles: [...container.querySelectorAll("[style]")].filter(node => /(?:url\s*\(|@import\b|expression\s*\()/i.test(node.getAttribute("style"))).length,
      maliciousSources: malicious.map(node => node.querySelector(".marker-math-source")?.textContent ?? ""),
      idempotent: (renderMath(container), container.querySelectorAll(".katex").length === renderedCount),
      offsets,
      widgetA11y: editorWidget.tabIndex === 0 && editorWidget.getAttribute("role") === "group",
      overflowLength: overflow.querySelector(".marker-math-source")?.textContent.length,
      malformedSource: malformed.querySelector(".marker-math-source")?.textContent,
      macroDefinitionRendered: !!macroDefinition.querySelector(".katex math"),
      isolatedMacroSource: isolatedMacro.querySelector(".marker-math-source")?.textContent,
      expansionLimitSource: expansionLimit.querySelector(".marker-math-source")?.textContent,
      sizeBound: sizeLimit.querySelector(".katex-rule")?.getAttribute("style"),
    };
  });
  check(result.inlineRendered && result.blockRendered, "inline and block preview math render");
  check(result.svg.length === 2 && result.svg.every(svg => svg.path && svg.visible), "sqrt and long arrows retain visible SVG paths");
  check(result.mathml, "sqrt and long-arrow formulas retain MathML output");
  check(result.dangerousElements === 0 && result.unsafeStyles === 0, "untrusted math emits no active or external HTML/SVG");
  check(result.maliciousSources[2] === "\\htmlStyle{background:url(https://example.invalid/x)}{x}", "rejected HTML styling retains the complete source");
  check(externalRequests.length === 0, "untrusted formulas trigger no external requests");
  check(result.idempotent, "preview rendering is idempotent");
  check(result.offsets.length === 2 && result.offsets.every(offset => offset === 23), "click and Enter report the original editor offset");
  check(result.widgetA11y, "formula widget remains keyboard reachable and labeled");
  check(result.overflowLength === 8193, "oversized input remains fully visible");
  check(result.malformedSource === "\\frac{", "invalid TeX remains fully visible");
  check(result.macroDefinitionRendered && result.isolatedMacroSource === "\\marker", "macros do not persist between formulas");
  check(result.expansionLimitSource === "\\def\\loop{\\loop}\\loop", "macro expansion limit keeps the full source visible");
  check(result.sizeBound?.includes("50em") && !result.sizeBound.includes("100em"), "maxSize bounds oversized dimensions");
  return result;
}
