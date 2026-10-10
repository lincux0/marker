import { WidgetType, type EditorView } from "@codemirror/view";
import DOMPurify from "dompurify";
import "./mermaid.css";

export type MermaidTheme = "light" | "dark";

const maxSourceLength = 32_768;
const maxQueuedRenders = 4;
const allowedTags = ["svg", "g", "path", "rect", "circle", "ellipse", "line", "polygon", "polyline", "text", "tspan", "title", "defs", "marker", "clipPath", "style"];
const allowedAttributes = ["xmlns", "viewBox", "width", "height", "x", "y", "x1", "y1", "x2", "y2", "cx", "cy", "r", "rx", "ry", "d", "points", "id", "class", "fill", "fill-rule", "stroke", "stroke-width", "stroke-dasharray", "stroke-linecap", "stroke-linejoin", "opacity", "transform", "marker-start", "marker-mid", "marker-end", "markerWidth", "markerHeight", "refX", "refY", "orient", "markerUnits", "preserveAspectRatio", "font-size", "font-family", "font-weight", "text-anchor", "dominant-baseline", "alignment-baseline", "dx", "dy", "style"];

let renderTail = Promise.resolve();
let queuedRenders = 0;
let nextRenderId = 0;
const dialogsByWidget = new WeakMap<HTMLElement, HTMLDialogElement>();

