import { defaultKeymap, history, historyKeymap, isolateHistory, redo, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { Compartment, EditorState } from "@codemirror/state";
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, searchKeymap, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorView, keymap, placeholder, type Panel } from "@codemirror/view";
import { enableFileDrop } from "./file-drop";
import { markdownLinkActions } from "./links";
import { imageResources, liveMarkdown, markdownFormattingKeymap, toggleSourceMode } from "./live-markdown";
import { FloatingToolbar, isHiddenToolbarActions, type ConfigurableToolbarAction, type EditorCommand, type NativeCommand } from "./toolbar";
import { countMarkdown } from "./statistics";
import { DocumentOutline, type Heading } from "./outline";
import { ImageLightbox } from "./lightbox";
import { DiskChangePrompt } from "./disk-change";
import "./style.css";
import { codeLanguage } from "./code-languages";
import { richContent, validateRichContent, type RichNode } from "./rich-content";

declare global {
  interface Window {
    chrome?: {
      webview?: {
        postMessage(message: object): void;
        postMessageWithAdditionalObjects?(message: object, objects: File[]): void;
        addEventListener(type: "message", listener: (event: MessageEvent<unknown>) => void): void;
      };
    };
  }
}

type Theme = "light" | "dark" | "system";
type FontChoice = "system" | "song" | "yahei" | "dengxian" | "serif";
type ColorPalette = "lavender" | "forest" | "ocean" | "paper" | "graphite";
type Settings = {
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  lineWrapping: boolean;
  paragraphSpacing?: number;
  bodyFont?: FontChoice;
  h1Font?: FontChoice;
  h2Font?: FontChoice;
  colorPalette?: ColorPalette;
  reducedMotion?: boolean;
  highContrast?: boolean;
  hiddenToolbarActions?: ConfigurableToolbarAction[];
};

const protocolVersion = 1 as const;
const maxMessageChars = 1_048_576;
const maxMessageBytes = 2_097_152;
const app = document.querySelector<HTMLElement>("#app");
const editorParent = document.querySelector<HTMLElement>("#editor");

if (!app || !editorParent) throw new Error("找不到编辑器入口元素。");

const bridge = window.chrome?.webview;
const settingsCompartment = new Compartment();
const codeCompartment = new Compartment();
function markdownSupport(length: number) {
  // shortcut: disable fenced-language parsing for documents over 100K chars; use per-block limits if long mixed documents need highlighting.
  return markdown({ base: markdownLanguage, codeLanguages: length <= 100000 ? codeLanguage : () => null });
}
let view: EditorView | undefined;
let sessionId: string | undefined;
let version = 0;
let fullSnapshotPending = false;
let toolbar: FloatingToolbar | undefined;
let statisticsTimer: ReturnType<typeof setTimeout> | undefined;
let focusMode = false;
let currentRichNodes: readonly RichNode[] = [];
let footnoteReturn: number | undefined;
let settings: Settings = {
  theme: "system",
  fontSize: 15,
  lineHeight: 1.5,
  lineWrapping: true,
  paragraphSpacing: 0.5,
  bodyFont: "system",
  h1Font: "song",
  h2Font: "song",
  colorPalette: "lavender",
};
enableFileDrop(bridge, () => sessionId);
const status = document.createElement("div");
status.id = "status";
status.setAttribute("role", "status");
status.setAttribute("aria-live", "polite");
status.hidden = true;
app.append(status);

function setStatus(message: string): void {
  status.textContent = message;
  status.hidden = message.length === 0;
}

const diskChangePrompt = new DiskChangePrompt(app, (notificationId, action) => {
  if (!sessionId) return false;
  if (action === "reload" && view?.compositionStarted) {
    setStatus("请先完成输入法候选输入，再重新加载文档。");
    return false;
  }
  return post({ type: "diskChangeAction", sessionId, notificationId, action });
}, () => view?.focus());

