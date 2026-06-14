export interface PerFileData {
  page: number;
  chapterHref: string;
  scrollTop: number;
  fontSize: number;
  rtl: boolean;
}

export interface CodexSettings {
  defaultFontSize: number;
  defaultLayout: 'single' | 'double';
  defaultReadingDirection: 'ltr' | 'rtl';
  backgroundColor: 'system' | 'black' | 'white';
  scrollSpeed: number;
  cbzUpscaleQuality: 'auto' | 'pixelated' | 'crisp-edges';
}

export const DEFAULT_SETTINGS: CodexSettings = {
  defaultFontSize: 16,
  defaultLayout: 'single',
  defaultReadingDirection: 'ltr',
  backgroundColor: 'system',
  scrollSpeed: 3,
  cbzUpscaleQuality: 'auto',
};

export interface CodexData {
  settings: CodexSettings;
  files: Record<string, Partial<PerFileData>>;
}
