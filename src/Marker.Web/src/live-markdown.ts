import { syntaxTree } from "@codemirror/language";
import { deleteCharBackward, isolateHistory } from "@codemirror/commands";
import { EditorSelection, Prec, StateEffect, StateField, type EditorState, type SelectionRange, type Range } from "@codemirror/state";
import { Decoration, EditorView, WidgetType, keymap, type DecorationSet } from "@codemirror/view";

export const imageResources = StateEffect.define<ReadonlyMap<string, string>>();
const composition = StateEffect.define<boolean>();
const toggleSource = StateEffect.define<boolean>();

class SymbolWidget extends WidgetType {
  constructor(readonly text: string, readonly className: string) { super(); }
  eq(other: SymbolWidget): boolean { return other.text === this.text && other.className === this.className; }
  toDOM(view: EditorView): HTMLElement {
    const element = document.createElement("span");
    element.className = this.className;
    element.textContent = this.text;
    if (this.className.split(" ").includes("cm-md-task")) {
      element.setAttribute("role", "checkbox");
      element.setAttribute("aria-checked", String(this.className.includes("cm-md-task-checked")));
      element.setAttribute("aria-label", "切换任务完成状态");
      element.tabIndex = 0;
      element.addEventListener("keydown", event => {
        if ((event.key === " " || event.key === "Enter") && toggleTask(view, element, true)) {
          event.preventDefault();
          event.stopPropagation();
        }
      });
    } else element.setAttribute("aria-hidden", "true");
    return element;
  }
  ignoreEvent(): boolean { return false; }
}

class ImageWidget extends WidgetType {
  constructor(readonly url: string, readonly alt: string) { super(); }
  eq(other: ImageWidget): boolean { return other.url === this.url && other.alt === this.alt; }
  toDOM(view: EditorView): HTMLElement {
    const wrapper = document.createElement("span");
    wrapper.className = "cm-md-image";
    const image = document.createElement("img");
    image.src = this.url;
    image.alt = this.alt;
    image.loading = "lazy";
    image.draggable = false;
    image.addEventListener("load", () => view.requestMeasure());
    image.addEventListener("error", () => { wrapper.classList.add("cm-md-image-unavailable"); view.requestMeasure(); });
    wrapper.append(image);
    return wrapper;
  }
  ignoreEvent(): boolean { return false; }
}

type Presentation = {
  decorations: DecorationSet;
  atoms: DecorationSet;
  closing: DecorationSet;
  resources: ReadonlyMap<string, string>;
  composing: boolean;
  source: boolean;
};