const outline = new DocumentOutline(() => view, setStatus, () => version, open => toolbar?.setOutlineOpen(open));
const lightbox = new ImageLightbox(editorParent);
editorParent.addEventListener("marker-rich-edit", event => {
  const offset = (event as CustomEvent<{ offset?: unknown }>).detail?.offset;
  if (!view || view.compositionStarted || !Number.isSafeInteger(offset) || (offset as number) < 0 || (offset as number) >= view.state.doc.length) return;
  const position = Math.min(view.state.doc.length, (offset as number) + 1);
  view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "start" }) });
  view.focus();
});
editorParent.addEventListener("marker-rich-navigate", event => {
  const detail = (event as CustomEvent<{ offset?: unknown; returnOffset?: unknown }>).detail;
  if (!view || view.compositionStarted) return;
  const node = currentRichNodes.find(item => item.from === detail?.returnOffset && item.target === detail?.offset);
  if (!node || !node.kind.startsWith("footnote-")) return;
  let position = node.target;
  if (node.kind === "footnote-reference") {
    footnoteReturn = node.from;
    const prefix = /^\s*\[\^[^\]\n]+\]:\s*/.exec(view.state.doc.lineAt(position).text);
    position += prefix?.[0].length ?? 0;
  } else position = footnoteReturn ?? position;
  view.dispatch({ selection: { anchor: position }, effects: EditorView.scrollIntoView(position, { y: "start" }) });
  view.focus();
});
editorParent.addEventListener("marker-image-zoom", event => {
  if (!view?.compositionStarted) return;
  event.stopImmediatePropagation();
  setStatus("请先完成输入法候选输入，再查看图片。");
}, true);

function toggleFocusMode(): void {
  focusMode = !focusMode;
  document.documentElement.dataset.focusMode = String(focusMode);
  toolbar?.setFocusMode(focusMode);
  if (focusMode) outline.close();
  view?.requestMeasure();
  view?.focus();
}

function toolbarScrollMargin(editor: EditorView): number {
  return Math.max(0, (toolbar?.element.getBoundingClientRect().bottom ?? 0) - editor.scrollDOM.getBoundingClientRect().top) + 12;
}

editorParent.addEventListener("marker-code-copy", event => {
  const copied = (event as CustomEvent<{ copied?: boolean }>).detail?.copied === true;
  setStatus(copied ? "代码已复制。" : "复制代码失败。");
});

function post(message: Record<string, unknown>): boolean {
  if (!bridge) return false;
  const packet = { protocolVersion, ...message };
  const json = JSON.stringify(packet);
  if (new TextEncoder().encode(json).length > maxMessageBytes) {
    setStatus("桥接消息超过 2 MiB 限制，编辑内容仍保留在编辑器中，但暂时无法同步。");
    return false;
  }
  try {
    bridge.postMessage(packet);
    return true;
  } catch {
    setStatus("桌面端连接暂不可用；编辑内容仍保留在编辑器中。");
    return false;
  }
}

function scheduleStatistics(): void {
  clearTimeout(statisticsTimer);
  const doc = view?.state.doc;
  if (!doc) return;
  // Count after a short typing pause so the complete Markdown parse stays out of each keystroke.
  statisticsTimer = setTimeout(() => {
    if (view?.state.doc !== doc) return;
    const { words, paragraphs } = countMarkdown(doc.toString());
    toolbar?.updateStatistics(words, paragraphs);
  }, 180);
}

function sendStatus(editor: EditorView): void {
  if (!sessionId) return;
  const head = editor.state.selection.main.head;
  const line = editor.state.doc.lineAt(head);
  post({
    type: "status",
    sessionId,
    version,
    line: line.number,
    column: head - line.from + 1,
    charCount: editor.state.doc.length,
    unit: "utf16",
  });
}

function sendSnapshot(requestId?: string): void {
  if (!view || !sessionId) return;
  if (requestId && view.compositionStarted) {
    post({ type: "snapshotError", sessionId, requestId, reason: "compositionInProgress" });
    setStatus("请先完成输入法候选输入，尚未提交保存内容。");
    return;
  }
  if (view.compositionStarted) {
    fullSnapshotPending = true;
    return;
  }
  const text = view.state.doc.toString();
  if (text.length > maxMessageChars) {
    fullSnapshotPending = true;
    setStatus("文档超过 1,048,576 个 UTF-16 单元，编辑内容仍保留在此编辑器中，但暂时无法同步预览。");
    return;
  }
  if (post({ type: "snapshot", sessionId, version, text, ...(requestId ? { requestId } : {}) })) {
    fullSnapshotPending = false;
    setStatus("");
  } else fullSnapshotPending = true;
}

