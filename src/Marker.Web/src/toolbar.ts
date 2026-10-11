export type NativeCommand = "new" | "open" | "save" | "saveAs" | "recover" | "settings" | "exportPdf";
export type EditorCommand = "undo" | "redo" | "find" | "replace" | "toggleSource" | "toggleOutline" | "toggleFocus";
export const configurableToolbarActions = ["new", "open", "save", "saveAs", "recover", "undo", "redo", "find", "replace", "toggleSource", "statistics"] as const;
export type ConfigurableToolbarAction = (typeof configurableToolbarActions)[number];
type Action = NativeCommand | EditorCommand | "statistics";
export function isHiddenToolbarActions(value: unknown): value is ConfigurableToolbarAction[] {
  return Array.isArray(value) && value.length <= configurableToolbarActions.length &&
    value.every(item => configurableToolbarActions.includes(item as ConfigurableToolbarAction)) && new Set(value).size === value.length;
}
type ToolbarOptions = {
  runNative(command: NativeCommand): void;
  runEditor(command: EditorCommand, trigger?: HTMLElement): void;
};

const iconPaths: Record<Action | "more", string[]> = {
  new: ["M5 3h10l4 4v14H5z", "M15 3v5h4", "M12 11v6", "M9 14h6"],
  open: ["M3 7h7l2 2h9v10H3z", "M3 7V5h7l2 2"],
  save: ["M4 3h14l3 3v15H3V3z", "M7 3v6h10V3", "M7 21v-8h10v8"],
  saveAs: ["M4 3h14l3 3v7", "M7 3v6h10V3", "M7 21v-6h5", "m14 18 5-5 2 2-5 5-3 1z"],
  recover: ["M3 12a9 9 0 1 1 2.6 6.4", "M3 5v7h7", "M12 8v5l3 2"],
  exportPdf: ["M5 3h10l4 4v5", "M15 3v5h4", "M5 3v18h7", "M17 12v9", "m13 17 4 4 4-4"],
  undo: ["M9 13 4 8l5-5", "M4 8h10a6.5 6.5 0 0 1 0 13h-2"],
  redo: ["m15 13 5-5-5-5", "M20 8H10a6.5 6.5 0 0 0 0 13h2"],
  find: ["M10.8 18.2a7.4 7.4 0 1 0 0-14.8 7.4 7.4 0 0 0 0 14.8z", "m16.2 16.2 4.3 4.3"],
  replace: ["M4 7h13", "m14 4 3 3-3 3", "M20 17H7", "m10 14-3 3 3 3", "M5 13h.01", "M19 11h.01"],
  toggleSource: ["m8 5-6 7 6 7", "m16 5 6 7-6 7", "m14 4-4 16"],
  toggleOutline: ["M8 5h13", "M8 12h13", "M8 19h13", "M3 5h.01", "M3 12h.01", "M3 19h.01"],
  toggleFocus: ["M8 3H3v5", "M16 3h5v5", "M3 16v5h5", "M21 16v5h-5"],
  settings: ["M10 3h4l.6 2.4a7 7 0 0 1 1.8 1l2.3-.7 2 3.5-1.8 1.7a7 7 0 0 1 0 2.1l1.8 1.7-2 3.5-2.3-.7a7 7 0 0 1-1.8 1L14 21h-4l-.6-2.4a7 7 0 0 1-1.8-1l-2.3.7-2-3.5 1.8-1.7a7 7 0 0 1 0-2.1L3.3 9.2l2-3.5 2.3.7a7 7 0 0 1 1.8-1L10 3z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
  statistics: ["M5 19.5V13.5", "M12 19.5V7.5", "M19 19.5V4.5"],
  more: ["M5 12h.01", "M12 12h.01", "M19 12h.01"],
};

function makeIcon(name: Action | "more"): SVGSVGElement {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 24 24");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("focusable", "false");
  for (const d of iconPaths[name]) {
    const path = document.createElementNS(svg.namespaceURI, "path");
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", "currentColor");
    path.setAttribute("stroke-width", "1.7");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    svg.append(path);
  }
  return svg;
}

const actions: Array<{ id: Action; label: string; shortcut?: string; overflow?: boolean; compactOverflow?: boolean }> = [
  { id: "new", label: "新建文档", shortcut: "Ctrl+N" },
  { id: "open", label: "打开文档", shortcut: "Ctrl+O" },
  { id: "save", label: "保存", shortcut: "Ctrl+S" },
  { id: "saveAs", label: "另存为", overflow: true },
  { id: "recover", label: "恢复草稿", overflow: true },
  { id: "exportPdf", label: "导出 PDF", compactOverflow: true },
  { id: "undo", label: "撤销", shortcut: "Ctrl+Z", compactOverflow: true },
  { id: "redo", label: "重做", shortcut: "Ctrl+Y", compactOverflow: true },
  { id: "find", label: "查找", shortcut: "Ctrl+F", compactOverflow: true },
  { id: "replace", label: "查找和替换", shortcut: "Ctrl+H", overflow: true },
  { id: "toggleSource", label: "代码模式", shortcut: "Ctrl+Alt+M" },
  { id: "toggleOutline", label: "文档大纲" },
  { id: "toggleFocus", label: "进入专注模式", overflow: true },
  { id: "statistics", label: "字数统计", overflow: true },
  { id: "settings", label: "设置" },
];

export class FloatingToolbar {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly notification: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly more: HTMLDetailsElement;
  private readonly narrow = matchMedia("(max-width: 800px)");
  private readonly compact = matchMedia("(max-width: 400px)");
  private hiddenActions = new Set<ConfigurableToolbarAction>();
  private ready = false;
  private busy = false;
  private focusMode = false;
  private autoHide = false;
  private pointerOver = false;
  private focusWithin = false;
  private nearTop = false;
  private hideTimer: number | undefined;

  constructor(private readonly options: ToolbarOptions) {
    const root = document.createElement("div");
    root.className = "marker-toolbar";
    root.setAttribute("role", "toolbar");
    root.setAttribute("aria-label", "文档工具栏");

    const documentGroup = document.createElement("div");
    documentGroup.className = "marker-toolbar-document";

    this.title = document.createElement("span");
    this.title.className = "marker-toolbar-title";
    this.title.textContent = "未命名文档";
    documentGroup.append(this.title);

    const buttonGroup = document.createElement("div");
    buttonGroup.className = "marker-toolbar-actions";
    for (const action of actions) buttonGroup.append(this.makeButton(action));

    const more = this.more = document.createElement("details");
    more.className = "marker-toolbar-more";
    const summary = document.createElement("summary");
    summary.title = "更多操作";
    summary.setAttribute("aria-label", "更多操作");
    summary.append(makeIcon("more"));
    summary.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse") event.preventDefault();
    });
    const menu = document.createElement("div");
    menu.className = "marker-toolbar-menu";
    for (const action of actions.filter(item => item.id !== "settings")) menu.append(this.makeButton(action, more));
    more.append(summary, menu);

    const trailing = document.createElement("div");
    trailing.className = "marker-toolbar-trailing";
    trailing.append(more);
    buttonGroup.append(trailing);

    this.notification = document.createElement("div");
    this.notification.className = "marker-toolbar-notification";
    this.notification.setAttribute("role", "status");
    this.notification.setAttribute("aria-live", "polite");
    this.notification.hidden = true;

    root.append(documentGroup, buttonGroup);
    this.element = root;
    root.addEventListener("pointerenter", () => { this.pointerOver = true; this.reveal(); });
    root.addEventListener("pointerleave", () => { this.pointerOver = false; this.scheduleHide(); });
    root.addEventListener("focusin", () => { this.focusWithin = true; this.reveal(); });
    root.addEventListener("focusout", event => {
      if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget)) {
        this.focusWithin = false;
        this.scheduleHide();
      }
    });
    more.addEventListener("toggle", () => this.more.open ? this.reveal() : this.scheduleHide());
    this.narrow.addEventListener("change", () => this.syncVisibility());
    this.compact.addEventListener("change", () => this.syncVisibility());
    this.syncVisibility();
    this.updateStatistics(0, 0);
  }

  attach(parent: HTMLElement, before: Node | null = null): void {
    parent.insertBefore(this.element, before);
    const notification = this.notification;
    parent.append(notification);
    document.addEventListener("pointermove", event => {
      this.nearTop = event.clientY <= 8;
      if (this.nearTop) this.reveal();
      else if (!this.pointerOver && !this.focusWithin) this.scheduleHide();
    });
    this.syncDisabled();
  }

  setAutoHide(enabled: boolean): void {
    this.autoHide = enabled;
    if (!enabled) {
      window.clearTimeout(this.hideTimer);
      this.hideTimer = undefined;
      delete this.element.dataset.collapsed;
    } else this.scheduleHide();
  }

  private reveal(): void {
    window.clearTimeout(this.hideTimer);
    this.hideTimer = undefined;
    delete this.element.dataset.collapsed;
  }

  private scheduleHide(): void {
    if (!this.autoHide || this.pointerOver || this.focusWithin || this.nearTop || this.more.open) return;
    if (this.hideTimer !== undefined || this.element.dataset.collapsed === "true") return;
    this.hideTimer = window.setTimeout(() => {
      this.hideTimer = undefined;
      if (this.autoHide && !this.pointerOver && !this.focusWithin && !this.nearTop && !this.more.open && !this.element.contains(document.activeElement))
        this.element.dataset.collapsed = "true";
    }, 3000);
  }

  updateState(title: string, notification: string, busy: boolean): void {
    this.title.textContent = title || "未命名文档";
    this.title.title = title;
    this.notification.textContent = notification;
    this.notification.title = notification;
    this.notification.hidden = notification.length === 0;
    this.busy = busy;
    this.syncDisabled();
  }

  setReady(ready: boolean): void {
    this.ready = ready;
    this.syncDisabled();
  }

  setSourceMode(sourceMode: boolean): void {
    const label = sourceMode ? "返回排版模式" : "代码模式";
    for (const button of this.buttons.filter(item => item.dataset.action === "toggleSource")) {
      button.title = this.withShortcut(label, "Ctrl+Alt+M");
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(sourceMode));
    }
  }

  setHiddenActions(actions: readonly ConfigurableToolbarAction[]): void {
    this.hiddenActions = new Set(actions);
    this.more.open = false;
    this.syncVisibility();
  }

  setFocusMode(enabled: boolean): void {
    this.focusMode = enabled;
    this.more.open = false;
    for (const button of this.buttons.filter(item => item.dataset.action === "toggleFocus")) {
      const label = enabled ? "退出专注模式" : "进入专注模式";
      button.title = label;
      button.setAttribute("aria-label", label);
      button.setAttribute("aria-pressed", String(enabled));
      const text = button.querySelector("span");
      if (text) text.textContent = label;
      if (!button.classList.contains("marker-toolbar-menu-button")) {
        if (enabled && !text) {
          const visibleLabel = document.createElement("span");
          visibleLabel.textContent = "退出专注";
          button.append(visibleLabel);
        } else if (!enabled) text?.remove();
      }
    }
    this.syncVisibility();
  }

  setOutlineOpen(open: boolean): void {
    for (const button of this.buttons.filter(item => item.dataset.action === "toggleOutline")) {
      button.setAttribute("aria-expanded", String(open));
    }
  }

  updateStatistics(words: number, paragraphs: number): void {
    const counts = `${words.toLocaleString("zh-CN")} 字 · ${paragraphs.toLocaleString("zh-CN")} 段`;
    for (const button of this.buttons.filter(item => item.dataset.action === "statistics")) {
      button.querySelector("span")!.textContent = button.classList.contains("marker-toolbar-menu-button") ? `字数统计：${counts}` : counts;
      button.setAttribute("aria-label", `字数统计：${counts}`);
      button.title = `正文 ${counts}；中文逐字、英文按词，忽略 Markdown 标记。段数按非空正文段落统计，不含标题、表格及代码块。`;
    }
  }

  private syncVisibility(): void {
    for (const button of this.buttons) {
      if (this.focusMode && !["save", "settings", "toggleFocus"].includes(button.dataset.action!)) {
        button.hidden = true;
        continue;
      }
      const hidden = this.hiddenActions.has(button.dataset.action as ConfigurableToolbarAction);
      const overflow = !this.focusMode && ((this.narrow.matches && button.dataset.overflow === "true") ||
        (this.compact.matches && button.dataset.compactOverflow === "true"));
      button.hidden = button.classList.contains("marker-toolbar-menu-button") ? !(hidden || overflow) : hidden || overflow;
    }
    this.more.hidden = !this.buttons.some(button => button.classList.contains("marker-toolbar-menu-button") && !button.hidden);
  }

  private makeButton(action: (typeof actions)[number], more?: HTMLDetailsElement): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "marker-toolbar-button";
    button.dataset.action = action.id;
    if (action.compactOverflow) button.dataset.compactOverflow = "true";
    button.title = this.withShortcut(action.label, action.shortcut);
    button.setAttribute("aria-label", action.label);
    if (action.shortcut) button.setAttribute("aria-keyshortcuts", action.shortcut.replaceAll("Ctrl", "Control"));
    if (action.id === "toggleSource") button.setAttribute("aria-pressed", "false");
    if (action.id === "toggleFocus") button.setAttribute("aria-pressed", "false");
    if (action.id === "toggleOutline") {
      button.setAttribute("aria-expanded", "false");
      button.setAttribute("aria-controls", "marker-outline");
    }
    if (action.overflow) button.dataset.overflow = "true";
    button.append(makeIcon(action.id));
    if (action.id === "statistics") button.classList.add("marker-toolbar-statistics");
    if (more || action.id === "statistics") {
      if (more) button.classList.add("marker-toolbar-menu-button");
      const label = document.createElement("span");
      label.textContent = action.label;
      button.append(label);
    }
    button.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse" && action.id !== "toggleOutline") event.preventDefault();
    });
    button.addEventListener("click", () => {
      if (!this.ready || this.busy || action.id === "statistics") return;
      if (action.id === "undo" || action.id === "redo" || action.id === "find" || action.id === "replace" || action.id === "toggleSource" || action.id === "toggleOutline" || action.id === "toggleFocus") {
        this.options.runEditor(action.id, button);
      } else this.options.runNative(action.id);
      if (more) more.open = false;
    });
    this.buttons.push(button);
    return button;
  }

  private withShortcut(label: string, shortcut?: string): string {
    return shortcut ? `${label} (${shortcut})` : label;
  }

  private syncDisabled(): void {
    for (const button of this.buttons) button.disabled = !this.ready || this.busy;
  }
}
