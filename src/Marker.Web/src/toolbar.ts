export type NativeCommand = "new" | "open" | "save" | "saveAs" | "recover" | "settings";
export type EditorCommand = "undo" | "redo" | "find" | "replace" | "toggleSource";
type Action = NativeCommand | EditorCommand;
type ToolbarOptions = {
  runNative(command: NativeCommand): void;
  runEditor(command: EditorCommand): void;
};

const iconPaths: Record<Action | "more", string[]> = {
  new: ["M5 3h10l4 4v14H5z", "M15 3v5h4", "M12 11v6", "M9 14h6"],
  open: ["M3 7h7l2 2h9v10H3z", "M3 7V5h7l2 2"],
  save: ["M4 3h14l3 3v15H3V3z", "M7 3v6h10V3", "M7 21v-8h10v8"],
  saveAs: ["M4 3h14l3 3v7", "M7 3v6h10V3", "M7 21v-6h5", "m14 19 5-5 2 2-5 5-3 1z"],
  recover: ["M3 11a9 9 0 1 1 2.6 6.4", "M3 4v7h7", "M12 7v5l3 2"],
  undo: ["M9 14 4 9l5-5", "M4 9h10a6 6 0 0 1 0 12h-2"],
  redo: ["m15 14 5-5-5-5", "M20 9H10a6 6 0 0 0 0 12h2"],
  find: ["M10.8 18.2a7.4 7.4 0 1 0 0-14.8 7.4 7.4 0 0 0 0 14.8z", "m16.2 16.2 4.3 4.3"],
  replace: ["M4 7h13", "m14 4 3 3-3 3", "M20 17H7", "m10 14-3 3 3 3", "M5 13h.01", "M19 11h.01"],
  toggleSource: ["m8 5-6 7 6 7", "m16 5 6 7-6 7", "m14 4-4 16"],
  settings: ["M10 3h4l.6 2.4a7 7 0 0 1 1.8 1l2.3-.7 2 3.5-1.8 1.7a7 7 0 0 1 0 2.1l1.8 1.7-2 3.5-2.3-.7a7 7 0 0 1-1.8 1L14 21h-4l-.6-2.4a7 7 0 0 1-1.8-1l-2.3.7-2-3.5 1.8-1.7a7 7 0 0 1 0-2.1L3.3 9.2l2-3.5 2.3.7a7 7 0 0 1 1.8-1L10 3z", "M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z"],
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

const actions: Array<{ id: Action; label: string; shortcut?: string; overflow?: boolean }> = [
  { id: "new", label: "新建文档", shortcut: "Ctrl+N" },
  { id: "open", label: "打开文档", shortcut: "Ctrl+O" },
  { id: "save", label: "保存", shortcut: "Ctrl+S" },
  { id: "saveAs", label: "另存为", overflow: true },
  { id: "recover", label: "恢复草稿", overflow: true },
  { id: "undo", label: "撤销", shortcut: "Ctrl+Z" },
  { id: "redo", label: "重做", shortcut: "Ctrl+Y" },
  { id: "find", label: "查找", shortcut: "Ctrl+F" },
  { id: "replace", label: "查找和替换", shortcut: "Ctrl+H", overflow: true },
  { id: "toggleSource", label: "代码模式", shortcut: "Ctrl+Alt+M" },
  { id: "settings", label: "设置" },
];

export class FloatingToolbar {
  readonly element: HTMLElement;
  private readonly title: HTMLElement;
  private readonly notification: HTMLElement;
  private readonly buttons: HTMLButtonElement[] = [];
  private ready = false;
  private busy = false;

  constructor(private readonly options: ToolbarOptions) {
    const root = document.createElement("div");
    root.className = "marker-toolbar";
    root.setAttribute("role", "toolbar");
    root.setAttribute("aria-label", "文档工具栏");

    const documentGroup = document.createElement("div");
    documentGroup.className = "marker-toolbar-document";

    const logo = document.createElement("img");
    logo.className = "marker-toolbar-logo";
    logo.src = "/app-logo.png";
    logo.alt = "Marker";
    logo.width = 28;
    logo.height = 28;
    logo.addEventListener("error", () => { logo.hidden = true; });

    this.title = document.createElement("span");
    this.title.className = "marker-toolbar-title";
    this.title.textContent = "未命名文档";
    documentGroup.append(logo, this.title);

    const buttonGroup = document.createElement("div");
    buttonGroup.className = "marker-toolbar-actions";
    for (const action of actions) buttonGroup.append(this.makeButton(action));

    const more = document.createElement("details");
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
    for (const action of actions.filter(item => item.overflow)) menu.append(this.makeButton(action, more));
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
  }

  attach(parent: HTMLElement, before: Node | null = null): void {
    parent.insertBefore(this.element, before);
    const notification = this.notification;
    parent.append(notification);
    this.syncDisabled();
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
    const button = this.element.querySelector<HTMLButtonElement>('[data-action="toggleSource"]');
    if (!button) return;
    const label = sourceMode ? "返回排版模式" : "代码模式";
    button.title = this.withShortcut(label, "Ctrl+Alt+M");
    button.setAttribute("aria-label", label);
    button.setAttribute("aria-pressed", String(sourceMode));
  }

  private makeButton(action: (typeof actions)[number], more?: HTMLDetailsElement): HTMLButtonElement {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "marker-toolbar-button";
    button.dataset.action = action.id;
    button.title = this.withShortcut(action.label, action.shortcut);
    button.setAttribute("aria-label", action.label);
    if (action.shortcut) button.setAttribute("aria-keyshortcuts", action.shortcut.replaceAll("Ctrl", "Control"));
    if (action.id === "toggleSource") button.setAttribute("aria-pressed", "false");
    if (action.overflow) button.dataset.overflow = "true";
    button.append(makeIcon(action.id));
    if (more) {
      button.classList.add("marker-toolbar-menu-button");
      const label = document.createElement("span");
      label.textContent = action.label;
      button.append(label);
    }
    button.addEventListener("pointerdown", event => {
      if (event.pointerType === "mouse") event.preventDefault();
    });
    button.addEventListener("click", () => {
      if (!this.ready || this.busy) return;
      if (action.id === "undo" || action.id === "redo" || action.id === "find" || action.id === "replace" || action.id === "toggleSource") {
        this.options.runEditor(action.id);
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
