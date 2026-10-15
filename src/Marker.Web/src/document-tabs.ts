export type DocumentTab = { id: string; title: string; dirty: boolean };
type TabView = { item: HTMLElement; select: HTMLButtonElement; close: HTMLButtonElement; label: Text; dirty: HTMLSpanElement };
const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export class DocumentTabs {
  readonly element = document.createElement("nav");
  private readonly list = document.createElement("div");
  private tabs: DocumentTab[] = [];
  private activeId = "";
  private busy = false;
  private readonly views = new Map<string, TabView>();

  constructor(parent: HTMLElement, private readonly command: (documentId: string, action: "select" | "close") => void) {
    this.element.className = "marker-document-tabs";
    this.element.setAttribute("aria-label", "打开的文档");
    this.list.className = "marker-document-tab-list";
    this.list.setAttribute("role", "list");
    this.element.append(this.list);
    parent.append(this.element);
    this.element.addEventListener("click", event => {
      const target = event.target;
      if (!(target instanceof Element)) return;
      const button = target.closest<HTMLButtonElement>("button[data-document-id]");
      if (!button || button.disabled) return;
      const action = button.dataset.action === "close" ? "close" : "select";
      this.command(button.dataset.documentId!, action);
    });
  }

  update(tabs: DocumentTab[], activeId: string, busy: boolean): void {
    this.tabs = tabs;
    this.activeId = activeId;
    this.busy = busy;
    const ids = new Set(tabs.map(tab => tab.id));
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
    for (const { select, close } of this.views.values()) select.disabled = close.disabled = busy;
  }

  closeActive(): boolean {
    if (this.busy || !this.activeId || this.tabs.length === 0) return false;
    this.command(this.activeId, "close");
    return true;
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
    const close = document.createElement("button");
    close.type = "button";
    close.className = "marker-document-tab-close";
    close.dataset.documentId = id;
    close.dataset.action = "close";
    const icon = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    icon.setAttribute("viewBox", "0 0 16 16");
    icon.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute("d", "m4 4 8 8M12 4l-8 8");
    icon.append(path);
    close.append(icon);
    item.append(select, close);
    const result = { item, select, close, label, dirty };
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
    view.select.disabled = view.close.disabled = this.busy;
    view.dirty.hidden = !tab.dirty;
    view.close.setAttribute("aria-label", `关闭${tab.title}`);
    view.close.title = `关闭${tab.title}`;
  }
}
