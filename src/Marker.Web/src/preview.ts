import DOMPurify from "dompurify";
import { javascript } from "@codemirror/lang-javascript";
import { classHighlighter, highlightTree } from "@lezer/highlight";
import "./preview.css";

declare global {
  interface Window {
    chrome?: {
      webview?: {
        postMessage(message: object): void;
        addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
      };
    };
  }
}

type OutlineEntry = { id: string; text: string; level: number; offset: number };
const protocolVersion = 1;
const maxHtmlChars = 4 * 1024 * 1024;
const maxOutlineEntries = 10000;
const maxHighlightChars = 100000;
const preview = document.querySelector<HTMLElement>("#preview");
const outlineElement = document.querySelector<HTMLDetailsElement>("#outline");
if (!preview || !outlineElement) throw new Error("找不到预览入口元素。");
const requiredOutline: HTMLDetailsElement = outlineElement;

const bridge = window.chrome?.webview;
let sessionId: string | undefined;
let version = -1;
let headings: OutlineEntry[] = [];
const javascriptParser = javascript().language.parser;
const typescriptParser = javascript({ typescript: true, jsx: true }).language.parser;
const codeParsers = new Map([
  ...["javascript", "js", "jsx", "mjs", "cjs"].map((name) => [name, javascriptParser] as const),
  ...["typescript", "ts", "tsx"].map((name) => [name, typescriptParser] as const),
]);

function applySettings(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const settings = value as Record<string, unknown>;
  const theme = settings.theme;
  const fontSize = settings.fontSize;
  const lineHeight = settings.lineHeight;
  const lineWrapping = settings.lineWrapping;
  if (theme === "light" || theme === "dark" || theme === "system") document.documentElement.dataset.theme = theme;
  if (typeof fontSize === "number" && Number.isFinite(fontSize)) {
    document.documentElement.style.setProperty("--preview-font-size", `${Math.max(12, Math.min(24, fontSize))}px`);
  }
  if (typeof lineHeight === "number" && Number.isFinite(lineHeight)) {
    document.documentElement.style.setProperty("--preview-line-height", String(Math.max(1.2, Math.min(2, lineHeight))));
  }
  if (typeof lineWrapping === "boolean") document.documentElement.dataset.lineWrapping = String(lineWrapping);
}

function validateOutline(value: unknown): OutlineEntry[] | null {
  if (!Array.isArray(value) || value.length > maxOutlineEntries) return null;
  const ids = new Set<string>();
  const result: OutlineEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== "object") return null;
    const entry = item as Record<string, unknown>;
    if (typeof entry.id !== "string" || !/^heading-[\p{L}\p{N}-]{1,128}$/u.test(entry.id) || ids.has(entry.id) ||
      typeof entry.text !== "string" || entry.text.length > 2000 ||
      typeof entry.level !== "number" || !Number.isInteger(entry.level) || entry.level < 1 || entry.level > 6 ||
      typeof entry.offset !== "number" || !Number.isSafeInteger(entry.offset) || entry.offset < 0) return null;
    ids.add(entry.id);
    result.push({ id: entry.id, text: entry.text, level: entry.level, offset: entry.offset });
  }
  return result;
}

function renderOutline(entries: OutlineEntry[]): void {
  let summary = requiredOutline.querySelector("summary");
  if (!summary) {
    summary = document.createElement("summary");
    summary.textContent = "文档大纲";
    requiredOutline.prepend(summary);
  }
  const nav = document.createElement("nav");
  nav.setAttribute("aria-label", "文档大纲");
  const list = document.createElement("ol");
  for (const entry of entries) {
    const item = document.createElement("li");
    item.style.setProperty("--heading-level", String(entry.level));
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = entry.text;
    button.addEventListener("click", () => {
      const target = document.getElementById(entry.id);
      if (!target) return;
      requiredOutline.open = false;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      bridge?.postMessage({ protocolVersion, type: "revealSource", sessionId, version, offset: entry.offset });
    });
    item.append(button);
    list.append(item);
  }
  nav.append(list);
  const oldNav = requiredOutline.querySelector("nav");
  if (oldNav) oldNav.replaceWith(nav);
  else requiredOutline.append(nav);
  requiredOutline.hidden = entries.length === 0;
}

function highlightCodeBlocks(root: ParentNode): void {
  for (const code of root.querySelectorAll<HTMLElement>("pre > code")) {
    const languageClass = [...code.classList].find((name) => name.startsWith("language-"));
    code.removeAttribute("class");
    const language = languageClass?.slice("language-".length).toLowerCase();
    const parser = language ? codeParsers.get(language) : undefined;
    if (!parser) continue;

    const source = code.textContent ?? "";
    if (source.length > maxHighlightChars) continue;
    const tree = parser.parse(source);
    let position = 0;
    code.replaceChildren();
    highlightTree(tree, classHighlighter, (from, to, classes) => {
      if (from > position) code.append(document.createTextNode(source.slice(position, from)));
      const span = document.createElement("span");
      span.className = classes.split(/\s+/).filter((name) => /^tok-[a-zA-Z]+$/.test(name)).join(" ");
      span.textContent = source.slice(from, to);
      code.append(span);
      position = to;
    });
    if (position < source.length) code.append(document.createTextNode(source.slice(position)));
    code.dataset.language = language;
  }
}

