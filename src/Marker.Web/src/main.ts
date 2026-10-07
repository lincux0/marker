import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
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
  | { type: "requestSnapshot"; sessionId: string };

const maxMessageChars = 1_048_576;
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

function post(message: object): void {
  bridge?.postMessage(message);
}

function sendSnapshot(): void {
  if (!view || !sessionId) return;
  if (pendingSnapshot !== undefined) window.clearTimeout(pendingSnapshot);
  pendingSnapshot = undefined;
  const text = view.state.doc.toString();
  if (text.length > maxMessageChars) {
    setStatus("文档超过 1,048,576 个 UTF-16 单元，编辑内容仍保留在此编辑器中，但暂时无法同步预览。");
    return;
  }
  setStatus("");
  post({ type: "snapshot", sessionId, version, text });
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
        keymap.of([...defaultKeymap, ...historyKeymap]),
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
  if (message.type === "requestSnapshot" && message.sessionId === sessionId) sendSnapshot();
});

if (bridge) {
  post({ type: "ready" });
} else {
  app.textContent = "编辑器等待 Marker 桌面端连接。";
}
