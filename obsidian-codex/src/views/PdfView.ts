import { FileView, TFile, WorkspaceLeaf } from 'obsidian';
import type CodexPlugin from '../main';

export const PDF_VIEW_TYPE = 'codex-pdf';

export class PdfView extends FileView {
  plugin: CodexPlugin;

  private pdfUrl: string | null = null;
  private overlayTimer = 0;
  private overlay!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: CodexPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return PDF_VIEW_TYPE; }
  getDisplayText() { return this.file?.basename ?? 'PDF'; }
  getIcon() { return 'file-text'; }

  async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('codex-pdf-view');

    const buffer = await this.app.vault.readBinary(file);
    const blob = new Blob([buffer], { type: 'application/pdf' });
    this.pdfUrl = URL.createObjectURL(blob);

    const iframe = this.contentEl.createEl('iframe', {
      cls: 'codex-pdf-iframe',
      attr: { src: this.pdfUrl },
    });

    // Overlay with just the file name as a label â€” PDF viewer has its own controls
    this.overlay = this.contentEl.createDiv('codex-overlay');
    this.overlay.createEl('span', { cls: 'codex-counter', text: file.basename });

    this.registerDomEvent(this.contentEl, 'mousemove', () => this.flashOverlay());

    // Intercept mouse over iframe to still catch movement
    iframe.addEventListener('load', () => {
      try {
        iframe.contentDocument?.addEventListener('mousemove', () => this.flashOverlay());
      } catch {
        // cross-origin â€” ignore
      }
    });
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    if (this.pdfUrl) { URL.revokeObjectURL(this.pdfUrl); this.pdfUrl = null; }
  }

  private flashOverlay() {
    this.overlay.classList.add('is-visible');
    clearTimeout(this.overlayTimer);
    this.overlayTimer = window.setTimeout(() => {
      this.overlay.classList.remove('is-visible');
    }, 2000);
  }
}

