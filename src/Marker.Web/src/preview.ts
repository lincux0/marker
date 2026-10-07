import DOMPurify from "dompurify";
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

const maxHtmlChars = 4 * 1024 * 1024;
const preview = document.querySelector<HTMLElement>("#preview");
if (!preview) throw new Error("找不到预览入口元素。");

const bridge = window.chrome?.webview;
let sessionId: string | undefined;
let version = -1;

bridge?.addEventListener("message", (event: MessageEvent<unknown>) => {
  const message = event.data as Record<string, unknown> | null;
  if (!message || typeof message !== "object") return;
  if (
    message.type === "initialize" &&
    typeof message.sessionId === "string" &&
    /^[0-9a-f]{32}$/.test(message.sessionId)
  ) {
    if (message.sessionId !== sessionId) {
      sessionId = message.sessionId;
      version = -1;
      preview.replaceChildren();
    }
    return;
  }
  if (
    message.type !== "render" || typeof sessionId !== "string" || message.sessionId !== sessionId ||
    typeof message.version !== "number" || !Number.isSafeInteger(message.version) || message.version < version ||
    message.version < 0 ||
    typeof message.html !== "string" || message.html.length > maxHtmlChars
  ) return;

  version = message.version;
  const clean = DOMPurify.sanitize(message.html, {
    ALLOWED_TAGS: [
      "p", "br", "hr", "h1", "h2", "h3", "h4", "h5", "h6", "blockquote",
      "ul", "ol", "li", "pre", "code", "em", "strong", "del", "table", "img",
      "thead", "tbody", "tr", "th", "td",
    ],
    ALLOWED_ATTR: ["title", "start", "align", "src", "alt"],
    FORBID_TAGS: ["a", "svg", "math", "style", "iframe", "form", "input"],
    FORBID_ATTR: ["style", "href", "srcset", "onerror", "onload"],
    ALLOW_DATA_ATTR: false,
  });
  const template = document.createElement("template");
  template.innerHTML = clean;
  for (const image of template.content.querySelectorAll("img")) {
    const src = image.getAttribute("src") ?? "";
    const match = /^https:\/\/document\.marker\.example\/([0-9a-f]{32})\/image\/[0-9a-f]{48}$/.exec(src);
    if (!match || match[1] !== sessionId) image.remove();
  }
  preview.replaceChildren(template.content);
  bridge?.postMessage({ type: "rendered", sessionId, version });
});

if (bridge) {
  bridge.postMessage({ type: "ready" });
} else {
  preview.textContent = "预览等待 Marker 桌面端连接。";
}
