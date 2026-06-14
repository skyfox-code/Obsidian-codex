import { FileView, TFile, WorkspaceLeaf } from 'obsidian';
import type CodexPlugin from '../main';
import { CbzPage, parseCbz, revokeCbzPages } from '../parsers/CbzParser';

export const CBZ_VIEW_TYPE = 'codex-cbz';

export class CbzView extends FileView {
  plugin: CodexPlugin;

  private pages: CbzPage[] = [];
  private currentPage = 0;
  private doublePageMode = false;
  private rtl = false;

  // zoom / pan state
  private scale = 1;
  private tx = 0;
  private ty = 0;
  private dragging = false;
  private dragOriginX = 0;
  private dragOriginY = 0;

  // DOM nodes
  private container!: HTMLElement;
  private canvas!: HTMLElement;
  private img1!: HTMLImageElement;
  private img2!: HTMLImageElement;
  private overlay!: HTMLElement;
  private pageCounter!: HTMLElement;
  private overlayTimer = 0;

  constructor(leaf: WorkspaceLeaf, plugin: CodexPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return CBZ_VIEW_TYPE; }
  getDisplayText() { return this.file?.basename ?? 'CBZ'; }
  getIcon() { return 'book-open'; }

  async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('codex-cbz-view');
    this.buildDOM();

    const buffer = await this.app.vault.readBinary(file);
    this.pages = await parseCbz(buffer);

    const saved = this.plugin.getFileData(file.path);
    this.currentPage = saved.page ?? 0;
    this.rtl = saved.rtl ?? (this.plugin.cfg.defaultReadingDirection === 'rtl');
    this.doublePageMode = this.plugin.cfg.defaultLayout === 'double';

    this.applyBackground();
    this.renderPage();
    this.bindEvents();
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    revokeCbzPages(this.pages);
    this.pages = [];
  }

  // â”€â”€ DOM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private buildDOM() {
    this.container = this.contentEl.createDiv('codex-container');
    this.canvas = this.container.createDiv('codex-canvas');
    this.img1 = this.canvas.createEl('img', { cls: 'codex-page' });
    this.img2 = this.canvas.createEl('img', { cls: 'codex-page' });
    this.img2.style.display = 'none';

    this.overlay = this.contentEl.createDiv('codex-overlay');

    const left = this.overlay.createEl('button', { cls: 'codex-btn', text: 'â€¹' });
    this.pageCounter = this.overlay.createEl('span', { cls: 'codex-counter' });
    const right = this.overlay.createEl('button', { cls: 'codex-btn', text: 'â€º' });

    this.overlay.createDiv('codex-sep');

    const dbl = this.overlay.createEl('button', { cls: 'codex-btn codex-btn-sm', text: 'âŠŸ', attr: { title: 'Double page (D)' } });
    const rtlBtn = this.overlay.createEl('button', { cls: 'codex-btn codex-btn-sm', text: 'RTL', attr: { title: 'Toggle RTL (R)' } });

    left.onclick = () => this.step(this.rtl ? 1 : -1);
    right.onclick = () => this.step(this.rtl ? -1 : 1);
    dbl.onclick = () => this.toggleDouble();
    rtlBtn.onclick = () => this.toggleRtl();
  }

  // â”€â”€ Rendering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private renderPage() {
    const n = this.pages.length;
    if (!n) return;
    this.currentPage = Math.max(0, Math.min(this.currentPage, n - 1));

    const p = this.currentPage;
    this.img1.src = this.pages[p].url;
    this.img1.style.imageRendering = this.plugin.cfg.cbzUpscaleQuality;

    if (this.doublePageMode) {
      const p2 = this.rtl ? p - 1 : p + 1;
      if (p2 >= 0 && p2 < n) {
        this.img2.src = this.pages[p2].url;
        this.img2.style.display = '';
        this.img2.style.imageRendering = this.plugin.cfg.cbzUpscaleQuality;
        this.canvas.style.flexDirection = this.rtl ? 'row-reverse' : 'row';
      } else {
        this.img2.style.display = 'none';
      }
    } else {
      this.img2.style.display = 'none';
    }

    this.pageCounter.textContent = `${p + 1} / ${n}`;
    this.applyTransform();
    this.plugin.setFileData(this.file!.path, { page: p });
  }

  private applyTransform() {
    this.canvas.style.transform = `translate(${this.tx}px, ${this.ty}px) scale(${this.scale})`;
  }

  private applyBackground() {
    const bg = this.plugin.cfg.backgroundColor;
    if (bg === 'black') this.container.style.background = '#000';
    else if (bg === 'white') this.container.style.background = '#fff';
    else this.container.style.background = '';
  }

  // â”€â”€ Navigation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private step(direction: number) {
    const stride = this.doublePageMode ? 2 : 1;
    this.currentPage = Math.max(0, Math.min(
      this.currentPage + direction * stride,
      this.pages.length - 1
    ));
    this.resetZoom();
    this.renderPage();
  }

  private resetZoom() {
    this.scale = 1;
    this.tx = 0;
    this.ty = 0;
  }

  private toggleDouble() {
    this.doublePageMode = !this.doublePageMode;
    this.renderPage();
  }

  private toggleRtl() {
    this.rtl = !this.rtl;
    this.plugin.setFileData(this.file!.path, { rtl: this.rtl });
    this.renderPage();
  }

  // â”€â”€ Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private bindEvents() {
    // Show overlay on mouse move, hide after idle
    this.registerDomEvent(this.contentEl, 'mousemove', () => this.flashOverlay());

    // Wheel zoom (centered on view midpoint for simplicity)
    this.registerDomEvent(this.container, 'wheel', (e: WheelEvent) => {
      e.preventDefault();
      const factor = e.deltaY < 0 ? 1.1 : 0.9;
      this.scale = Math.max(0.25, Math.min(10, this.scale * factor));
      this.applyTransform();
    }, { passive: false });

    // Drag to pan
    this.registerDomEvent(this.container, 'mousedown', (e: MouseEvent) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this.dragOriginX = e.clientX - this.tx;
      this.dragOriginY = e.clientY - this.ty;
      this.container.style.cursor = 'grabbing';
    });

    this.registerDomEvent(document, 'mousemove', (e: MouseEvent) => {
      if (!this.dragging) return;
      this.tx = e.clientX - this.dragOriginX;
      this.ty = e.clientY - this.dragOriginY;
      this.applyTransform();
    });

    this.registerDomEvent(document, 'mouseup', () => {
      this.dragging = false;
      this.container.style.cursor = '';
    });

    // Keyboard shortcuts (only when this view is active)
    this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
      if (this.app.workspace.getActiveViewOfType(CbzView) !== this) return;
      switch (e.key) {
        case 'ArrowRight': case 'l': this.step(this.rtl ? -1 : 1); break;
        case 'ArrowLeft': case 'h': this.step(this.rtl ? 1 : -1); break;
        case 'j': this.step(1); break;
        case 'k': this.step(-1); break;
        case 'd': case 'D': this.toggleDouble(); break;
        case 'r': case 'R': this.toggleRtl(); break;
        case 'Escape': this.resetZoom(); this.applyTransform(); break;
      }
    });
  }

  private flashOverlay() {
    this.overlay.classList.add('is-visible');
    clearTimeout(this.overlayTimer);
    this.overlayTimer = window.setTimeout(() => {
      this.overlay.classList.remove('is-visible');
    }, 2000);
  }
}