function sendCommand(command: NativeCommand): boolean {
  return sessionId ? post({ type: "command", sessionId, command }) : false;
}

function toggleSource(editor: EditorView): boolean {
  if (!toggleSourceMode(editor)) return false;
  // Removing line styles leaves stale heights; rebuild the view with the same document, selection and history.
  editor.setState(editor.state);
  toolbar?.setSourceMode(editor.dom.dataset.sourceMode === "true");
  post({ type: "sourceMode", sessionId, version, sourceMode: editor.dom.dataset.sourceMode === "true" });
  return true;
}

function runEditorCommand(command: EditorCommand, trigger?: HTMLElement): void {
  if (!view) return;
  if (view.compositionStarted) {
    if (command === "toggleSource") post({ type: "sourceMode", sessionId, version, sourceMode: view.dom.dataset.sourceMode === "true" });
    setStatus("请先完成输入法候选输入，再执行编辑器命令。");
    return;
  }
  switch (command) {
    case "undo": undo(view); view.focus(); break;
    case "redo": redo(view); view.focus(); break;
    case "find": openSearchPanel(view); break;
    case "replace": openReplacePanel(view); break;
    case "toggleSource": toggleSource(view); view.focus(); break;
    case "toggleOutline": outline.toggle(trigger); break;
    case "toggleFocus": toggleFocusMode(); break;
  }
}

toolbar = new FloatingToolbar({
  runNative: command => { sendCommand(command); },
  runEditor: runEditorCommand,
});
toolbar.attach(app, editorParent);
new ResizeObserver(() => {
  const height = toolbar?.element.getBoundingClientRect().height ?? 50;
  document.documentElement.style.setProperty("--marker-toolbar-height", `${height}px`);
  view?.requestMeasure();
}).observe(toolbar.element);

editorParent.addEventListener("keydown", (event: KeyboardEvent) => {
  if (event.ctrlKey && event.key.toLowerCase() === "s") {
    event.preventDefault();
    event.stopImmediatePropagation();
    sendCommand(event.shiftKey ? "saveAs" : "save");
  }
}, true);

function insertParagraph(editor: EditorView): boolean {
  if (editor.compositionStarted) return false;
  const end = editor.state.doc.lineAt(editor.state.selection.main.head).to;
  editor.dispatch({
    changes: { from: end, insert: "\n\n" },
    selection: { anchor: end + 2 },
    scrollIntoView: true,
    userEvent: "input",
    annotations: isolateHistory.of("full"),
  });
  return true;
}

function createSearchPanel(editor: EditorView): Panel {
  const form = document.createElement("form");
  form.className = "cm-search-panel";
  form.setAttribute("aria-label", "查找和替换");
  form.addEventListener("submit", (event) => { event.preventDefault(); findNext(editor); });

  const find = document.createElement("input");
  find.type = "search";
  find.placeholder = "查找";
  find.setAttribute("aria-label", "查找文本");
  find.setAttribute("main-field", "true");
  const replace = document.createElement("input");
  replace.type = "text";
  replace.placeholder = "替换为";
  replace.setAttribute("aria-label", "替换为");

  const button = (label: string, action: () => void, actionName: string): HTMLButtonElement => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = label;
    element.dataset.action = actionName;
    element.addEventListener("click", action);
    return element;
  };
  const syncQuery = (): void => editor.dispatch({ effects: setSearchQuery.of(new SearchQuery({ search: find.value, replace: replace.value, literal: true })) });
  find.addEventListener("input", syncQuery);
  replace.addEventListener("input", syncQuery);
  form.append(
    find,
    button("上一个", () => { syncQuery(); findPrevious(editor); }, "previous"),
    button("下一个", () => { syncQuery(); findNext(editor); }, "next"),
    replace,
    button("替换", () => { syncQuery(); replaceNext(editor); }, "replace"),
    button("全部替换", () => { syncQuery(); replaceAll(editor); }, "replace-all"),
    button("关闭", () => closeSearchPanel(editor), "close"),
  );

  const updateFields = (): void => {
    const query = getSearchQuery(editor.state);
    if (query && document.activeElement !== find) find.value = query.search;
    if (query && document.activeElement !== replace) replace.value = query.replace;
  };
  return { dom: form, top: true, mount: updateFields, update: updateFields };
}

