import { EditorSelection } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import "./outline.css";

export type Heading = { id: string; text: string; level: number; offset: number };

const pageSize = 200;

export class DocumentOutline {
  private readonly root = document.createElement("aside");
  private readonly panel = document.createElement("nav");
  private readonly closeButton = document.createElement("button");
  private readonly empty = document.createElement("p");
  private readonly list = document.createElement("ol");
  private readonly previous = document.createElement("button");
  private readonly next = document.createElement("button");
  private readonly pageLabel = document.createElement("span");
  private readonly pagination = document.createElement("div");
  private readonly returnButton = document.createElement("button");
  private items: Heading[] = [];
  private version = -1;
  private activeIndex = -1;
  private page = 0;
  private trigger?: HTMLElement;
  private saved?: { selection: EditorSelection; scrollTop: number };
  private open = false;

  constructor(
    private readonly getView: () => EditorView | undefined,
    private readonly onStatus: (message: string) => void,
    private readonly getVersion: () => number,
    private readonly onOpenChange: (open: boolean) => void = () => {},
  ) {
    this.root.id = "marker-outline";
    this.root.className = "marker-outline";
    this.root.hidden = true;
    this.panel.setAttribute("aria-label", "文档大纲");
    this.closeButton.type = "button";
    this.closeButton.className = "marker-outline-close";
    this.closeButton.setAttribute("aria-label", "关闭文档大纲");
    this.closeButton.textContent = "关闭";
    this.closeButton.addEventListener("click", () => this.close());
    this.empty.className = "marker-outline-empty";
    this.empty.setAttribute("role", "status");
    this.list.className = "marker-outline-list";
    this.previous.type = this.next.type = "button";
    this.previous.className = "marker-outline-page";
    this.next.className = "marker-outline-page";
    this.previous.textContent = "上一页";
    this.next.textContent = "下一页";
    this.previous.addEventListener("click", () => this.changePage(this.page - 1));
    this.next.addEventListener("click", () => this.changePage(this.page + 1));
    this.pagination.className = "marker-outline-pagination";
    this.pageLabel.setAttribute("aria-live", "polite");
    this.pagination.append(this.previous, this.pageLabel, this.next);
    this.returnButton.type = "button";
    this.returnButton.className = "marker-outline-return";
    this.returnButton.setAttribute("aria-label", "返回跳转前位置");
    this.returnButton.textContent = "返回跳转前位置";
    this.returnButton.hidden = true;
    this.returnButton.addEventListener("click", () => this.restore());
    this.panel.addEventListener("keydown", event => {
      if (event.key !== "Escape" || event.isComposing || this.getView()?.compositionStarted) return;
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });
    this.panel.append(this.closeButton, this.returnButton, this.empty, this.list, this.pagination);
    this.root.append(this.panel);
    document.querySelector<HTMLElement>("#app")?.append(this.root);
    this.renderRows();
  }

  get isOpen(): boolean { return this.open; }

  setItems(items: Heading[], version: number): void {
    const refocus = this.open && this.list.contains(document.activeElement);
    if (version !== this.version) {
      this.saved = undefined;
      this.returnButton.hidden = true;
      this.activeIndex = -1;
      this.page = 0;
    }
    this.items = items;
    this.version = version;
    this.renderRows();
    this.updateScroll();
    if (refocus) this.focusCurrentPage();
  }

  invalidate(): void {
    this.items = [];
    this.version = -1;
    this.saved = undefined;
    this.returnButton.hidden = true;
    this.activeIndex = -1;
    this.page = 0;
    this.renderRows();
  }

  reset(): void {
    this.invalidate();
    this.close();
  }

  toggle(trigger?: HTMLElement): void {
    this.trigger = trigger ?? this.trigger;
    if (this.open) this.close();
    else this.setOpen(true);
  }

  close(): void {
    if (!this.open) return;
    this.setOpen(false);
    this.trigger?.focus();
  }

  navigateAnchor(raw: string, currentVersion: number): void {
    if (currentVersion !== this.version || currentVersion !== this.getVersion()) {
      this.onStatus("文档大纲正在更新，请稍后重试。");
      return;
    }
    const hash = raw.startsWith("#") ? raw.slice(1) : "";
    let id: string;
    try { id = decodeURIComponent(hash); }
    catch { this.onStatus("文档内锚点格式无效。"); return; }
    const index = this.items.findIndex(item => item.id === id);
    if (index < 0) {
      this.onStatus("找不到对应的文档标题。");
      return;
    }
    this.navigate(index);
  }

  onScroll(): void { this.updateScroll(); }

  private setOpen(open: boolean, focus = true): void {
    this.open = open;
    this.root.hidden = !open;
    this.root.dataset.open = String(open);
    document.documentElement.dataset.outlineOpen = String(open);
    this.onOpenChange(open);
    if (open && focus) requestAnimationFrame(() => this.focusCurrentPage());
  }