function configureLinks(root: ParentNode): void {
  for (const anchor of root.querySelectorAll<HTMLAnchorElement>("a")) {
    const href = anchor.getAttribute("href") ?? "";
    anchor.removeAttribute("href");
    if (!href) { anchor.replaceWith(...anchor.childNodes); continue; }
    let fragment = "";
    if (href.startsWith("#")) {
      try { fragment = decodeURIComponent(href.slice(1)); }
      catch { anchor.replaceWith(...anchor.childNodes); continue; }
    }
    if (fragment && headings.some((heading) => heading.id === fragment)) {
      anchor.dataset.markerFragment = fragment;
    } else {
      let url: URL;
      try { url = new URL(href); } catch { anchor.replaceWith(...anchor.childNodes); continue; }
      if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) {
        anchor.replaceWith(...anchor.childNodes);
        continue;
      }
      anchor.dataset.markerUrl = url.href;
    }
    anchor.setAttribute("role", "link");
    anchor.tabIndex = 0;
    anchor.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      anchor.click();
    });
  }
}

preview.addEventListener("click", (event) => {
  const target = event.target;
  if (!(target instanceof Element)) return;
  const anchor = target.closest<HTMLAnchorElement>("a");
  if (!anchor || !preview.contains(anchor)) return;
  event.preventDefault();
  const fragment = anchor.dataset.markerFragment;
  if (fragment) {
    requiredOutline.open = false;
    document.getElementById(fragment)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }
  const url = anchor.dataset.markerUrl;
  if (url && sessionId) bridge?.postMessage({ protocolVersion, type: "openLink", sessionId, version, url });
});

bridge?.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data as Record<string, unknown> | null;
  if (!message || typeof message !== "object" || message.protocolVersion !== protocolVersion) return;
  if (message.type === "initialize" && typeof message.sessionId === "string" && /^[0-9a-f]{32}$/.test(message.sessionId)) {
    if (message.sessionId !== sessionId) {
      sessionId = message.sessionId;
      version = -1;
      headings = [];
      preview.replaceChildren();
      requiredOutline.replaceChildren();
      requiredOutline.hidden = true;
    }
    applySettings(message.settings ?? message);
    return;
  }
  if (message.type === "settings" && message.sessionId === sessionId) {
    applySettings(message);
    return;
  }
  if (
    message.type !== "render" || typeof sessionId !== "string" || message.sessionId !== sessionId ||
    typeof message.version !== "number" || !Number.isSafeInteger(message.version) || message.version < version ||
    message.version < 0 || typeof message.html !== "string" || message.html.length > maxHtmlChars
  ) return;

  const nextOutline = validateOutline(message.outline);
  const scrollingElement = document.scrollingElement;
  const scrollTop = scrollingElement?.scrollTop ?? 0;
  const clean = DOMPurify.sanitize(message.html, {
    ALLOWED_TAGS: [
      "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
      "ul", "ol", "li", "pre", "code", "em", "strong", "del", "table", "img", "a",
      "thead", "tbody", "tr", "th", "td", "input",
    ],
    ALLOWED_ATTR: ["title", "start", "align", "src", "alt", "href", "id", "class", "type", "disabled", "checked"],
    FORBID_TAGS: ["svg", "math", "style", "iframe", "form"],
    FORBID_ATTR: ["style", "srcset", "onerror", "onload"],
    ALLOW_DATA_ATTR: false,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  for (const input of template.content.querySelectorAll<HTMLInputElement>("input")) {
    if (input.getAttribute("type")?.toLowerCase() === "checkbox" && input.hasAttribute("disabled")) {
      input.replaceWith(document.createTextNode(input.hasAttribute("checked") ? "☑ " : "☐ "));
    } else input.remove();
  }
  for (const element of template.content.querySelectorAll<HTMLElement>("[class]")) {
    if (element.tagName !== "CODE" || element.parentElement?.tagName !== "PRE") element.removeAttribute("class");
  }
  for (const image of template.content.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? "";
    const match = /^https:\/\/document\.marker\.example\/([0-9a-f]{32})\/image\/[0-9a-f]{48}$/.exec(src);
    if (!match || match[1] !== sessionId) image.remove();
  }
  const renderedHeadings = [...template.content.querySelectorAll<HTMLElement>("h1,h2,h3,h4,h5,h6")];
  const idSet = new Set<string>();
  headings = (nextOutline ?? []).filter((entry) => {
    if (idSet.has(entry.id)) return false;
    idSet.add(entry.id);
    return true;
  });
  renderedHeadings.forEach((heading, index) => {
    const entry = headings[index];
    if (entry && heading.tagName === `H${entry.level}`) heading.id = entry.id;
    else heading.removeAttribute("id");
  });
  highlightCodeBlocks(template.content);
  const validIds = new Set(renderedHeadings.filter((heading) => heading.id).map((heading) => heading.id));
  headings = headings.filter((entry) => validIds.has(entry.id));
  configureLinks(template.content);
  preview.replaceChildren(template.content);
  if (scrollingElement) scrollingElement.scrollTop = scrollTop;
  renderOutline(headings);
  version = message.version;
  bridge?.postMessage({ protocolVersion, type: "rendered", sessionId, version });
});

if (bridge) bridge.postMessage({ protocolVersion, type: "ready" });
else preview.textContent = "预览等待 Marker 桌面端连接。";
