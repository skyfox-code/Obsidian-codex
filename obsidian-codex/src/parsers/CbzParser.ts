import JSZip from 'jszip';

export interface CbzPage {
  name: string;
  url: string;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp)$/i;

export async function parseCbz(buffer: ArrayBuffer): Promise<CbzPage[]> {
  const zip = await JSZip.loadAsync(buffer);

  const entries = Object.values(zip.files)
    .filter(f => !f.dir && IMAGE_EXT.test(f.name))
    .sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' })
    );

  const pages: CbzPage[] = [];
  for (const entry of entries) {
    const blob = await entry.async('blob');
    pages.push({ name: entry.name, url: URL.createObjectURL(blob) });
  }
  return pages;
}

export function revokeCbzPages(pages: CbzPage[]) {
  for (const p of pages) URL.revokeObjectURL(p.url);
}
