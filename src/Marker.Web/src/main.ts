import { defaultKeymap, history, historyKeymap, isolateHistory, redo, undo } from "@codemirror/commands";
import { markdown, markdownLanguage } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { Compartment, EditorState } from "@codemirror/state";
import { closeSearchPanel, findNext, findPrevious, getSearchQuery, openSearchPanel, replaceAll, replaceNext, search, searchKeymap, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorView, keymap, type Panel } from "@codemirror/view";
import { enableFileDrop } from "./file-drop";
import { markdownLinkActions } from "./links";
import { imageResources, liveMarkdown, markdownFormattingKeymap, toggleSourceMode } from "./live-markdown";
import "./style.css";

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
type Settings = {
  theme: Theme;
  fontSize: number;
  lineHeight: number;
  lineWrapping: boolean;
  reducedMotion?: boolean;
  highContrast?: boolean;
};

const protocolVersion = 1 as const;
const maxMessageChars = 1_048_576;
const maxMessageBytes = 2_097_152;
const app = document.querySelector<HTMLElement>("#app");
const editorParent = document.querySelector<HTMLElement>("#editor");

if (!app || !editorParent) throw new Error("找不到编辑器入口元素。");

const bridge = window.chrome?.webview;
const settingsCompartment = new Compartment();
let view: EditorView | undefined;
let sessionId: string | undefined;
let version = 0;
let fullSnapshotPending = false;
let settings: Settings = {
  theme: "system",
  fontSize: 15,
  lineHeight: 1.5,
  lineWrapping: true,
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

function sendCommand(command: "new" | "open" | "save" | "saveAs"): boolean {
  return sessionId ? post({ type: "command", sessionId, command }) : false;
}

function toggleSource(editor: EditorView): boolean {
  if (!toggleSourceMode(editor)) return false;
  post({ type: "sourceMode", sessionId, version, sourceMode: editor.dom.dataset.sourceMode === "true" });
  return true;
}

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

const darkHighlightStyle = HighlightStyle.define(defaultHighlightStyle.specs.map(style => style.color ? {
  ...style,
  color: style.tag === tags.meta || style.tag === tags.comment ? "var(--editor-muted)" : "var(--editor-accent)",
} : style));

function styleSettings(next: Settings): void {
  settings = next;
  if (!view) return;
  document.documentElement.dataset.theme = next.theme;
  if (next.reducedMotion === undefined) delete document.documentElement.dataset.reducedMotion;
  else document.documentElement.dataset.reducedMotion = String(next.reducedMotion);
  if (next.highContrast === undefined) delete document.documentElement.dataset.highContrast;
  else document.documentElement.dataset.highContrast = String(next.highContrast);
  editorParent!.dataset.theme = next.theme;
  editorParent!.style.setProperty("--editor-font-size", `${next.fontSize}px`);
  editorParent!.style.setProperty("--editor-line-height", String(next.lineHeight));
  const dark = next.theme === "dark" || next.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches;
  view.dispatch({ effects: settingsCompartment.reconfigure([
    EditorView.theme({ "&": { color: "var(--editor-foreground)", backgroundColor: "var(--editor-background)" } }, { dark }),
    syntaxHighlighting(dark ? darkHighlightStyle : defaultHighlightStyle),
    next.lineWrapping ? EditorView.lineWrapping : [],
  ]) });
}

function applyHostMessage(value: unknown): void {
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const message = value as Record<string, unknown>;
  if (message.protocolVersion !== protocolVersion || typeof message.type !== "string") return;
  const keys = Object.keys(message);
  const exact = (...allowed: string[]): boolean => keys.every(key => allowed.includes(key)) && allowed.every(key => key in message);

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
    view.dispatch({ effects: imageResources.of(resources) });
    return;
  }
  if (message.type === "settings" && keys.every(key => ["type", "protocolVersion", "sessionId", "theme", "fontSize", "lineHeight", "lineWrapping", "reducedMotion", "highContrast"].includes(key)) &&
      ["type", "protocolVersion", "sessionId", "theme", "fontSize", "lineHeight", "lineWrapping"].every(key => key in message) &&
      message.sessionId === sessionId && isSettings({ theme: message.theme, fontSize: message.fontSize, lineHeight: message.lineHeight, lineWrapping: message.lineWrapping })) {
    const nextSettings: Settings = {
      theme: message.theme as Theme,
      fontSize: message.fontSize as number,
      lineHeight: message.lineHeight as number,
      lineWrapping: message.lineWrapping as boolean,
    };
    if (typeof message.reducedMotion === "boolean") nextSettings.reducedMotion = message.reducedMotion;
    else if ("reducedMotion" in message) return;
    if (typeof message.highContrast === "boolean") nextSettings.highContrast = message.highContrast;
    else if ("highContrast" in message) return;
    styleSettings(nextSettings);
    return;
  }
  if (message.type === "editorCommand" && exact("type", "protocolVersion", "sessionId", "command") && message.sessionId === sessionId && view) {
    if (view.compositionStarted) {
      if (message.command === "toggleSource") post({ type: "sourceMode", sessionId, version, sourceMode: view.dom.dataset.sourceMode === "true" });
      setStatus("请先完成输入法候选输入，再执行编辑器命令。");
      return;
    }
    switch (message.command) {
      case "undo": undo(view); break;
      case "redo": redo(view); break;
      case "find": openSearchPanel(view); break;
      case "replace": openReplacePanel(view); break;
      case "toggleSource": toggleSource(view); break;
    }
    return;
  }
  if (message.type === "revealSource" && exact("type", "protocolVersion", "sessionId", "version", "offset") &&
      message.sessionId === sessionId && message.version === version && Number.isSafeInteger(message.offset) && view) {
    if (view.compositionStarted) {
      setStatus("请先完成输入法候选输入，再定位源码。");
      return;
    }
    const offset = Math.min(view.state.doc.length, Math.max(0, message.offset as number));
    view.dispatch({ selection: { anchor: offset }, scrollIntoView: true });
    view.focus();
  }
}