function openReplacePanel(editor: EditorView): boolean {
  if (editor.compositionStarted) return false;
  openSearchPanel(editor);
  requestAnimationFrame(() => editor.dom.querySelector<HTMLInputElement>("input[type=text]")?.focus());
  return true;
}

const darkHighlightStyle = HighlightStyle.define([...defaultHighlightStyle.specs.map(style => style.color ? {
  ...style,
  color: style.tag === tags.meta || style.tag === tags.comment ? "var(--editor-muted)" : "var(--editor-accent)",
} : style), { tag: tags.inserted, color: "#98d5ac" }, { tag: tags.deleted, color: "#f0a3a8" }]);

const fontStacks: Record<FontChoice, string> = {
  system: '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", sans-serif',
  song: '"SimSun", "Noto Serif CJK SC", Georgia, serif',
  yahei: '"Microsoft YaHei UI", "Segoe UI Variable Text", "Segoe UI", sans-serif',
  dengxian: '"DengXian", "Microsoft YaHei UI", sans-serif',
  serif: 'Georgia, "SimSun", serif',
};

function normalizedSettings(value: Record<string, unknown>): Settings | null {
  const base = { theme: value.theme, fontSize: value.fontSize, lineHeight: value.lineHeight, lineWrapping: value.lineWrapping };
  if (!isSettings(base)) return null;
  const optional = ["paragraphSpacing", "bodyFont", "h1Font", "h2Font", "colorPalette", "reducedMotion", "highContrast", "hiddenToolbarActions"];
  if (Object.keys(value).some(key => !["theme", "fontSize", "lineHeight", "lineWrapping", ...optional].includes(key))) return null;
  if ("paragraphSpacing" in value && (typeof value.paragraphSpacing !== "number" || !Number.isFinite(value.paragraphSpacing) || value.paragraphSpacing < 0 || value.paragraphSpacing > 2)) return null;
  if (["bodyFont", "h1Font", "h2Font"].some(key => key in value && !isFontChoice(value[key]))) return null;
  if ("colorPalette" in value && !isColorPalette(value.colorPalette)) return null;
  if ("reducedMotion" in value && typeof value.reducedMotion !== "boolean") return null;
  if ("hiddenToolbarActions" in value && !isHiddenToolbarActions(value.hiddenToolbarActions)) return null;
  if ("highContrast" in value && typeof value.highContrast !== "boolean") return null;
  return {
    ...base as Pick<Settings, "theme" | "fontSize" | "lineHeight" | "lineWrapping">,
    paragraphSpacing: (value.paragraphSpacing as number | undefined) ?? 0.5,
    bodyFont: (value.bodyFont as FontChoice | undefined) ?? "system",
    h1Font: (value.h1Font as FontChoice | undefined) ?? "song",
    h2Font: (value.h2Font as FontChoice | undefined) ?? "song",
    colorPalette: (value.colorPalette as ColorPalette | undefined) ?? "lavender",
    hiddenToolbarActions: (value.hiddenToolbarActions as ConfigurableToolbarAction[] | undefined) ?? [],
    ...(typeof value.reducedMotion === "boolean" ? { reducedMotion: value.reducedMotion } : {}),
    ...(typeof value.highContrast === "boolean" ? { highContrast: value.highContrast } : {}),
  };
}

function isFontChoice(value: unknown): value is FontChoice {
  return value === "system" || value === "song" || value === "yahei" || value === "dengxian" || value === "serif";
}

function isColorPalette(value: unknown): value is ColorPalette {
  return value === "lavender" || value === "forest" || value === "ocean" || value === "paper" || value === "graphite";
}

