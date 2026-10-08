import { syntaxTree } from "@codemirror/language";
import { EditorView } from "@codemirror/view";

function decodeDestination(raw: string): string {
  const escaped = raw.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
  const decoder = document.createElement("textarea");
  return escaped.replace(/&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi, entity => {
    decoder.innerHTML = entity;
    return decoder.value;
  });
}

function referenceKey(raw: string): string {
  return decodeDestination(raw.replace(/^\[|\]$/g, "")).trim().replace(/\s+/g, " ").toLowerCase();
}

function linkTarget(view: EditorView, position: number): string | undefined {
  const tree = syntaxTree(view.state);
  const references = new Map<string, string>();
  tree.iterate({ enter(node) {
    if (node.name !== "LinkReference") return;
    const label = node.node.getChild("LinkLabel");
    const url = node.node.getChild("URL");
    if (label && url) {
      const key = referenceKey(view.state.doc.sliceString(label.from, label.to));
      if (!references.has(key)) references.set(key, view.state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, ""));
    }
  } });
  const first = tree.resolveInner(position, -1);
  for (let node: typeof first | null = first; node; node = node.parent) {
    if (node.name === "Autolink") {
      return view.state.doc.sliceString(node.from, node.to).replace(/^<|>$/g, "");
    }
    if (node.name === "Link") {
      const url = node.node.getChild("URL");
      if (url) return view.state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, "");

      const opening = node.node.firstChild;
      let closing = opening?.nextSibling;
      while (closing && !(closing.name === "LinkMark" && view.state.doc.sliceString(closing.from, closing.to) === "]")) closing = closing.nextSibling;
      if (!opening || !closing) return undefined;
      const textLabel = view.state.doc.sliceString(opening.to, closing.from);
      const reference = node.node.getChild("LinkLabel");
      const key = reference && view.state.doc.sliceString(reference.from, reference.to) !== "[]"
        ? referenceKey(view.state.doc.sliceString(reference.from, reference.to))
        : referenceKey(textLabel);
      return references.get(key);
    }
  }
  return undefined;
}

function isExternalWebUrl(value: string): boolean {
  if (!value || value.length > 2048) return false;
  try {
    const url = new URL(value);
    return (url.protocol === "http:" || url.protocol === "https:") && !url.username && !url.password;
  } catch {
    return false;
  }
}

export function markdownLinkActions(open: (url: string) => void, unsupported: () => void) {
  let pointerStart: { id: number; x: number; y: number } | undefined;
  let dragged = false;
  return EditorView.domEventHandlers({
    pointerdown(event) {
      pointerStart = event.button === 0 && (event.target as Element).closest(".cm-md-link")
        ? { id: event.pointerId, x: event.clientX, y: event.clientY }
        : undefined;
      dragged = false;
      return false;
    },
    pointerup(event) {
      if (pointerStart) dragged = event.pointerId !== pointerStart.id || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 4;
      return false;
    },
    click(event, view) {
      const target = event.target instanceof Element ? event.target : event.target instanceof Node ? event.target.parentElement : null;
      if (view.compositionStarted || view.dom.dataset.sourceMode === "true" ||
          event.button !== 0 || event.detail !== 1 || event.ctrlKey || event.metaKey || event.altKey || event.shiftKey ||
          dragged || !view.state.selection.main.empty || !target) return false;
      const link = target.closest<HTMLElement>(".cm-md-link");
      if (!link) return false;

      let raw: string | undefined;
      try { raw = linkTarget(view, view.posAtDOM(link, 0) + 1); }
      catch { return false; }
      if (!raw) return false;
      const url = decodeDestination(raw);
      if (isExternalWebUrl(url)) open(url);
      else unsupported();
      return false;
    },
  });
}
