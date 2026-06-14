import { App, ItemView, TFile, WorkspaceLeaf } from 'obsidian';
import type CodexPlugin from '../main';
import JSZip from 'jszip';

export const LIBRARY_VIEW_TYPE = 'codex-library';

interface BookCard {
  file: TFile;
  type: 'cbz' | 'epub';
  el: HTMLElement;
  coverLoaded: boolean;
  coverUrl: string | null;
}

type SortKey = 'name' | 'recent';

export class LibraryView extends ItemView {
  plugin: CodexPlugin;

  private cards: BookCard[] = [];
  private filter = '';
  private sortKey: SortKey = 'name';
  private grid!: HTMLElement;
  private countEl!: HTMLElement;
  private emptyEl!: HTMLElement;
  private observer!: IntersectionObserver;

  constructor(leaf: WorkspaceLeaf, plugin: CodexPlugin) {
    super(leaf);
    this.plugin = plugin;
  }

  getViewType() { return LIBRARY_VIEW_TYPE; }
  getDisplayText() { return 'Library'; }
  getIcon() { return 'library'; }

  async onOpen() {
    this.contentEl.addClass('codex-library-view');
    this.buildToolbar();

    this.grid = this.contentEl.createDiv('codex-library-grid');

    this.emptyEl = this.contentEl.createDiv('codex-library-empty');
    this.emptyEl.createEl('p', { text: 'No CBZ or EPUB files found in vault.' });
    this.emptyEl.createEl('p', { cls: 'codex-library-empty-hint', text: 'Add .cbz or .epub files to any folder in this vault.' });

    this.observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const card = this.cards.find(c => c.el === entry.target);
        if (card && !card.coverLoaded) {
          this.loadCover(card);
          this.observer.unobserve(entry.target);
        }
      }
    }, { rootMargin: '200px' });

    await this.scan();

    this.registerEvent(this.app.vault.on('create', f => { if (isBook(f)) this.scan(); }));
    this.registerEvent(this.app.vault.on('delete', f => { if (isBook(f)) this.scan(); }));
    this.registerEvent(this.app.vault.on('rename', f => { if (isBook(f)) this.scan(); }));
  }

  async onClose(): Promise<void> {
    this.observer.disconnect();
    this.revokeAllCovers();
  }

  // ── Toolbar ──────────────────────────────────────────────────────────────────

  private buildToolbar() {
    const toolbar = this.contentEl.createDiv('codex-library-toolbar');

    const left = toolbar.createDiv('codex-library-toolbar-left');
    left.createEl('span', { cls: 'codex-library-title-text', text: 'Library' });
    this.countEl = left.createEl('span', { cls: 'codex-library-count' });

    const right = toolbar.createDiv('codex-library-toolbar-right');

    const search = right.createEl('input', {
      cls: 'codex-library-search',
      attr: { type: 'text', placeholder: '🔍 Search…', spellcheck: 'false' },
    });
    search.oninput = () => { this.filter = search.value.toLowerCase(); this.applyFilter(); };

    const sortBtn = right.createEl('select', { cls: 'codex-library-sort' });
    sortBtn.createEl('option', { value: 'name', text: 'A – Z' });
    sortBtn.createEl('option', { value: 'recent', text: 'Recent' });
    sortBtn.onchange = () => { this.sortKey = sortBtn.value as SortKey; this.scan(); };

    right.createEl('button', { cls: 'codex-btn codex-btn-sm', text: '↻', attr: { title: 'Refresh' } })
      .onclick = () => this.scan();
  }

  // ── Scan & render ────────────────────────────────────────────────────────────

  private async scan() {
    this.revokeAllCovers();
    this.cards = [];
    this.grid.empty();

    let files = this.app.vault.getFiles().filter(isBook);

    if (this.sortKey === 'recent') {
      files = files.sort((a, b) => {
        const at = this.plugin.getFileData(a.path).page != null || this.plugin.getFileData(a.path).chapterHref ? 1 : 0;
        const bt = this.plugin.getFileData(b.path).page != null || this.plugin.getFileData(b.path).chapterHref ? 1 : 0;
        if (bt !== at) return bt - at;
        return a.basename.localeCompare(b.basename);
      });
    } else {
      files = files.sort((a, b) => a.basename.localeCompare(b.basename));
    }

    this.emptyEl.style.display = files.length ? 'none' : '';
    this.countEl.textContent = files.length ? `${files.length} item${files.length !== 1 ? 's' : ''}` : '';

    for (const file of files) this.addCard(file);
    this.applyFilter();
  }

  private addCard(file: TFile) {
    const type = file.extension as 'cbz' | 'epub';
    const saved = this.plugin.getFileData(file.path);
    const hasProgress = saved.page != null || !!saved.chapterHref;

    const el = this.grid.createDiv({ cls: 'codex-library-card' });
    el.setAttribute('data-path', file.path);
    el.onclick = (e) => {
      const leaf = this.app.workspace.getLeaf(e.ctrlKey || e.metaKey ? 'tab' : false);
      leaf.openFile(file);
    };

    // Cover area
    const coverWrap = el.createDiv('codex-library-cover-wrap');
    coverWrap.createDiv('codex-library-cover-placeholder').setText(type === 'cbz' ? '🗂' : '📖');

    // Progress ribbon (shown if reading in progress)
    if (hasProgress) {
      coverWrap.createDiv('codex-library-ribbon');
    }

    // Footer
    const footer = el.createDiv('codex-library-card-footer');
    footer.createDiv({ cls: 'codex-library-card-title', text: file.basename });

    const meta = footer.createDiv('codex-library-card-meta');
    meta.createEl('span', { cls: `codex-library-badge codex-badge-${type}`, text: type });

    if (saved.page != null) {
      meta.createEl('span', { cls: 'codex-library-progress-text', text: `p.${saved.page + 1}` });
    } else if (saved.chapterHref) {
      meta.createEl('span', { cls: 'codex-library-progress-text', text: 'reading' });
    }

    const card: BookCard = { file, type, el, coverLoaded: false, coverUrl: null };
    this.cards.push(card);
    this.observer.observe(el);
  }

  // ── Cover loading ────────────────────────────────────────────────────────────

  private async loadCover(card: BookCard) {
    card.coverLoaded = true;
    try {
      const url = card.type === 'cbz'
        ? await extractCbzCover(card.file, this.app)
        : await extractEpubCover(card.file, this.app);
      if (!url) return;
      card.coverUrl = url;

      const placeholder = card.el.querySelector<HTMLElement>('.codex-library-cover-placeholder');
      if (!placeholder) return;

      const img = document.createElement('img');
      img.className = 'codex-library-cover';
      img.alt = card.file.basename;
      img.src = url;
      placeholder.replaceWith(img);
    } catch {
      // keep placeholder
    }
  }

  // ── Filter ───────────────────────────────────────────────────────────────────

  private applyFilter() {
    let visible = 0;
    for (const card of this.cards) {
      const show = !this.filter || card.file.basename.toLowerCase().includes(this.filter);
      card.el.style.display = show ? '' : 'none';
      if (show) visible++;
    }
    this.countEl.textContent = this.filter
      ? `${visible} of ${this.cards.length}`
      : `${this.cards.length} item${this.cards.length !== 1 ? 's' : ''}`;
  }

  // ── Cleanup ──────────────────────────────────────────────────────────────────

  private revokeAllCovers() {
    for (const card of this.cards) {
      if (card.coverUrl) { URL.revokeObjectURL(card.coverUrl); card.coverUrl = null; }
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isBook(f: TFile | unknown): f is TFile {
  return f instanceof TFile && (f.extension === 'cbz' || f.extension === 'epub');
}

const IMAGE_RE = /\.(jpe?g|png|gif|webp)$/i;

async function extractCbzCover(file: TFile, app: App): Promise<string | null> {
  const buffer = await app.vault.readBinary(file);
  const zip = await JSZip.loadAsync(buffer);
  const entries = Object.values(zip.files)
    .filter(f => !f.dir && IMAGE_RE.test(f.name))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }));
  if (!entries.length) return null;
  const blob = await entries[0].async('blob');
  return URL.createObjectURL(blob);
}