function styleSettings(next: Settings): void {
  settings = next;
  toolbar?.setHiddenActions(next.hiddenToolbarActions ?? []);
  if (!view) return;
  document.documentElement.dataset.theme = next.theme;
  if (next.reducedMotion === undefined) delete document.documentElement.dataset.reducedMotion;
  else document.documentElement.dataset.reducedMotion = String(next.reducedMotion);
  if (next.highContrast === undefined) delete document.documentElement.dataset.highContrast;
  else document.documentElement.dataset.highContrast = String(next.highContrast);
  editorParent!.dataset.theme = next.theme;
  document.documentElement.dataset.colorPalette = next.colorPalette ?? "lavender";
  editorParent!.style.setProperty("--editor-font-size", `${next.fontSize}px`);
  editorParent!.style.setProperty("--editor-line-height", String(next.lineHeight));
  editorParent!.style.setProperty("--editor-paragraph-spacing", `${next.paragraphSpacing ?? 0.5}em`);
  editorParent!.style.setProperty("--editor-body-font", fontStacks[next.bodyFont ?? "system"]);
  editorParent!.style.setProperty("--editor-h1-font", fontStacks[next.h1Font ?? "song"]);
  editorParent!.style.setProperty("--editor-h2-font", fontStacks[next.h2Font ?? "song"]);
  const dark = next.theme === "dark" || next.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches;
  view.dispatch({ effects: settingsCompartment.reconfigure([
    EditorView.theme({ "&": { color: "var(--editor-foreground)", backgroundColor: "var(--editor-background)" } }, { dark }),
    syntaxHighlighting(dark ? darkHighlightStyle : defaultHighlightStyle),
    next.lineWrapping ? EditorView.lineWrapping : [],
  ]) });
  view.requestMeasure();
}