function isSettings(value: unknown): value is Settings {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const item = value as Record<string, unknown>;
  return Object.keys(item).every(key => ["theme", "fontSize", "lineHeight", "lineWrapping", "reducedMotion", "highContrast"].includes(key)) &&
    ["theme", "fontSize", "lineHeight", "lineWrapping"].every(key => key in item) &&
    (item.reducedMotion === undefined || typeof item.reducedMotion === "boolean") &&
    (item.highContrast === undefined || typeof item.highContrast === "boolean") &&
    (item.theme === "light" || item.theme === "dark" || item.theme === "system") &&
    typeof item.fontSize === "number" && item.fontSize >= 12 && item.fontSize <= 24 &&
    typeof item.lineHeight === "number" && item.lineHeight >= 1.2 && item.lineHeight <= 2 && typeof item.lineWrapping === "boolean";
}

function initialize(nextSessionId: string, text: string): void {
  if (nextSessionId === sessionId) return;
  if (view) view.destroy();
  sessionId = nextSessionId;
  version = 0;
  fullSnapshotPending = false;
  view = new EditorView({
    parent: editorParent!,
    state: EditorState.create({
      doc: text,
      extensions: [
        markdown({ base: markdownLanguage }),
        liveMarkdown,
        markdownFormattingKeymap,
        markdownLinkActions(
          url => { if (sessionId) post({ type: "openLink", sessionId, version, url }); },
          () => setStatus("当前仅支持打开 HTTP(S) 绝对链接；相对链接和页内锚点可按 Ctrl+Alt+M 编辑。"),
        ),
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
            editorParent!.dataset.empty = String(update.state.doc.length === 0);
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
  editorParent!.dataset.empty = String(view.state.doc.length === 0);
  styleSettings(settings);
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
