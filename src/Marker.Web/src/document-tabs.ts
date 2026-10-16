export type DocumentTab = { id: string; title: string; dirty: boolean };
type TabView = { item: HTMLElement; select: HTMLButtonElement; label: Text; dirty: HTMLSpanElement };
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export class DocumentTabs {
  readonly element = document.createElement("nav");
  private readonly list = document.createElement("div");
  private tabs: DocumentTab[] = [];
  private activeId = "";
  private busy = false;
  private readonly views = new Map<string, TabView>();
  private readonly menu = document.createElement("div");
  private readonly menuButton = document.createElement("button");
  private menuTargetId: string | undefined;
  private menuOpener: HTMLButtonElement | undefined;

  constructor(parent: HTMLElement, private readonly command: (documentId: string, action: "select" | "close") => void) {
    this.element.className = "marker-document-tabs";
    this.element.setAttribute("aria-label", "打开的文档");
    this.list.className = "marker-document-tab-list";
    this.list.setAttribute("role", "list");
    this.element.append(this.list);
    parent.append(this.element);
    this.menu.className = "marker-document-tab-menu";
    this.menu.id = "marker-document-tab-menu";
    this.menu.setAttribute("popover", "auto");
    this.menu.setAttribute("aria-label", "标签页操作");
    this.menuButton.type = "button";
    this.menuButton.className = "marker-document-tab-menu-item";
    this.menuButton.textContent = "关闭";
    this.menu.append(this.menuButton);
    parent.append(this.menu);
    this.menuButton.addEventListener("click", () => {
      const targetId = this.menuTargetId;
      this.menu.hidePopover();
      this.menuTargetId = undefined;
      if (targetId) this.requestClose(targetId);
    });
    this.menu.addEventListener("keydown", event => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      const opener = this.menuOpener;
      this.dismissMenu();
      if (opener?.isConnected && !opener.disabled) opener.focus({ preventScroll: true });
    });
    this.element.addEventListener("click", event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("button[data-document-id]");
      if (!button || button.disabled) return;
      this.command(button.dataset.documentId!, "select");
    });
    this.list.addEventListener("contextmenu", event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("button[data-document-id]");
      if (!button) return;
      event.preventDefault();
      if (!button.disabled) this.openMenu(button.dataset.documentId!, event.clientX, event.clientY);
    });
    this.list.addEventListener("keydown", event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("button[data-document-id]");
      if (!button || button.disabled || !(event.key === "ContextMenu" || event.shiftKey && event.key === "F10")) return;
      event.preventDefault();
      const rect = button.getBoundingClientRect();
      this.openMenu(button.dataset.documentId!, rect.right, rect.bottom);
    });
  }

  update(tabs: DocumentTab[], activeId: string, busy: boolean): void {
    this.tabs = tabs;
    this.activeId = activeId;
    this.busy = busy;
    const ids = new Set(tabs.map(tab => tab.id));
    if (this.menuTargetId && (!ids.has(this.menuTargetId) || busy)) this.dismissMenu();
    for (const [id, view] of this.views) {
      if (ids.has(id)) continue;
      view.item.remove();
      this.views.delete(id);
    }
    tabs.forEach((tab, index) => {
      const view = this.views.get(tab.id) ?? this.createTab(tab.id);
      this.updateTab(view, tab);
      const position = this.list.children[index];
      if (position !== view.item) this.list.insertBefore(view.item, position ?? null);
    });
    this.element.hidden = tabs.length === 0;
  }

  setBusy(busy: boolean): void {
    this.busy = busy;
    if (busy) this.dismissMenu();
    for (const { select } of this.views.values()) select.disabled = busy;
  }

  closeActive(): boolean {
    return this.requestClose(this.activeId);
  }

  private createTab(id: string): TabView {
    const item = document.createElement("div");
    item.className = "marker-document-tab";
    item.setAttribute("role", "listitem");
    const select = document.createElement("button");
    select.type = "button";
    select.className = "marker-document-tab-select";
    select.dataset.documentId = id;
    const label = document.createTextNode("");
    const dirty = document.createElement("span");
    dirty.className = "marker-document-tab-dirty";
    dirty.setAttribute("aria-hidden", "true");
    select.append(label, dirty);
    select.setAttribute("aria-controls", this.menu.id);
    select.setAttribute("aria-keyshortcuts", "Shift+F10 ContextMenu");
    item.append(select);
    const result = { item, select, label, dirty };
    this.views.set(id, result);
    return result;
  }

  private updateTab(view: TabView, tab: DocumentTab): void {
    const first = graphemes.segment(tab.title)[Symbol.iterator]().next().value?.segment ?? "•";
    const selected = tab.id === this.activeId;
    view.label.data = first;
    view.select.title = tab.title;
    view.select.setAttribute("aria-label", `切换到${tab.title}${tab.dirty ? "，有未保存修改" : ""}`);
    view.select.setAttribute("aria-current", selected ? "page" : "false");
    view.select.classList.toggle("is-active", selected);
    view.select.disabled = this.busy;
    view.dirty.hidden = !tab.dirty;
  }

  private openMenu(id: string, x: number, y: number): void {
    const tab = this.tabs.find(item => item.id === id);
    const opener = this.views.get(id)?.select;
    if (!tab || !opener || this.busy) return;
    if (this.menu.matches(":popover-open")) this.menu.hidePopover();
    this.menuTargetId = id;
    this.menuOpener = opener;
    this.menuButton.setAttribute("aria-label", "关闭");
    this.menuButton.title = `关闭${tab.title}`;
    this.menu.showPopover();
    const rect = this.menu.getBoundingClientRect();
    const margin = 8;
    this.menu.style.left = `${Math.max(margin, Math.min(x, innerWidth - rect.width - margin))}px`;
    this.menu.style.top = `${Math.max(margin, Math.min(y, innerHeight - rect.height - margin))}px`;
    this.menuButton.focus();
  }

  private dismissMenu(): void {
    if (this.menu.matches(":popover-open")) this.menu.hidePopover();
    this.menuTargetId = undefined;
  }

  private requestClose(id: string): boolean {
    if (this.busy || !this.tabs.some(tab => tab.id === id)) return false;
    this.command(id, "close");
    return true;
  }
}