function applyHostMessage(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const message = value as Record<string, unknown>;
  if (message.protocolVersion !== protocolVersion || typeof message.type !== "string") return;
  const keys = Object.keys(message);
  const exact = (...allowed: string[]): boolean => keys.every(key => allowed.includes(key)) && allowed.every(key => key in message);

  if (message.type === "richContent" && exact("type", "protocolVersion", "sessionId", "version", "nodes") && message.sessionId === sessionId && message.version === version && view) {
    const nodes = validateRichContent(message.nodes, view.state.doc.length);
    if (!nodes) return;
    currentRichNodes = nodes;
    view.dispatch({ effects: richContent.of(nodes) });
    return;
  }

  if (message.type === "initialize" && exact("type", "protocolVersion", "sessionId", "text") &&
      typeof message.sessionId === "string" && /^[0-9a-f]{32}$/.test(message.sessionId) && typeof message.text === "string") {
    if (message.text.length <= maxMessageChars) initialize(message.sessionId, message.text);
    else setStatus("文档超过 1,048,576 个 UTF-16 单元，无法加载到编辑器。");
    return;
  }
  if (message.type === "requestSnapshot" && (exact("type", "protocolVersion", "sessionId") || exact("type", "protocolVersion", "sessionId", "requestId")) &&
      message.sessionId === sessionId && (message.requestId === undefined || typeof message.requestId === "string" && message.requestId.length > 0 && message.requestId.length <= 128)) {
    sendSnapshot(message.requestId as string | undefined);
    return;
  }
  if (message.type === "imageResources" && exact("type", "protocolVersion", "sessionId", "version", "resources") &&
      message.sessionId === sessionId && message.version === version && view && Array.isArray(message.resources) && message.resources.length <= 8192) {
    const resources = new Map<string, string>();
    const safeUrl = new RegExp(`^https://document\\.marker\\.example/${sessionId}/image/[0-9a-f]{48}$`);
    for (const resource of message.resources) {
      if (!resource || typeof resource !== "object" || Array.isArray(resource)) return;
      const item = resource as Record<string, unknown>;
      if (Object.keys(item).length !== 2 || typeof item.source !== "string" || item.source.length > 32768 || typeof item.url !== "string" || !safeUrl.test(item.url)) return;
      resources.set(item.source, item.url);
    }
    lightbox.setResources(resources.values());
    view.dispatch({ effects: imageResources.of(resources) });
    return;
  }
  if (message.type === "outline" && exact("type", "protocolVersion", "sessionId", "version", "headings") &&
      message.sessionId === sessionId && message.version === version && view && Array.isArray(message.headings)) {
    const headings: Heading[] = [];
    const ids = new Set<string>();
    let previousOffset = -1;
    for (const value of message.headings) {
      if (!value || typeof value !== "object" || Array.isArray(value)) return;
      const item = value as Record<string, unknown>;
      if (Object.keys(item).length !== 4 || typeof item.id !== "string" || !item.id || ids.has(item.id) ||
          typeof item.text !== "string" || item.text.length > 2000 || !Number.isInteger(item.level) ||
          (item.level as number) < 1 || (item.level as number) > 6 || !Number.isSafeInteger(item.offset) ||
          (item.offset as number) <= previousOffset || (item.offset as number) > view.state.doc.length) return;
      ids.add(item.id);
      previousOffset = item.offset as number;
      headings.push(item as Heading);
    }
    outline.setItems(headings, version);
    return;
  }
  if (message.type === "settings" && ["type", "protocolVersion", "sessionId"].every(key => key in message) &&
      message.sessionId === sessionId) {
    const nextSettings = normalizedSettings(Object.fromEntries(Object.entries(message).filter(([key]) => !["type", "protocolVersion", "sessionId"].includes(key))));
    if (nextSettings) styleSettings(nextSettings);
    return;
  }
  if (message.type === "toolbarState" && exact("type", "protocolVersion", "sessionId", "title", "notification", "busy") &&
      message.sessionId === sessionId && typeof message.title === "string" && message.title.length <= 4096 &&
      typeof message.notification === "string" && message.notification.length <= 4096 && typeof message.busy === "boolean") {
    toolbar?.updateState(message.title, message.notification, message.busy);
    diskChangePrompt.setBusy(message.busy);
    return;
  }
  if (message.type === "diskChange" && exact("type", "protocolVersion", "sessionId", "notificationId", "busy") &&
      message.sessionId === sessionId && typeof message.busy === "boolean" &&
      (message.notificationId === null || typeof message.notificationId === "string" && /^[0-9a-f]{32}$/.test(message.notificationId))) {
    diskChangePrompt.update(message.notificationId as string | null, message.busy);
    return;
  }
  if (message.type === "editorCommand" && exact("type", "protocolVersion", "sessionId", "command") && message.sessionId === sessionId && view) {
    if (message.command === "undo" || message.command === "redo" || message.command === "find" || message.command === "replace" || message.command === "toggleSource")
      runEditorCommand(message.command);
    return;
  }
  if (message.type === "revealSource" && exact("type", "protocolVersion", "sessionId", "version", "offset") &&
      message.sessionId === sessionId && message.version === version && Number.isSafeInteger(message.offset) && view &&
      (message.offset as number) >= 0 && (message.offset as number) <= view.state.doc.length) {
    if (view.compositionStarted) {
      setStatus("请先完成输入法候选输入，再定位源码。");
      return;
    }
    const offset = message.offset as number;
    view.dispatch({ selection: { anchor: offset }, effects: EditorView.scrollIntoView(offset, { y: "start" }) });
    view.focus();
  }
}

function isSettings(value: unknown): value is Settings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).every(key => ["theme", "fontSize", "lineHeight", "lineWrapping"].includes(key)) &&
    ["theme", "fontSize", "lineHeight", "lineWrapping"].every(key => key in item) &&
    (item.theme === "light" || item.theme === "dark" || item.theme === "system") &&
    typeof item.fontSize === "number" && item.fontSize >= 12 && item.fontSize <= 24 &&
    typeof item.lineHeight === "number" && Number.isFinite(item.lineHeight) && item.lineHeight >= 1.2 && item.lineHeight <= 2 && typeof item.lineWrapping === "boolean";
}