  private navigate(index: number): void {
    const view = this.getView();
    const heading = this.items[index];
    if (!view || !heading || this.version !== this.getVersion()) {
      this.onStatus("文档大纲与当前编辑内容不同步。");
      return;
    }
    if (view.compositionStarted) {
      this.onStatus("请先完成输入法候选输入，再跳转标题。");
      return;
    }
    if (!this.saved) this.saved = { selection: view.state.selection, scrollTop: view.scrollDOM.scrollTop };
    this.returnButton.hidden = false;
    this.activeIndex = index;
    const page = Math.floor(index / pageSize);
    if (page !== this.page) {
      this.page = page;
      this.renderRows();
    }
    if (!this.open) this.setOpen(true, false);
    const offset = Math.min(heading.offset, view.state.doc.length);
    view.dispatch({ selection: EditorSelection.cursor(offset), effects: EditorView.scrollIntoView(offset, { y: "start" }) });
    view.focus();
    this.setCurrentRow();
  }

  private restore(): void {
    const view = this.getView();
    const saved = this.saved;
    if (!view || !saved || this.version !== this.getVersion()) return;
    view.dispatch({ selection: saved.selection });
    view.scrollDOM.scrollTop = saved.scrollTop;
    view.focus();
    this.saved = undefined;
    this.returnButton.hidden = true;
  }

  private updateScroll(): void {
    const view = this.getView();
    if (!view || !this.items.length) return;
    const visibleTop = Math.max(view.scrollDOM.getBoundingClientRect().top + view.scrollDOM.clientTop,
      (document.querySelector(".marker-toolbar")?.getBoundingClientRect().bottom ?? 0) + 12);
    const visibleOffset = view.lineBlockAtHeight(Math.max(0, visibleTop - view.documentTop)).from;
    let low = 0;
    let high = this.items.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (this.items[middle].offset <= visibleOffset) low = middle + 1;
      else high = middle;
    }
    this.activeIndex = Math.max(0, low - 1);
    this.setCurrentRow();
  }

  private setCurrentRow(): void {
    this.list.querySelectorAll<HTMLElement>(".marker-outline-item").forEach(row => {
      row.setAttribute("aria-current", Number(row.dataset.index) === this.activeIndex ? "location" : "false");
    });
  }

  private changePage(page: number): void {
    const pageCount = Math.ceil(this.items.length / pageSize);
    this.page = Math.max(0, Math.min(pageCount - 1, page));
    this.renderRows();
    this.focusCurrentPage();
  }

  private focusCurrentPage(): void {
    const heading = this.list.querySelector<HTMLButtonElement>(".marker-outline-heading");
    if (heading) heading.focus();
    else this.closeButton.focus();
  }

  private renderRows(): void {
    this.page = Math.min(this.page, Math.max(0, Math.ceil(this.items.length / pageSize) - 1));
    const start = this.page * pageSize;
    const end = Math.min(this.items.length, start + pageSize);
    const fragment = document.createDocumentFragment();
    for (let index = start; index < end; index++) {
      const item = this.items[index];
      const row = document.createElement("li");
      row.className = "marker-outline-item";
      row.dataset.index = String(index);
      row.style.setProperty("--heading-level", String(Math.min(6, Math.max(1, item.level))));
      row.setAttribute("aria-current", index === this.activeIndex ? "location" : "false");
      const jump = document.createElement("button");
      jump.type = "button";
      jump.className = "marker-outline-heading";
      const label = item.text || "无标题章节";
      jump.textContent = label;
      jump.title = label;
      jump.addEventListener("click", () => this.navigate(index));
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "marker-outline-copy";
      copy.setAttribute("aria-label", `复制链接：${label}`);
      copy.textContent = "#";
      copy.addEventListener("click", () => {
        try {
          if (!navigator.clipboard) throw new Error("Clipboard unavailable");
          void navigator.clipboard.writeText(`#${encodeURIComponent(item.id)}`).then(
            () => this.onStatus("标题链接已复制。"),
            () => this.onStatus("复制标题链接失败。"),
          );
        } catch { this.onStatus("复制标题链接失败。"); }
      });
      row.append(jump, copy);
      fragment.append(row);
    }
    this.list.replaceChildren(fragment);
    this.empty.textContent = this.items.length ? "" : this.version < 0 ? "正在更新大纲…" : "暂无标题";
    this.empty.hidden = this.items.length > 0;
    this.list.hidden = this.items.length === 0;
    const pageCount = Math.ceil(this.items.length / pageSize);
    this.previous.disabled = this.page <= 0;
    this.next.disabled = this.page + 1 >= pageCount;
    this.previous.hidden = this.next.hidden = pageCount <= 1;
    this.pageLabel.hidden = pageCount <= 1;
    if (pageCount > 1) {
      this.previous.setAttribute("aria-label", "上一页");
      this.next.setAttribute("aria-label", "下一页");
      this.pageLabel.textContent = `第 ${this.page + 1}/${pageCount} 页`;
      this.previous.title = `上一页（第 ${this.page + 1}/${pageCount} 页）`;
      this.next.title = `下一页（第 ${this.page + 1}/${pageCount} 页）`;
    }
  }
}
