import { Plugin } from 'obsidian';
import { CBZ_VIEW_TYPE, CbzView } from './views/CbzView';
import { EPUB_VIEW_TYPE, EpubView } from './views/EpubView';
import { LIBRARY_VIEW_TYPE, LibraryView } from './views/LibraryView';
import { CodexSettingTab } from './settings/SettingsTab';
import { CodexData, CodexSettings, DEFAULT_SETTINGS, PerFileData } from './types';

export default class CodexPlugin extends Plugin {
  data: CodexData = { settings: { ...DEFAULT_SETTINGS }, files: {} };

  async onload() {
    await this.loadData_();

    this.registerView(CBZ_VIEW_TYPE, leaf => new CbzView(leaf, this));
    this.registerView(EPUB_VIEW_TYPE, leaf => new EpubView(leaf, this));
    this.registerView(LIBRARY_VIEW_TYPE, leaf => new LibraryView(leaf, this));

    this.registerExtensions(['cbz'], CBZ_VIEW_TYPE);
    this.registerExtensions(['epub'], EPUB_VIEW_TYPE);

    this.addRibbonIcon('book-open', 'Codex Library', () => this.openLibrary());

    this.addCommand({
      id: 'open-library',
      name: 'Open Library',
      callback: () => this.openLibrary(),
    });

    this.addSettingTab(new CodexSettingTab(this.app, this));
  }

  async openLibrary() {
    const existing = this.app.workspace.getLeavesOfType(LIBRARY_VIEW_TYPE);
    if (existing.length) { this.app.workspace.revealLeaf(existing[0]); return; }
    const leaf = this.app.workspace.getLeaf('tab');
    await leaf.setViewState({ type: LIBRARY_VIEW_TYPE, active: true });
  }

  onunload() {}

  async loadData_() {
    const raw = await this.loadData();
    if (raw) {
      this.data = {
        settings: { ...DEFAULT_SETTINGS, ...(raw.settings ?? {}) },
        files: raw.files ?? {},
      };
    }
  }

  async saveData_() {
    await this.saveData(this.data);
  }

  get cfg(): CodexSettings {
    return this.data.settings;
  }

  getFileData(path: string): Partial<PerFileData> {
    return this.data.files[path] ?? {};
  }

  setFileData(path: string, patch: Partial<PerFileData>): void {
    this.data.files[path] = { ...this.data.files[path], ...patch };
    // fire-and-forget — no need to await on every page turn
    this.saveData_();
  }
}
