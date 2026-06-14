import { FileView, TFile, WorkspaceLeaf } from 'obsidian';
import type CodexPlugin from '../main';
import { EpubBook, EpubTocItem, parseEpub, revokeEpubResources } from '../parsers/EpubParser';

export const EPUB_VIEW_TYPE = 'codex-epub';

export class EpubView extends FileView {
  plugin: CodexPlugin;

  private book: EpubBook | null = null;
  private chapterIndex = 0;
  private fontSize = 16;
  private tocOpen = false;
  private overlayTimer = 0;

  // DOM nodes
  private tocSidebar!: HTMLElement;
  private tocList!: HTMLElement;
  private contentArea!: HTMLElement;
  private chapterEl!: HTMLElement;
  private overlay!: HTMLElement;
  private chapterLabel!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, plugin: CodexPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return EPUB_VIEW_TYPE; }
  getDisplayText() { return this.file?.basename ?? 'EPUB'; }
  getIcon() { return 'book-open'; }

  async onLoadFile(file: TFile): Promise<void> {
    this.contentEl.empty();
    this.contentEl.addClass('codex-epub-view');
    this.buildDOM();

    const buffer = await this.app.vault.readBinary(file);
    this.book = await parseEpub(buffer);

    const saved = this.plugin.getFileData(file.path);
    this.fontSize = saved.fontSize ?? this.plugin.cfg.defaultFontSize;
    this.chapterIndex = 0;
    if (saved.chapterHref) {
      const idx = this.book.chapters.findIndex(c => c.href === saved.chapterHref);
      if (idx >= 0) this.chapterIndex = idx;
    }

    this.renderToc();
    this.renderChapter(this.chapterIndex);

    if (saved.scrollTop) {
      setTimeout(() => { this.contentArea.scrollTop = saved.scrollTop!; }, 80);
    }

    this.bindEvents();
  }

  async onUnloadFile(_file: TFile): Promise<void> {
    if (this.book) { revokeEpubResources(this.book); this.book = null; }
  }

  // â”€â”€ DOM â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private buildDOM() {
    const wrapper = this.contentEl.createDiv('codex-epub-wrapper');

    // TOC sidebar (collapsed by default)
    this.tocSidebar = wrapper.createDiv('codex-toc-sidebar is-collapsed');
    const tocHead = this.tocSidebar.createDiv('codex-toc-header');
    tocHead.createEl('span', { text: 'Contents' });
    tocHead.createEl('button', { cls: 'codex-toc-close', text: 'âœ•' }).onclick = () => this.toggleToc();
    this.tocList = this.tocSidebar.createDiv('codex-toc-list');

    // Main reading area
    this.contentArea = wrapper.createDiv('codex-epub-content');
    this.chapterEl = this.contentArea.createDiv('codex-epub-chapter');

    // Floating overlay
    this.overlay = this.contentEl.createDiv('codex-overlay');

    const prev = this.overlay.createEl('button', { cls: 'codex-btn', text: 'â€¹' });
    this.chapterLabel = this.overlay.createEl('span', { cls: 'codex-counter' });
    const next = this.overlay.createEl('button', { cls: 'codex-btn', text: 'â€º' });

    this.overlay.createDiv('codex-sep');

    const tocBtn = this.overlay.createEl('button', { cls: 'codex-btn codex-btn-sm', text: 'â˜°', attr: { title: 'Table of contents (T)' } });
    const fontDec = this.overlay.createEl('button', { cls: 'codex-btn codex-btn-sm', text: 'Aâˆ’', attr: { title: 'Decrease font size' } });
    const fontInc = this.overlay.createEl('button', { cls: 'codex-btn codex-btn-sm', text: 'A+', attr: { title: 'Increase font size' } });

    prev.onclick = () => this.navigate(-1);
    next.onclick = () => this.navigate(1);
    tocBtn.onclick = () => this.toggleToc();
    fontDec.onclick = () => this.adjustFont(-2);
    fontInc.onclick = () => this.adjustFont(2);
  }

  // â”€â”€ TOC â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private renderToc() {
    this.tocList.empty();
    if (!this.book) return;
    this.renderTocItems(this.book.toc, this.tocList, 0);

    // If TOC is empty, fall back to flat chapter list
    if (!this.book.toc.length) {
      this.book.chapters.forEach((ch, i) => {
        this.addTocEntry(this.tocList, ch.label, i, 0);
      });
    }
  }

  private renderTocItems(items: EpubTocItem[], parent: HTMLElement, depth: number) {
    for (const item of items) {
      const href = item.href.split('#')[0];
      const idx = this.book!.chapters.findIndex(c =>
        c.href.endsWith(href) || c.href === href
      );
      this.addTocEntry(parent, item.label, idx >= 0 ? idx : -1, depth);
      if (item.children.length) this.renderTocItems(item.children, parent, depth + 1);
    }
  }

  private addTocEntry(parent: HTMLElement, label: string, chapterIdx: number, depth: number) {
    const el = parent.createDiv({ cls: 'codex-toc-item' });
    el.style.paddingLeft = `${8 + depth * 14}px`;
    el.textContent = label;
    if (chapterIdx >= 0) {
      el.onclick = () => { this.renderChapter(chapterIdx); if (window.innerWidth < 600) this.toggleToc(); };
    } else {
      el.style.opacity = '0.5';
      el.style.cursor = 'default';
    }
  }

  private toggleToc() {
    this.tocOpen = !this.tocOpen;
    this.tocSidebar.toggleClass('is-collapsed', !this.tocOpen);
  }

  // â”€â”€ Rendering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private renderChapter(index: number) {
    if (!this.book) return;
    this.chapterIndex = Math.max(0, Math.min(index, this.book.chapters.length - 1));
    const ch = this.book.chapters[this.chapterIndex];

    this.chapterEl.empty();
    this.chapterEl.style.fontSize = `${this.fontSize}px`;
    // setHTML is safer but not universally available; innerHTML is fine for local EPUB files
    this.chapterEl.innerHTML = ch.content;

    // Intercept internal chapter links
    this.chapterEl.querySelectorAll<HTMLAnchorElement>('a[href]').forEach(a => {
      const href = a.getAttribute('href') ?? '';
      if (!href.startsWith('http')) {
        a.onclick = (e) => {
          e.preventDefault();
          const base = href.split('#')[0];
          const idx = this.book!.chapters.findIndex(c => c.href.endsWith(base) || c.href === base);
          if (idx >= 0) this.renderChapter(idx);
        };
      }
    });

    this.chapterLabel.textContent = ch.label;
    this.contentArea.scrollTop = 0;
    this.updateTocHighlight();
    this.plugin.setFileData(this.file!.path, { chapterHref: ch.href });
  }

  private updateTocHighlight() {
    this.tocList.querySelectorAll('.codex-toc-item').forEach((el, i) => {
      el.toggleClass('is-active', false);
    });
    // Re-highlight by scanning entries (simple approach: index matches)
    const items = Array.from(this.tocList.querySelectorAll('.codex-toc-item'));
    // Find entry for current chapter
    if (this.book) {
      const ch = this.book.chapters[this.chapterIndex];
      items.forEach(el => {
        if (el.textContent === ch.label) el.toggleClass('is-active', true);
      });
    }
  }

  private navigate(delta: number) {
    this.saveScroll();
    this.renderChapter(this.chapterIndex + delta);
  }

  private adjustFont(delta: number) {
    this.fontSize = Math.max(10, Math.min(36, this.fontSize + delta));
    this.chapterEl.style.fontSize = `${this.fontSize}px`;
    this.plugin.setFileData(this.file!.path, { fontSize: this.fontSize });
  }

  private saveScroll() {
    if (this.file) {
      this.plugin.setFileData(this.file.path, { scrollTop: this.contentArea.scrollTop });
    }
  }

  // â”€â”€ Events â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private bindEvents() {
    this.registerDomEvent(this.contentEl, 'mousemove', () => this.flashOverlay());

    // Save scroll position periodically on scroll
    this.registerDomEvent(this.contentArea, 'scroll', () => {
      clearTimeout(this.overlayTimer);
      this.overlayTimer = window.setTimeout(() => this.saveScroll(), 500);
    });

    this.registerDomEvent(document, 'keydown', (e: KeyboardEvent) => {
      if (this.app.workspace.getActiveViewOfType(EpubView) !== this) return;
      switch (e.key) {
        case 'ArrowRight': case 'j': case 'J': this.navigate(1); break;
        case 'ArrowLeft': case 'k': case 'K': this.navigate(-1); break;
        case 't': case 'T': this.toggleToc(); break;
        case '+': case '=': this.adjustFont(2); break;
        case '-': this.adjustFont(-2); break;
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

