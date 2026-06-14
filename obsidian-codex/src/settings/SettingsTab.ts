import { App, PluginSettingTab, Setting } from 'obsidian';
import type CodexPlugin from '../main';

export class CodexSettingTab extends PluginSettingTab {
  plugin: CodexPlugin;

  constructor(app: App, plugin: CodexPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    containerEl.empty();
    containerEl.createEl('h2', { text: 'Codex' });

    new Setting(containerEl)
      .setName('Default EPUB font size')
      .setDesc('Starting font size in pixels for reflowed EPUB text.')
      .addSlider(s => s
        .setLimits(10, 32, 1)
        .setValue(this.plugin.cfg.defaultFontSize)
        .setDynamicTooltip()
        .onChange(async v => {
          this.plugin.data.settings.defaultFontSize = v;
          await this.plugin.saveData_();
        }));

    new Setting(containerEl)
      .setName('Default CBZ layout')
      .setDesc('How comic pages are displayed when a file is first opened.')
      .addDropdown(d => d
        .addOption('single', 'Single page')
        .addOption('double', 'Double page')
        .setValue(this.plugin.cfg.defaultLayout)
        .onChange(async v => {
          this.plugin.data.settings.defaultLayout = v as 'single' | 'double';
          await this.plugin.saveData_();
        }));

    new Setting(containerEl)
      .setName('Default reading direction')
      .setDesc('Sets the initial RTL toggle for new CBZ files. Can be overridden per-file.')
      .addDropdown(d => d
        .addOption('ltr', 'Left to right')
        .addOption('rtl', 'Right to left (manga)')
        .setValue(this.plugin.cfg.defaultReadingDirection)
        .onChange(async v => {
          this.plugin.data.settings.defaultReadingDirection = v as 'ltr' | 'rtl';
          await this.plugin.saveData_();
        }));

    new Setting(containerEl)
      .setName('CBZ background color')
      .setDesc('Canvas color behind comic pages. "Match theme" uses Obsidian\'s background.')
      .addDropdown(d => d
        .addOption('system', 'Match theme')
        .addOption('black', 'Black')
        .addOption('white', 'White')
        .setValue(this.plugin.cfg.backgroundColor)
        .onChange(async v => {
          this.plugin.data.settings.backgroundColor = v as 'system' | 'black' | 'white';
          await this.plugin.saveData_();
        }));

    new Setting(containerEl)
      .setName('CBZ image upscaling')
      .setDesc('Rendering algorithm used when zooming into a page beyond its native resolution.')
      .addDropdown(d => d
        .addOption('auto', 'Auto (smooth)')
        .addOption('pixelated', 'Pixelated (sharp pixels)')
        .addOption('crisp-edges', 'Crisp edges')
        .setValue(this.plugin.cfg.cbzUpscaleQuality)
        .onChange(async v => {
          this.plugin.data.settings.cbzUpscaleQuality = v as 'auto' | 'pixelated' | 'crisp-edges';
          await this.plugin.saveData_();
        }));

    new Setting(containerEl)
      .setName('Clear all reading progress')
      .setDesc('Resets saved page positions and font sizes for every file.')
      .addButton(b => b
        .setButtonText('Clear')
        .setWarning()
        .onClick(async () => {
          this.plugin.data.files = {};
          await this.plugin.saveData_();
        }));
  }
}

