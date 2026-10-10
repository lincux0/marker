import "./lightbox.css";

type ZoomRequest = { url?: unknown; trigger?: unknown };

function isControlledImageUrl(value: unknown): value is string {
  if (typeof value !== "string") return false;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && url.hostname === "document.marker.example" && !url.username && !url.password &&
      url.port === "" && url.search === "" && url.hash === "" && /^\/[0-9a-f]{32}\/image\/[0-9a-f]{48}$/.test(url.pathname);
  } catch { return false; }
}

export class ImageLightbox {
  private readonly dialog = document.createElement("dialog");
  private readonly image = document.createElement("img");
  private readonly closeButton = document.createElement("button");
  private readonly sizeButton = document.createElement("button");
  private readonly zoomOutButton = document.createElement("button");
  private readonly zoomInButton = document.createElement("button");
  private trigger: HTMLElement | null = null;
  private naturalWidth = 0;
  private naturalHeight = 0;
  private fit = true;
  private scale = 1;
  private allowedUrls = new Set<string>();

  constructor(root: HTMLElement) {
    this.dialog.className = "marker-lightbox";
    this.dialog.setAttribute("aria-label", "图片查看器");
    this.image.className = "marker-lightbox-image";
    this.image.alt = "";
    const toolbar = document.createElement("div");
    toolbar.className = "marker-lightbox-toolbar";
    this.closeButton.textContent = "关闭";
    this.closeButton.setAttribute("aria-label", "关闭图片查看器");
    this.sizeButton.textContent = "原尺寸";
    this.sizeButton.setAttribute("aria-label", "查看原尺寸");
    this.zoomOutButton.textContent = "−";
    this.zoomOutButton.setAttribute("aria-label", "缩小图片");
    this.zoomInButton.textContent = "+";
    this.zoomInButton.setAttribute("aria-label", "放大图片");
    for (const button of [this.closeButton, this.sizeButton, this.zoomOutButton, this.zoomInButton]) button.type = "button";
    toolbar.append(this.sizeButton, this.zoomOutButton, this.zoomInButton, this.closeButton);
    this.dialog.append(toolbar, this.image);
    document.body.append(this.dialog);

    root.addEventListener("marker-image-zoom", this.onZoomRequest);
    this.closeButton.addEventListener("click", () => this.close());
    this.sizeButton.addEventListener("click", () => { this.fit = !this.fit; this.scale = 1; this.renderSize(); });
    this.zoomOutButton.addEventListener("click", () => this.changeScale(1 / 1.25));
    this.zoomInButton.addEventListener("click", () => this.changeScale(1.25));
    this.dialog.addEventListener("keydown", this.onKeyDown);
    window.addEventListener("resize", () => { if (this.dialog.open && this.fit) this.renderSize(); });
    this.dialog.addEventListener("close", () => {
      if (this.dialog.open) return;
      this.image.removeAttribute("src");
      const trigger = this.trigger;
      this.trigger = null;
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    });
  }

  close(): void {
    if (this.dialog.open) this.dialog.close();
  }

  setResources(urls: Iterable<string>): void {
    this.close();
    this.allowedUrls = new Set([...urls].filter(isControlledImageUrl));
  }

  private readonly onZoomRequest = (event: Event): void => {
    const detail = (event as CustomEvent<ZoomRequest>).detail;
    if (!isControlledImageUrl(detail?.url) || !this.allowedUrls.has(detail.url) || !(detail.trigger instanceof HTMLElement) || !detail.trigger.isConnected) return;
    const source = detail.trigger.closest(".cm-md-image")?.querySelector("img");
    if (!source?.complete || !source.naturalWidth || source.src !== detail.url) return;
    this.trigger = detail.trigger;
    this.image.alt = source.alt;
    this.naturalWidth = source.naturalWidth;
    this.naturalHeight = source.naturalHeight;
    this.fit = true;
    this.scale = 1;
    this.image.src = detail.url;
    this.renderSize();
    this.dialog.showModal();
    this.closeButton.focus({ preventScroll: true });
  };

  private renderSize(): void {
    const fitWidth = Math.min(this.naturalWidth, Math.max(1, innerWidth - 64), Math.max(1, innerHeight - 150) * this.naturalWidth / this.naturalHeight);
    const baseWidth = this.fit ? fitWidth : this.naturalWidth;
    this.image.style.width = `${Math.max(1, baseWidth * this.scale)}px`;
    this.sizeButton.textContent = this.fit ? "原尺寸" : "适应窗口";
    this.sizeButton.setAttribute("aria-label", this.fit ? "查看原尺寸" : "适应窗口");
  }

  private changeScale(multiplier: number): void {
    this.scale = Math.max(0.1, Math.min(8, this.scale * multiplier));
    this.renderSize();
  }

  private readonly onKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (event.key === "Escape") { event.preventDefault(); this.close(); return; }
    if (event.key === "+" || event.key === "=") { event.preventDefault(); this.changeScale(1.25); return; }
    if (event.key === "-") { event.preventDefault(); this.changeScale(1 / 1.25); return; }
    if (event.key !== "Tab") return;
    const controls = [this.sizeButton, this.zoomOutButton, this.zoomInButton, this.closeButton].filter(button => !button.disabled);
    const index = controls.indexOf(document.activeElement as HTMLButtonElement);
    if (event.shiftKey && index <= 0) { event.preventDefault(); controls.at(-1)?.focus(); }
    else if (!event.shiftKey && index === controls.length - 1) { event.preventDefault(); controls[0]?.focus(); }
  };
}