function decorate(state: EditorState, resources: ReadonlyMap<string, string>, source: boolean): { decorations: DecorationSet; atoms: DecorationSet; closing: DecorationSet } {
  if (source) return { decorations: Decoration.none, atoms: Decoration.none, closing: Decoration.none };
  const marks: Range<Decoration>[] = [];
  const atoms: Range<Decoration>[] = [];
  const closing: Range<Decoration>[] = [];
  const line = (from: number, className: string, attributes?: Record<string, string>): void => {
    marks.push(Decoration.line({ class: className, attributes }).range(state.doc.lineAt(from).from));
  };
  const hide = (from: number, to: number, widget?: WidgetType, block = false, trailing = false): void => {
    if (to <= from) return;
    const range = Decoration.replace({ ...(widget ? { widget } : {}), block, inclusiveStart: block, inclusiveEnd: false }).range(from, to);
    marks.push(range);
    atoms.push(range);
    if (trailing) closing.push(range);
  };
  const style = (from: number, to: number, className: string, attributes?: Record<string, string>): void => {
    if (to > from) marks.push(Decoration.mark({ class: className, attributes }).range(from, to));
  };
  const followingSpace = (to: number): number => {
    const end = state.doc.lineAt(to).to;
    while (to < end && /[ \t]/.test(state.doc.sliceString(to, to + 1))) to++;
    return to;
  };

  // ponytail: rebuild the already-parsed syntax tree on edits; incremental decoration mapping if very large documents become slow.
  syntaxTree(state).iterate({ enter(node) {
    const name = node.name;
    const syntax = node.node;
    if (/^(?:ATX|Setext)Heading[1-6]$/.test(name)) {
      line(node.from, `cm-md-heading cm-md-h${name.at(-1)}`);
      for (let child = syntax.firstChild; child; child = child.nextSibling) {
        if (child.name !== "HeaderMark") continue;
        const headingLine = state.doc.lineAt(child.from);
        if (child.from === headingLine.from && name.startsWith("Setext")) {
          hide(headingLine.from, Math.min(state.doc.length, headingLine.to + 1), undefined, true);
        } else hide(child.from, child.from === node.from ? followingSpace(child.to) : child.to);
      }
    } else if (name === "Paragraph" && syntax.parent?.name === "Document") {
      line(node.to, "cm-md-paragraph");
    } else if (name === "StrongEmphasis") style(node.from, node.to, "cm-md-strong");
    else if (name === "Emphasis") style(node.from, node.to, "cm-md-emphasis");
    else if (name === "Strikethrough") style(node.from, node.to, "cm-md-strike");
    else if (name === "InlineCode") style(node.from, node.to, "cm-md-inline-code");
    else if (["EmphasisMark", "StrikethroughMark", "SubscriptMark", "SuperscriptMark"].includes(name)) hide(node.from, node.to, undefined, false, node.to === syntax.parent?.to);
    else if (name === "Subscript") style(node.from, node.to, "cm-md-subscript");
    else if (name === "Superscript") style(node.from, node.to, "cm-md-superscript");
    else if (name === "CodeMark" && syntax.parent?.name === "InlineCode") hide(node.from, node.to, undefined, false, node.to === syntax.parent.to);
    else if (name === "Blockquote") {
      for (let number = state.doc.lineAt(node.from).number; number <= state.doc.lineAt(node.to).number; number++) line(state.doc.line(number).from, "cm-md-quote");
    } else if (name === "QuoteMark") hide(node.from, followingSpace(node.to));
    else if (name === "ListItem") {
      const itemLine = state.doc.lineAt(node.from);
      line(node.from, "cm-md-list", { "data-depth": String(Math.min(6, Math.floor((node.from - itemLine.from) / 2))) });
    } else if (name === "ListMark") {
      const task = syntax.parent?.getChild("Task");
      const label = task ? "" : syntax.parent?.parent?.name === "OrderedList" ? state.doc.sliceString(node.from, node.to) : "•";
      hide(node.from, followingSpace(node.to), new SymbolWidget(label, "cm-md-list-marker"));
    } else if (name === "TaskMarker") {
      const checked = /x/i.test(state.doc.sliceString(node.from, node.to));
      hide(node.from, followingSpace(node.to), new SymbolWidget("", `cm-md-task${checked ? " cm-md-task-checked" : ""}`));
    } else if (name === "FencedCode" || name === "CodeBlock") {
      const start = state.doc.lineAt(node.from).number;
      const end = state.doc.lineAt(node.to).number;
      const fenceMarks = name === "FencedCode" ? syntax.getChildren("CodeMark") : [];
      for (let number = start; number <= end; number++) {
        const current = state.doc.line(number);
        const fence = fenceMarks.find(mark => state.doc.lineAt(mark.from).number === number);
        if (fence) {
          const info = syntax.getChild("CodeInfo");
          if (number === start) {
            hide(fence.from, current.to, new SymbolWidget(info ? state.doc.sliceString(info.from, info.to) : "代码", "cm-md-code-language"));
            line(current.from, "cm-md-code-header");
          } else if (current.from === fence.from) hide(current.from, Math.min(state.doc.length, current.to + 1), undefined, true);
          else hide(fence.from, current.to);
        } else line(current.from, `cm-md-code-line${number === end - (fenceMarks.length > 1 ? 1 : 0) ? " cm-md-code-last" : ""}`);
      }
      return false;
    } else if (name === "Link" || name === "Image") {
      const opening = syntax.firstChild;
      const url = syntax.getChild("URL");
      // A reference link still renders its label; the definition remains available in source mode.
      let close = opening?.nextSibling;
      while (close && !(close.name === "LinkMark" && state.doc.sliceString(close.from, close.to) === "]")) close = close.nextSibling;
      if (opening && close) {
        hide(opening.from, opening.to);
        hide(close.from, node.to, undefined, false, true);
        style(opening.to, close.from, name === "Image" ? "cm-md-image-caption" : "cm-md-link",
          name === "Link" ? { title: "按ctrl并点击以访问" } : undefined);
        if (name === "Image") {
          const rawSource = url ? state.doc.sliceString(url.from, url.to).replace(/^<|>$/g, "") : "";
          const unescaped = rawSource.replace(/\\([!"#$%&'()*+,\-./:;<=>?@[\\\]^_`{|}~])/g, "$1");
          const decoded = unescaped.replace(/&(?:#[0-9]+|#x[0-9a-f]+|[a-z][a-z0-9]+);/gi, entity => {
            const decoder = document.createElement("textarea");
            decoder.innerHTML = entity;
            return decoder.value;
          });
          const imageUrl = resources.get(rawSource) ?? resources.get(unescaped) ?? resources.get(decoded);
          const alt = state.doc.sliceString(opening.to, close.from);
          marks.push(Decoration.widget({ widget: imageUrl ? new ImageWidget(imageUrl, alt) : new SymbolWidget("▧", "cm-md-image-placeholder"), side: -1 }).range(node.from));
        }
      }
    } else if (name === "Autolink") {
      style(node.from, node.to, "cm-md-link", { title: "按ctrl并点击以访问" });
      if (state.doc.sliceString(node.from, node.from + 1) === "<") { hide(node.from, node.from + 1); hide(node.to - 1, node.to, undefined, false, true); }
    } else if (name === "HorizontalRule") {
      hide(node.from, node.to, new SymbolWidget("", "cm-md-rule"));
    } else if (name === "TableHeader" || name === "TableRow") {
      const cells = syntax.getChildren("TableCell");
      if (!cells.length) return;
      const lastRow = name === "TableRow" && !syntax.nextSibling;
      line(node.from, `cm-md-table-row${name === "TableHeader" ? " cm-md-table-header" : ""}${lastRow ? " cm-md-table-last" : ""}`, { style: `--table-columns:${cells.length}` });
      let position = node.from;
      for (const cell of cells) {
        hide(position, cell.from);
        style(cell.from, cell.to, "cm-md-table-cell");
        position = cell.to;
      }
      hide(position, node.to);
    } else if (name === "TableDelimiter" && syntax.parent?.name === "Table") {
      const separator = state.doc.lineAt(node.from);
      hide(separator.from, Math.min(state.doc.length, separator.to + 1), undefined, true);
    } else if (name === "LinkReference") {
      line(node.from, "cm-md-reference");
    }
  } });
  return { decorations: Decoration.set(marks, true), atoms: Decoration.set(atoms, true), closing: Decoration.set(closing, true) };
}

const presentation = StateField.define<Presentation>({
  create(state) {
    const resources = new Map<string, string>();
    return { ...decorate(state, resources, false), resources, composing: false, source: false };
  },
  update(value, transaction) {
    let { resources, composing, source } = value;
    let refresh = transaction.docChanged || syntaxTree(transaction.startState) !== syntaxTree(transaction.state);
    for (const effect of transaction.effects) {
      if (effect.is(imageResources)) { resources = effect.value; refresh = true; }
      if (effect.is(composition)) { composing = effect.value; refresh = !composing; }
      if (effect.is(toggleSource)) { source = effect.value; refresh = true; }
    }
    const next = composing || !refresh
      ? { decorations: value.decorations.map(transaction.changes), atoms: value.atoms.map(transaction.changes), closing: value.closing.map(transaction.changes) }
      : decorate(transaction.state, resources, source);
    return { ...next, resources, composing, source };
  },
  provide: field => [EditorView.decorations.from(field, value => value.decorations), EditorView.atomicRanges.of(view => view.state.field(field).atoms)],
});

export function toggleSourceMode(view: EditorView): boolean {
  if (view.compositionStarted || view.state.readOnly) return false;
  const source = !view.state.field(presentation).source;
  view.dispatch({ effects: toggleSource.of(source) });
  view.dom.dataset.sourceMode = String(source);
  return true;
}

type TextReplacement = { from: number; to: number; insert: string };

function editRanges(view: EditorView, transform: (range: SelectionRange, state: EditorState) => { changes?: TextReplacement | TextReplacement[]; range: SelectionRange }): boolean {
  if (view.compositionStarted || view.state.readOnly) return false;
  const spec = view.state.changeByRange(range => transform(range, view.state));
  view.dispatch({ ...spec, userEvent: "input", annotations: isolateHistory.of("full") });
  return true;
}

function wrapSelection(before: string, after = before, placeholder = "文本"): (view: EditorView) => boolean {
  return view => editRanges(view, (range, state) => {
    const { from, to } = range;
    const selected = state.sliceDoc(from, to);
    const hasOuterMarks = from >= before.length && to + after.length <= state.doc.length &&
      state.sliceDoc(from - before.length, from) === before && state.sliceDoc(to, to + after.length) === after;
    if (hasOuterMarks && selected) {
      const unwrappedFrom = from - before.length;
      const selectionTo = unwrappedFrom + selected.length;
      const changeTo = to + after.length;
      const anchor = range.anchor <= range.head ? unwrappedFrom : selectionTo;
      const head = range.anchor <= range.head ? selectionTo : unwrappedFrom;
      return { changes: { from: unwrappedFrom, to: changeTo, insert: selected }, range: EditorSelection.range(anchor, head) };
    }
    const content = selected || placeholder;
    const insert = `${before}${content}${after}`;
    const contentFrom = from + before.length;
    const anchor = selected ? (range.anchor <= range.head ? contentFrom : contentFrom + selected.length) : contentFrom;
    const head = selected ? (range.anchor <= range.head ? contentFrom + selected.length : contentFrom) : contentFrom + placeholder.length;
    return { changes: { from, to, insert }, range: EditorSelection.range(anchor, head) };
  });
}

function setHeading(level: number): (view: EditorView) => boolean {
  return view => {
    if (view.compositionStarted || view.state.readOnly) return false;
    const { state } = view;
    const requestedPrefix = level ? `${"#".repeat(level)} ` : "";
    const lineStarts = new Set<number>();
    for (const range of state.selection.ranges) {
      const first = state.doc.lineAt(range.from);
      const last = state.doc.lineAt(range.to > range.from ? range.to - 1 : range.to);
      for (let number = first.number; number <= last.number; number++) lineStarts.add(state.doc.line(number).from);
    }
    const changes: TextReplacement[] = [];
    for (const from of [...lineStarts].sort((a, b) => a - b)) {
      const line = state.doc.lineAt(from);
      const oldPrefix = /^(#{1,6})[ \t]+/.exec(line.text)?.[0] ?? "";
      const newPrefix = oldPrefix === requestedPrefix ? "" : requestedPrefix;
      if (oldPrefix !== newPrefix) changes.push({ from, to: from + oldPrefix.length, insert: newPrefix });
    }
    const mapPosition = (position: number): number => {
      let delta = 0;
      for (const change of changes) {
        if (position < change.from) break;
        if (position <= change.to) return change.from + delta + change.insert.length;
        delta += change.insert.length - (change.to - change.from);
      }
      return position + delta;
    };
    view.dispatch({
      changes,
      selection: EditorSelection.create(state.selection.ranges.map(range => EditorSelection.range(mapPosition(range.anchor), mapPosition(range.head))), state.selection.mainIndex),
      userEvent: "input",
      annotations: isolateHistory.of("full"),
    });
    return true;
  };
}

export const markdownFormattingKeymap = keymap.of([
  { key: "Ctrl-b", run: wrapSelection("**"), preventDefault: true },
  { key: "Ctrl-i", run: wrapSelection("*"), preventDefault: true },
  { key: "Ctrl-Shift-`", run: wrapSelection("`"), preventDefault: true },
  { key: "Alt-Shift-5", run: wrapSelection("~~"), preventDefault: true },
  { key: "Ctrl-k", run: wrapSelection("[", "](url)", "链接文本"), preventDefault: true },
  { key: "Ctrl-1", run: setHeading(1), preventDefault: true },
  { key: "Ctrl-2", run: setHeading(2), preventDefault: true },
  { key: "Ctrl-3", run: setHeading(3), preventDefault: true },
  { key: "Ctrl-4", run: setHeading(4), preventDefault: true },
  { key: "Ctrl-5", run: setHeading(5), preventDefault: true },
  { key: "Ctrl-6", run: setHeading(6), preventDefault: true },
  { key: "Ctrl-0", run: setHeading(0), preventDefault: true },
]);

function toggleTask(view: EditorView, checkbox: Element, keepCheckboxFocus = false): boolean {
  if (view.compositionStarted || view.state.readOnly) return false;
  const position = view.posAtDOM(checkbox);
  let marker: number | undefined;
  view.state.field(presentation).atoms.between(Math.max(0, position - 1), position + 4, (from, to) => {
    if (marker === undefined && /^\[[ xX]\]/.test(view.state.doc.sliceString(from, to))) marker = from;
  });
  if (marker === undefined) return false;
  const markerPosition = marker;
  const checked = /x/i.test(view.state.doc.sliceString(markerPosition, markerPosition + 3));
  view.dispatch({ changes: { from: markerPosition + 1, to: markerPosition + 2, insert: checked ? " " : "x" }, userEvent: "input" });
  if (keepCheckboxFocus) {
    const next = Array.from(view.dom.querySelectorAll<HTMLElement>(".cm-md-task")).find(element => {
      const pos = view.posAtDOM(element);
      return pos >= markerPosition - 1 && pos <= markerPosition + 3;
    });
    next?.focus({ preventScroll: true });
  } else view.focus();
  return true;
}

export const liveMarkdown = [
  presentation,
  Prec.high(keymap.of([{ key: "Backspace", run(view: EditorView) {
    if (view.compositionStarted || view.state.readOnly || view.state.selection.ranges.length !== 1 || !view.state.selection.main.empty) return false;
    const closing = view.state.field(presentation).closing;
    let anchor = view.state.selection.main.head;
    for (;;) {
      const previous = anchor;
      closing.between(anchor, anchor, (from, to) => { if (to === anchor) anchor = from; });
      if (previous === anchor) break;
    }
    if (anchor === view.state.selection.main.head) return false;
    view.dispatch({ selection: EditorSelection.cursor(anchor) });
    return deleteCharBackward(view);
  }, preventDefault: true }])),
  EditorView.domEventHandlers({
    compositionstart(_event, view) { view.dispatch({ effects: composition.of(true) }); return false; },
    compositionend(_event, view) {
      // Chromium may deliver the final input after compositionend. Leave that editable DOM intact until the next frame.
      requestAnimationFrame(() => { if (view.dom.isConnected) view.dispatch({ effects: composition.of(false) }); });
      return false;
    },
    mousedown(event, view) {
      const checkbox = (event.target as Element).closest(".cm-md-task");
      if (checkbox && toggleTask(view, checkbox)) { event.preventDefault(); return true; }
      return false;
    },
    mouseup(_event, view) {
      if (view.compositionStarted) return false;
      const selection = view.state.selection.main;
      if (!selection.empty) return false;
      // Mouse hits next to a replaced prefix can land inside its invisible source range.
      let anchor = selection.head;
      view.state.field(presentation).atoms.between(anchor, anchor, (from, to) => { if (anchor >= from && anchor < to) anchor = to; });
      if (anchor !== selection.head) view.dispatch({ selection: EditorSelection.cursor(anchor) });
      return false;
    },
  }),
];