function initialize(nextSessionId: string, text: string): void {
  if (nextSessionId === sessionId) return;
  diskChangePrompt.update(null, false);
  currentRichNodes = [];
  footnoteReturn = undefined;
  if (view) view.destroy();
  outline.reset();
  lightbox.setResources([]);
  sessionId = nextSessionId;
  version = 0;
  fullSnapshotPending = false;
  toolbar?.updateState("", "", false);
  toolbar?.setReady(true);
  toolbar?.setSourceMode(false);
  view = new EditorView({
    parent: editorParent!,
    state: EditorState.create({
      doc: text,
      extensions: [
        codeCompartment.of(markdownSupport(text.length)),
        EditorState.transactionExtender.of(transaction =>
          transaction.docChanged && (transaction.startState.doc.length <= 100000) !== (transaction.newDoc.length <= 100000)
            ? { effects: codeCompartment.reconfigure(markdownSupport(transaction.newDoc.length)) } : null),
        placeholder("写下新的想法…"),
        liveMarkdown,
        markdownFormattingKeymap,
        markdownLinkActions(url => {
          if (url.startsWith("#")) outline.navigateAnchor(url, version);
          else if (sessionId) post({ type: "openLink", sessionId, version, url });
        }),
        EditorView.scrollMargins.of(editor => ({ top: toolbarScrollMargin(editor) })),
        history(),
        search({ top: true, createPanel: createSearchPanel }),
        settingsCompartment.of([]),
        keymap.of([
          { key: "Ctrl-Alt-m", run: toggleSource, preventDefault: true },
          { key: "Ctrl-Enter", run: insertParagraph },
          { key: "Ctrl-n", run: () => sendCommand("new") },
          { key: "Ctrl-o", run: () => sendCommand("open") },
          { key: "Ctrl-h", run: openReplacePanel, preventDefault: true },
          ...searchKeymap,
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.contentAttributes.of({ "aria-label": "Markdown 呈现编辑器", "aria-description": "点击文档直接编辑。Ctrl+Enter 新建段落，Ctrl+Alt+M 临时查看或隐藏 Markdown 源码" }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) {
            currentRichNodes = [];
            footnoteReturn = undefined;
            outline.invalidate();
            lightbox.close();
            scheduleStatistics();
            if (version >= Number.MAX_SAFE_INTEGER) {
              fullSnapshotPending = true;
              setStatus("编辑器版本已达上限；内容保留在本地编辑器中。");
              return;
            }
            const baseVersion = version;
            version++;
            if (fullSnapshotPending) {
              sendSnapshot();
            } else {
              const changes: Array<{ from: number; to: number; insert: string }> = [];
              update.changes.iterChanges((from, to, _fromNew, _toNew, inserted) => changes.push({ from, to, insert: inserted.toString() }));
              if (!post({ type: "changes", sessionId, baseVersion, version, changes })) {
                fullSnapshotPending = true;
                sendSnapshot();
              }
            }
          }
          if (update.docChanged || update.selectionSet) sendStatus(update.view);
          if (update.viewportChanged || update.selectionSet) outline.onScroll();
        }),
        EditorView.domEventHandlers({
          compositionend: () => {
            if (fullSnapshotPending) requestAnimationFrame(() => sendSnapshot());
            return false;
          },
        }),
      ],
    }),
  });
  view.scrollDOM.addEventListener("scroll", () => outline.onScroll(), { passive: true });
  styleSettings(settings);
  toolbar?.updateStatistics(0, 0);
  scheduleStatistics();
  sendSnapshot();
  sendStatus(view);
  post({ type: "sourceMode", sessionId, version, sourceMode: false });
}

bridge?.addEventListener("message", (event: MessageEvent<unknown>) => {
  const encoded = JSON.stringify(event.data);
  if (encoded === undefined || new TextEncoder().encode(encoded).length > maxMessageBytes) {
    setStatus("桌面端消息超过 2 MiB 限制，已忽略该消息。");
    return;
  }
  applyHostMessage(event.data);
});

matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (settings.theme === "system") styleSettings(settings);
});

if (bridge) {
  post({ type: "ready" });
} else {
  app.textContent = "编辑器等待 Marker 桌面端连接。";
}