function unsupportedReason(source: string): string | null {
  if (source.length > maxSourceLength) return "图表源码超过 32,768 个字符，已保留源码。";
  if (/%%\s*\{|^\s*---\s*$/m.test(source)) return "不支持 Mermaid 指令或 frontmatter，已保留源码。";
  if (/\b(?:https?|data|file|javascript):|\bwww\./i.test(source)) return "图表包含外部资源地址，已保留源码。";
  if (/\b(?:img|icon)\s*:/i.test(source)) return "不支持图表图片或图标资源，已保留源码。";
  if (/(?:^|[;\r\n])\s*(?:click|style|classDef|linkStyle)\b/i.test(source)) return "不支持图表点击动作或自定义样式，已保留源码。";
  const lines = source.split(/\r?\n/);
  const first = lines.find(line => line.trim() && !/^\s*%%(?!\{)/.test(line))?.trim() ?? "";
  if (!/^(?:flowchart|graph)\s+(?:TB|TD|BT|RL|LR)\b/.test(first) && first !== "sequenceDiagram") return "目前仅支持 flowchart、graph 和 sequenceDiagram，已保留源码。";
  if (lines.length > 250) return "图表行数超过 250 行，已保留源码。";
  if ((source.match(/[\p{L}\p{N}_]+/gu) ?? []).length > 800) return "图表词元超过安全呈现上限，已保留源码。";
  const edges = first === "sequenceDiagram"
    ? (source.match(/(?:->>|-->>|->|-->|-x|--x|--\))/g) ?? []).length
    : (source.match(/(?:<[-.]+>|[-.]+>|[-.]+[ox]|[ox][-.-]+|==>)/g) ?? []).length;
  const nodes = first === "sequenceDiagram"
    ? new Set([...source.matchAll(/^\s*(?:participant|actor)\s+([\w-]+)/gm)].map(match => match[1])).size
    : new Set([...source.matchAll(/(?:^|[^\p{L}\p{N}_])([\p{L}_][\p{L}\p{N}_-]*)\s*(?=\[|\(|\{|\s*(?:-->|---|==>|-.->|$))/gmu)].map(match => match[1])).size;
  if (nodes > 100 || edges > 150) return "图表节点或连线超过安全呈现上限，已保留源码。";
  return null;
}

function safeSvg(svg: string): SVGSVGElement {
  const clean = DOMPurify.sanitize(svg, {
    ALLOWED_TAGS: allowedTags,
    ALLOWED_ATTR: allowedAttributes,
    ALLOWED_NAMESPACES: ["http://www.w3.org/2000/svg"],
    ALLOW_ARIA_ATTR: false,
    ALLOW_DATA_ATTR: false,
    ALLOW_UNKNOWN_PROTOCOLS: false,
    KEEP_CONTENT: true,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  const root = template.content.firstElementChild;
  if (!(root instanceof SVGSVGElement) || root.localName !== "svg" || template.content.children.length !== 1) throw new Error("Mermaid did not return one safe SVG root.");
  for (const element of [root, ...root.querySelectorAll("*")]) {
    if (element.namespaceURI !== "http://www.w3.org/2000/svg") throw new Error("SVG contains an element outside the SVG namespace.");
    for (const attribute of [...element.attributes]) {
      const name = attribute.name.toLowerCase();
      const value = attribute.value.trim();
      if (name.startsWith("on") || name === "href" || name.endsWith(":href")) {
        if (!/^(?:xlink:href)$/.test(name) || !/^#[\w:.-]+$/.test(value)) throw new Error("SVG contains an external or active reference.");
      }
      for (const match of value.matchAll(/url\s*\(\s*([^)]*)\)/gi)) if (!/^#[\w:.-]+$/.test(match[1].trim().replace(/^['"]|['"]$/g, ""))) throw new Error("SVG contains a non-local URL reference.");
      if (/@import|@font-face|expression\s*\(|-moz-binding|behavior\s*:/i.test(value)) throw new Error("SVG contains active CSS.");
    }
    if (element.localName === "style") {
      const css = element.textContent ?? "";
      if (/@import|@font-face|expression\s*\(|-moz-binding|behavior\s*:/i.test(css)) throw new Error("SVG contains active CSS.");
      for (const match of css.matchAll(/url\s*\(\s*([^)]*)\)/gi)) if (!/^#[\w:.-]+$/.test(match[1].trim().replace(/^['"]|['"]$/g, ""))) throw new Error("SVG contains a non-local CSS URL.");
    }
  }
  if (root.querySelector("script,foreignObject,a,image,iframe,object,use")) throw new Error("SVG contains a forbidden element.");
  return root;
}

function enqueueRender(element: HTMLElement, source: string, theme: MermaidTheme): void {
  const rejection = unsupportedReason(source);
  if (rejection) return showFallback(element, source, rejection);
  if (queuedRenders >= maxQueuedRenders) return showFallback(element, source, "图表队列已满，已保留源码。请稍后重试。");
  queuedRenders++;
  const render = async (): Promise<void> => {
    if (!element.isConnected) return;
    const panel = element.querySelector<HTMLElement>(".marker-mermaid-preview");
    if (!panel) return;
    panel.textContent = "正在绘制图表…";
    try {
      const { default: mermaid } = await import("mermaid");
      if (!element.isConnected || !element.contains(panel)) return;
      mermaid.initialize({
        startOnLoad: false,
        securityLevel: "strict",
        maxTextSize: maxSourceLength,
        maxEdges: 150,
        theme: theme === "dark" ? "dark" : "default",
        htmlLabels: false,
        flowchart: { htmlLabels: false },
        secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "theme", "htmlLabels", "flowchart"],
      });
      const { svg } = await mermaid.render(`marker-mermaid-${++nextRenderId}`, source);
      if (!element.isConnected || !element.contains(panel)) return;
      const safe = safeSvg(svg);
      safe.setAttribute("role", "img");
      safe.setAttribute("aria-label", "Mermaid 图表");
      panel.replaceChildren(safe);
      panel.setAttribute("aria-live", "off");
      const open = element.querySelector<HTMLButtonElement>(".marker-mermaid-open");
      if (open) open.hidden = false;
      element.dataset.rendered = "true";
    } catch {
      if (element.isConnected && element.contains(panel)) showFallback(element, source, "图表无法安全呈现，已保留源码。");
    }
  };
  renderTail = renderTail.then(render, render).finally(() => { queuedRenders--; });
}

function showFallback(element: HTMLElement, source: string, message: string): void {
  const panel = element.querySelector<HTMLElement>(".marker-mermaid-preview");
  if (!panel) return;
  const hint = document.createElement("p");
  hint.className = "marker-mermaid-hint";
  hint.textContent = message;
  const code = document.createElement("pre");
  code.className = "marker-mermaid-source";
  code.textContent = source;
  panel.replaceChildren(hint, code);
  const open = element.querySelector<HTMLButtonElement>(".marker-mermaid-open");
  if (open) open.hidden = true;
  element.dataset.rendered = "fallback";
}

function button(label: string, className: string, text: string): HTMLButtonElement {
  const result = document.createElement("button");
  result.type = "button";
  result.className = className;
  result.setAttribute("aria-label", label);
  result.textContent = text;
  return result;
}

function openDiagramDialog(svg: SVGSVGElement, theme: MermaidTheme, opener: HTMLElement, owner: HTMLElement): void {
  const dialog = document.createElement("dialog");
  dialog.className = "marker-mermaid-dialog";
  dialog.dataset.theme = theme;
  dialog.setAttribute("aria-label", "Mermaid 图表查看器");
  const toolbar = document.createElement("div");
  toolbar.className = "marker-mermaid-dialog-toolbar";
  const zoomOut = button("缩小图表", "", "−");
  const fit = button("适合窗口", "", "适合窗口");
  const zoomIn = button("放大图表", "", "+");
  const close = button("关闭图表查看器", "", "关闭");
  toolbar.append(zoomOut, fit, zoomIn, close);
  const instructions = document.createElement("span");
  instructions.className = "marker-mermaid-instructions";
  instructions.textContent = "滚轮或 +/− 缩放；拖动或方向键平移；Esc 关闭。";
  toolbar.prepend(instructions);
  const viewport = document.createElement("div");
  viewport.className = "marker-mermaid-viewport";
  viewport.tabIndex = 0;
  viewport.setAttribute("aria-label", "图表画布。使用加号和减号缩放，方向键平移，拖动或滚轮操作。");
  viewport.setAttribute("aria-keyshortcuts", "+ - ArrowLeft ArrowRight ArrowUp ArrowDown");
  const canvas = document.createElement("div");
  canvas.className = "marker-mermaid-canvas";
  const placeholder = document.createElement("span");
  placeholder.hidden = true;
  svg.replaceWith(placeholder);
  canvas.append(svg);
  viewport.append(canvas);
  dialog.append(toolbar, viewport);
  document.body.append(dialog);

  let scale = 1;
  let x = 0;
  let y = 0;
  const update = (): void => { canvas.style.transform = `translate(${x}px, ${y}px) scale(${scale})`; };
  const zoom = (factor: number): void => { scale = Math.max(0.25, Math.min(4, scale * factor)); update(); };
  const fitView = (): void => {
    const diagram = canvas.querySelector("svg");
    const width = diagram?.viewBox.baseVal.width || diagram?.width.baseVal.value || 1;
    const height = diagram?.viewBox.baseVal.height || diagram?.height.baseVal.value || 1;
    scale = Math.min(1, (viewport.clientWidth - 32) / width, (viewport.clientHeight - 32) / height);
    x = (viewport.clientWidth - width * scale) / 2;
    y = (viewport.clientHeight - height * scale) / 2;
    update();
  };
  zoomOut.addEventListener("click", () => zoom(1 / 1.25));
  zoomIn.addEventListener("click", () => zoom(1.25));
  fit.addEventListener("click", fitView);
  close.addEventListener("click", () => dialog.close());
  viewport.addEventListener("keydown", event => {
    if (event.target !== viewport) return;
    if (event.key === "+" || event.key === "=") { event.preventDefault(); zoom(1.25); }
    else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoom(1 / 1.25); }
    else if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(event.key)) {
      event.preventDefault();
      x += event.key === "ArrowLeft" ? 40 : event.key === "ArrowRight" ? -40 : 0;
      y += event.key === "ArrowUp" ? 40 : event.key === "ArrowDown" ? -40 : 0;
      update();
    }
  });
  let drag: { pointer: number; x: number; y: number; startX: number; startY: number } | null = null;
  viewport.addEventListener("pointerdown", event => {
    if (event.button !== 0) return;
    drag = { pointer: event.pointerId, x, y, startX: event.clientX, startY: event.clientY };
    viewport.setPointerCapture(event.pointerId);
  });
  viewport.addEventListener("pointermove", event => {
    if (!drag || drag.pointer !== event.pointerId) return;
    x = drag.x + event.clientX - drag.startX;
    y = drag.y + event.clientY - drag.startY;
    update();
  });
  viewport.addEventListener("pointerup", () => { drag = null; });
  viewport.addEventListener("pointercancel", () => { drag = null; });
  viewport.addEventListener("wheel", event => {
    event.preventDefault();
    scale = Math.max(0.25, Math.min(4, scale * (event.deltaY < 0 ? 1.1 : 1 / 1.1)));
    update();
  }, { passive: false });
  dialog.addEventListener("close", () => {
    if (placeholder.isConnected) placeholder.replaceWith(svg);
    dialog.remove();
    if (dialogsByWidget.get(owner) === dialog) dialogsByWidget.delete(owner);
    if (opener.isConnected) opener.focus();
  }, { once: true });
  dialogsByWidget.set(owner, dialog);
  dialog.showModal();
  fitView();
}

export class MermaidWidget extends WidgetType {
  constructor(readonly source: string, readonly from: number, readonly theme: MermaidTheme) { super(); }

  eq(other: MermaidWidget): boolean { return this.source === other.source && this.from === other.from && this.theme === other.theme; }

  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("section");
    wrapper.className = "cm-md-mermaid";
    wrapper.dataset.theme = this.theme;
    const toolbar = document.createElement("div");
    toolbar.className = "marker-mermaid-toolbar";
    const open = button("放大查看图表", "marker-mermaid-open", "放大查看");
    open.hidden = true;
    const copy = button("复制 Mermaid 源码", "marker-mermaid-copy", "复制源码");
    const edit = button("编辑 Mermaid 源码", "marker-mermaid-edit", "编辑图表");
    toolbar.append(open, copy, edit);
  const preview = document.createElement("div");
  preview.className = "marker-mermaid-preview";
  preview.setAttribute("aria-live", "polite");
    wrapper.append(toolbar, preview);
    enqueueRender(wrapper, this.source, this.theme);
    const copySource = async (): Promise<void> => {
      let copied = false;
      try {
        if (!navigator.clipboard?.writeText) throw new Error("Clipboard API unavailable");
        await navigator.clipboard.writeText(this.source);
        copied = true;
      } catch { /* The existing status event reports clipboard permission and platform failures. */ }
      if (wrapper.isConnected) view.dom.dispatchEvent(new CustomEvent("marker-code-copy", { bubbles: true, detail: { copied } }));
    };
    copy.addEventListener("click", () => { void copySource(); });
    edit.addEventListener("click", () => view.dom.dispatchEvent(new CustomEvent("marker-rich-edit", { bubbles: true, detail: { offset: this.from } })));
    open.addEventListener("click", () => {
      const svg = preview.querySelector("svg");
      if (svg) openDiagramDialog(svg, this.theme, open, wrapper);
    });
    return wrapper;
  }

  ignoreEvent(event: Event): boolean { return event.target instanceof Element && !!event.target.closest(".marker-mermaid-toolbar"); }

  destroy(dom: HTMLElement): void { dialogsByWidget.get(dom)?.close(); }
}
