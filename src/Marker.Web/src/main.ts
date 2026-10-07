import { defaultKeymap, history, historyKeymap, isolateHistory } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { EditorState } from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import "./style.css";

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

type HostMessage =
  | { type: "initialize"; sessionId: string; text: string }
  | { type: "requestSnapshot"; sessionId: string; requestId?: string };

const maxMessageChars = 1_048_576;
const maxMessageBytes = 2_097_152;
const app = document.querySelector<HTMLElement>("#app");
const editorParent = document.querySelector<HTMLElement>("#editor");

if (!app || !editorParent) throw new Error("找不到编辑器入口元素。");

const bridge = window.chrome?.webview;
let view: EditorView | undefined;
let sessionId: string | undefined;
let version = 0;
let pendingSnapshot: number | undefined;
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

function post(message: object): boolean {
  if (!bridge) return false;
  const json = JSON.stringify(message);
  if (new TextEncoder().encode(json).length > maxMessageBytes) {
    setStatus("桥接消息超过 2 MiB 限制，编辑内容仍保留在此编辑器中，但暂时无法同步。");
    return false;
  }
  bridge.postMessage(message);
  return true;
}

function sendSnapshot(requestId?: string): void {
  if (!view || !sessionId) return;
  if (pendingSnapshot !== undefined) window.clearTimeout(pendingSnapshot);
  pendingSnapshot = undefined;
  if (requestId && view.compositionStarted) {
    post({ type: "snapshotError", sessionId, requestId, reason: "compositionInProgress" });
    setStatus("请先完成输入法候选输入，尚未提交保存内容。");
    return;
  }
  const text = view.state.doc.toString();
  if (text.length > maxMessageChars) {
    setStatus("文档超过 1,048,576 个 UTF-16 单元，编辑内容仍保留在此编辑器中，但暂时无法同步预览。");
    return;
  }
  if (post({ type: "snapshot", sessionId, version, text, ...(requestId ? { requestId } : {}) })) setStatus("");
}

function sendCommand(command: "new" | "open" | "save" | "saveAs"): boolean {
  if (!sessionId) return false;
  return post({ type: "command", sessionId, command });
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

function initialize(nextSessionId: string, text: string): void {
  if (nextSessionId === sessionId) return;
  if (pendingSnapshot !== undefined) window.clearTimeout(pendingSnapshot);
  pendingSnapshot = undefined;
  if (view) view.destroy();
  sessionId = nextSessionId;
  version = 0;
  view = new EditorView({
    parent: editorParent!,
    state: EditorState.create({
      doc: text,
      extensions: [
        markdown(),
        syntaxHighlighting(defaultHighlightStyle),
        history(),
        keymap.of([
          { key: "Ctrl-Enter", run: insertParagraph },
          { key: "Ctrl-n", run: () => sendCommand("new") },
          { key: "Ctrl-o", run: () => sendCommand("open") },
          ...defaultKeymap,
          ...historyKeymap,
        ]),
        EditorView.contentAttributes.of({ "aria-label": "Markdown 编辑器", "aria-description": "Ctrl+Enter 在当前行后新建段落" }),
        EditorView.updateListener.of((update) => {
          if (!update.docChanged) return;
          version++;
          if (pendingSnapshot !== undefined) window.clearTimeout(pendingSnapshot);
          pendingSnapshot = window.setTimeout(sendSnapshot, 100);
        }),
        EditorView.domEventHandlers({
          compositionend: () => {
            window.setTimeout(sendSnapshot, 0);
            return false;
          },
        }),
        EditorView.lineWrapping,
      ],
    }),
  });
  sendSnapshot();
}

bridge?.addEventListener("message", (event: MessageEvent<unknown>) => {
  const encoded = JSON.stringify(event.data);
  if (encoded === undefined || new TextEncoder().encode(encoded).length > maxMessageBytes) {
    setStatus("桌面端消息超过 2 MiB 限制，已忽略该消息。");
    return;
  }
  const message = event.data as Partial<HostMessage> | null;
  if (!message || typeof message !== "object") return;
  if (message.type === "initialize") {
    if (
      typeof message.sessionId === "string" &&
      message.sessionId.length > 0 && message.sessionId.length <= 128 &&
      typeof message.text === "string"
    ) {
      if (message.text.length <= maxMessageChars) initialize(message.sessionId, message.text);
      else setStatus("文档超过 1,048,576 个 UTF-16 单元，无法加载到当前原型编辑器。");
    }
    return;
  }
  if (message.type === "requestSnapshot" && message.sessionId === sessionId) {
    if (message.requestId !== undefined && (typeof message.requestId !== "string" || message.requestId.length === 0 || message.requestId.length > 128)) {
      setStatus("桌面端快照请求编号无效，已忽略该请求。");
      return;
    }
    sendSnapshot(message.requestId);
  }
});

if (bridge) {
  post({ type: "ready" });
} else {
  app.textContent = "编辑器等待 Marker 桌面端连接。";
}
