import DOMPurify from "dompurify";
import katex from "katex";
import { WidgetType } from "@codemirror/view";
import "katex/dist/katex.min.css";
import "./math.css";

const maxTexLength = 8192;
const mathTags = [
  "span", "div", "math", "semantics", "annotation", "mrow", "mi", "mn", "mo", "mtext", "mspace",
  "msup", "msub", "msubsup", "mfrac", "msqrt", "mroot", "munder", "mover", "munderover",
  "mtable", "mtr", "mtd", "mpadded", "mstyle", "mphantom", "menclose", "mmultiscripts", "mprescripts", "none", "mglyph",
  "svg", "path", "line", "rect",
];
const mathAttributes = [
  "class", "style", "aria-hidden", "xmlns", "encoding", "mathvariant", "stretchy", "fence", "separator",
  "lspace", "rspace", "minsize", "maxsize", "accent", "accentunder", "displaystyle", "scriptlevel", "mathsize",
  "columnalign", "rowalign", "columnspacing", "rowspacing", "columnspan", "rowspan", "notation", "voffset", "mathbackground", "mathcolor",
  "depth", "width", "height", "largeop", "movablelimits", "symmetric", "linebreak", "form", "bevelled",
  "viewBox", "viewbox", "preserveAspectRatio", "d", "x", "y", "x1", "x2", "y1", "y2", "rx", "ry", "fill", "stroke", "stroke-width",
];

function sanitizedMath(tex: string, display: boolean): string {
  const html = DOMPurify.sanitize(katex.renderToString(tex, {
    displayMode: display,
    output: "htmlAndMathml",
    trust: false,
    strict: "error",
    throwOnError: true,
    maxExpand: 1000,
    maxSize: 50,
    macros: {},
  }), { ALLOWED_TAGS: mathTags, ALLOWED_ATTR: mathAttributes, ALLOW_DATA_ATTR: false });
  const template = document.createElement("template");
  template.innerHTML = html;
  for (const element of template.content.querySelectorAll("*")) {
    for (const attribute of [...element.attributes]) {
      if (/(?:url\s*\(|javascript:)/i.test(attribute.value) || attribute.name === "style" && /(?:@import\b|expression\s*\()/i.test(attribute.value)) {
        element.removeAttribute(attribute.name);
      }
    }
  }
  return template.innerHTML;
}

function copyButton(tex: string): HTMLButtonElement {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "marker-math-copy";
  button.textContent = "复制公式";
  button.setAttribute("aria-label", "复制 LaTeX 公式");
  button.addEventListener("click", async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error("clipboard unavailable");
      await navigator.clipboard.writeText(tex);
      button.textContent = "已复制";
    } catch {
      button.textContent = "复制失败";
    }
  });
  return button;
}

function renderInto(root: HTMLElement, tex: string, display: boolean): void {
  root.replaceChildren();
  root.classList.add("marker-math", display ? "marker-math-block" : "marker-math-inline");
  if (tex.length > maxTexLength) {
    showError(root, tex, display, "公式超过 8192 字符限制。");
    return;
  }
  try {
    const output = document.createElement(display ? "div" : "span");
    output.className = "marker-math-output";
    output.innerHTML = sanitizedMath(tex, display);
    root.append(output, copyButton(tex));
  } catch {
    showError(root, tex, display, "公式无法渲染，请检查 LaTeX 语法。");
  }
}

function showError(root: HTMLElement, tex: string, display: boolean, message: string): void {
  const source = document.createElement("code");
  source.className = "marker-math-source";
  source.textContent = tex;
  const note = document.createElement("span");
  note.className = "marker-math-error";
  note.textContent = message;
  root.append(source, note, copyButton(tex));
  if (display) root.classList.add("marker-math-block");
}

function unwrapDelimiters(source: string, display: boolean): string {
  const delimiters = display ? [["$$", "$$"], ["\\[", "\\]"]] : [["$", "$"], ["\\(", "\\)"]];
  for (const [open, close] of delimiters) {
    if (source.startsWith(open) && source.endsWith(close) && source.length >= open.length + close.length) {
      return source.slice(open.length, source.length - close.length);
    }
  }
  return source;
}

export class MathWidget extends WidgetType {
  constructor(readonly tex: string, readonly display: boolean, readonly from: number) { super(); }

  eq(other: MathWidget): boolean {
    return this.tex === other.tex && this.display === other.display && this.from === other.from;
  }

  toDOM(_view: import("@codemirror/view").EditorView): HTMLElement {
    const root = document.createElement(this.display ? "div" : "span");
    renderInto(root, this.tex, this.display);
    root.tabIndex = 0;
    root.setAttribute("role", "group");
    root.setAttribute("aria-label", "数学公式，按 Enter 编辑源码");
    root.addEventListener("keydown", event => {
      const keyboardEvent = event as KeyboardEvent;
      if (event.target !== root || keyboardEvent.isComposing || keyboardEvent.key !== "Enter") return;
      keyboardEvent.preventDefault();
      root.dispatchEvent(new CustomEvent("marker-rich-edit", { bubbles: true, detail: { offset: this.from } }));
    });
    root.addEventListener("click", event => {
      if (event.target instanceof Element && event.target.closest(".marker-math-copy")) return;
      root.dispatchEvent(new CustomEvent("marker-rich-edit", { bubbles: true, detail: { offset: this.from } }));
    });
    return root;
  }

  ignoreEvent(): boolean { return true; }
}

export function renderMath(root: ParentNode): void {
  const selector = 'span.math, div.math, [data-marker-math="inline"], [data-marker-math="block"]';
  const candidates = [
    ...(root instanceof Element && root.matches(selector) ? [root] : []),
    ...root.querySelectorAll<HTMLElement>(selector),
  ];
  for (const node of candidates) {
    if (!(node instanceof HTMLElement) || node.dataset.markerMathRendered === "true") continue;
    const display = node.tagName === "DIV" || node.dataset.markerMath === "block";
    const tex = unwrapDelimiters(node.textContent ?? "", display);
    renderInto(node, tex, display);
    node.dataset.markerMathRendered = "true";
  }
}
