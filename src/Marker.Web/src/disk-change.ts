import "./disk-change.css";

export class DiskChangePrompt {
  readonly element = document.createElement("aside");
  private readonly reload = document.createElement("button");
  private readonly close = document.createElement("button");
  private notificationId: string | null = null;

  constructor(parent: HTMLElement, act: (id: string, action: "reload" | "dismiss") => boolean, private readonly restoreFocus: () => void) {
    this.element.className = "marker-disk-change";
    this.element.hidden = true;
    this.element.setAttribute("aria-label", "磁盘文件变更");
    const message = document.createElement("span");
    message.setAttribute("role", "status");
    message.textContent = "磁盘中文件已被修改，是否重新加载？";
    this.reload.type = this.close.type = "button";
    this.reload.textContent = "重新加载";
    this.close.textContent = "关闭";
    this.reload.addEventListener("click", () => {
      if (this.notificationId) act(this.notificationId, "reload");
    });
    this.close.addEventListener("click", () => {
      if (this.notificationId && act(this.notificationId, "dismiss")) {
        this.update(null, false);
      }
    });
    this.element.append(message, this.reload, this.close);
    parent.append(this.element);
  }

  update(notificationId: string | null, busy: boolean): void {
    const focused = this.element.contains(document.activeElement);
    this.notificationId = notificationId;
    this.element.hidden = notificationId === null;
    this.reload.disabled = this.close.disabled = busy;
    // Host dismissal can hide the focused button; return keyboard users to the editor.
    if (focused && notificationId === null) this.restoreFocus();
  }

  setBusy(busy: boolean): void { this.reload.disabled = this.close.disabled = busy; }
}