async function extractEpubCover(file: TFile, app: App): Promise<string | null> {
  const buffer = await app.vault.readBinary(file);
  const zip = await JSZip.loadAsync(buffer);

  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) return null;
  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) return null;
  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opfXml = await zip.file(opfPath)?.async('text');
  if (!opfXml) return null;
  const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

  const tryLoad = async (href: string): Promise<string | null> => {
    for (const path of [opfDir + href, href]) {
      const entry = zip.file(path);
      if (entry) { const b = await entry.async('blob'); return URL.createObjectURL(b); }
    }
    return null;
  };

  // EPUB3 cover-image property
  const ep3href = opfDoc.querySelector('manifest item[properties~="cover-image"]')?.getAttribute('href');
  if (ep3href) { const u = await tryLoad(ep3href); if (u) return u; }

  // EPUB2 <meta name="cover">
  const metaId = opfDoc.querySelector('meta[name="cover"]')?.getAttribute('content');
  const ep2href = metaId
    ? opfDoc.querySelector(`manifest item[id="${metaId}"]`)?.getAttribute('href')
    : null;
  if (ep2href) { const u = await tryLoad(ep2href); if (u) return u; }

  // Common filenames
  for (const name of ['cover.jpg', 'cover.jpeg', 'cover.png', 'Cover.jpg',
    'images/cover.jpg', 'Images/cover.jpg', 'OEBPS/cover.jpg', 'OEBPS/Images/cover.jpg']) {
    const u = await tryLoad(name);
    if (u) return u;
  }

  return null;
}
