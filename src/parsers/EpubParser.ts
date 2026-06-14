import JSZip from 'jszip';

export interface EpubTocItem {
  label: string;
  href: string;
  children: EpubTocItem[];
}

export interface EpubChapter {
  id: string;
  label: string;
  href: string;
  content: string;
}

export interface EpubBook {
  chapters: EpubChapter[];
  toc: EpubTocItem[];
  resources: Map<string, string>;
}

const IMAGE_EXT = /\.(jpe?g|png|gif|webp|avif|bmp|svg)$/i;

export async function parseEpub(buffer: ArrayBuffer): Promise<EpubBook> {
  const zip = await JSZip.loadAsync(buffer);

  const containerXml = await zip.file('META-INF/container.xml')?.async('text');
  if (!containerXml) throw new Error('Invalid EPUB: missing container.xml');

  const containerDoc = new DOMParser().parseFromString(containerXml, 'application/xml');
  const opfPath = containerDoc.querySelector('rootfile')?.getAttribute('full-path');
  if (!opfPath) throw new Error('Invalid EPUB: cannot locate OPF');

  const opfDir = opfPath.includes('/') ? opfPath.slice(0, opfPath.lastIndexOf('/') + 1) : '';
  const opfXml = await zip.file(opfPath)?.async('text');
  if (!opfXml) throw new Error('Invalid EPUB: missing OPF file');

  const opfDoc = new DOMParser().parseFromString(opfXml, 'application/xml');

  // manifest: id → relative href
  const manifest = new Map<string, string>();
  opfDoc.querySelectorAll('manifest item').forEach(item => {
    const id = item.getAttribute('id');
    const href = item.getAttribute('href');
    if (id && href) manifest.set(id, href);
  });

  // spine: ordered list of absolute hrefs
  const spineHrefs: string[] = [];
  opfDoc.querySelectorAll('spine itemref').forEach(ref => {
    const idref = ref.getAttribute('idref');
    if (idref) {
      const rel = manifest.get(idref);
      if (rel) spineHrefs.push(opfDir + rel);
    }
  });

  // extract image resources as object URLs
  const resources = new Map<string, string>();
  for (const [path, zipFile] of Object.entries(zip.files)) {
    if (!zipFile.dir && IMAGE_EXT.test(path)) {
      const blob = await zipFile.async('blob');
      const url = URL.createObjectURL(blob);
      resources.set(path, url);
      const filename = path.split('/').pop()!;
      if (!resources.has(filename)) resources.set(filename, url);
    }
  }

  const toc = await parseToc(zip, opfDoc, opfDir);

  const chapters: EpubChapter[] = [];
  for (let i = 0; i < spineHrefs.length; i++) {
    const href = spineHrefs[i];
    const content = await loadChapterContent(zip, href, opfDir, resources);
    const label = findTocLabel(toc, href.replace(opfDir, '')) ?? `Chapter ${i + 1}`;
    chapters.push({ id: `ch-${i}`, label, href, content });
  }

  return { chapters, toc, resources };
}

async function parseToc(zip: JSZip, opfDoc: Document, opfDir: string): Promise<EpubTocItem[]> {
  // EPUB3: nav document
  const navItem = opfDoc.querySelector('manifest item[properties~="nav"]');
  if (navItem) {
    const navHref = navItem.getAttribute('href');
    if (navHref) {
      const navXml = await zip.file(opfDir + navHref)?.async('text');
      if (navXml) {
        const doc = new DOMParser().parseFromString(navXml, 'application/xhtml+xml');
        const navEl = doc.querySelector('nav[epub\\:type="toc"], nav');
        if (navEl) return parseNavOl(navEl.querySelector('ol'));
      }
    }
  }

  // EPUB2: toc.ncx
  const ncxIdref = opfDoc.querySelector('spine')?.getAttribute('toc');
  const ncxHref = ncxIdref ? manifest_get(opfDoc, ncxIdref) : 'toc.ncx';
  const ncxPath = ncxHref ? opfDir + ncxHref : opfDir + 'toc.ncx';
  const ncxXml = await zip.file(ncxPath)?.async('text');
  if (ncxXml) {
    const doc = new DOMParser().parseFromString(ncxXml, 'application/xml');
    return parseNcxNavMap(doc.querySelector('navMap'));
  }

  return [];
}

function manifest_get(opfDoc: Document, id: string): string | null {
  return opfDoc.querySelector(`manifest item[id="${id}"]`)?.getAttribute('href') ?? null;
}

function parseNavOl(ol: Element | null): EpubTocItem[] {
  if (!ol) return [];
  return Array.from(ol.children)
    .filter(el => el.tagName === 'li')
    .map(li => {
      const a = li.querySelector(':scope > a, :scope > span');
      const label = a?.textContent?.trim() ?? '';
      const href = (a?.tagName === 'a' ? a.getAttribute('href') : null) ?? '';
      const children = parseNavOl(li.querySelector(':scope > ol'));
      return { label, href, children };
    });
}

function parseNcxNavMap(navMap: Element | null): EpubTocItem[] {
  if (!navMap) return [];
  return Array.from(navMap.children)
    .filter(el => el.tagName === 'navPoint')
    .map(np => {
      const label = np.querySelector('navLabel text')?.textContent?.trim() ?? '';
      const href = np.querySelector('content')?.getAttribute('src') ?? '';
      const children = parseNcxNavMap(np);
      return { label, href, children };
    });
}

function findTocLabel(toc: EpubTocItem[], href: string): string | null {
  for (const item of toc) {
    const itemHref = item.href.split('#')[0];
    if (itemHref === href || item.href === href) return item.label;
    const found = findTocLabel(item.children, href);
    if (found) return found;
  }
  return null;
}

async function loadChapterContent(
  zip: JSZip,
  href: string,
  opfDir: string,
  resources: Map<string, string>
): Promise<string> {
  const html =
    (await zip.file(href)?.async('text')) ??
    (await zip.file(opfDir + href)?.async('text')) ??
    '';

  if (!html) return '<p>(Chapter content not found.)</p>';

  const doc = new DOMParser().parseFromString(html, 'application/xhtml+xml');

  // Remove scripts, styles, link elements
  doc.querySelectorAll('script, style, link').forEach(el => el.remove());

  // Rewrite image sources to object URLs
  doc.querySelectorAll('img[src]').forEach(el => {
    const src = el.getAttribute('src') ?? '';
    const url = resolveResource(src, href, resources);
    if (url) el.setAttribute('src', url);
  });

  // Remove dangerous attributes
  doc.querySelectorAll('*').forEach(el => {
    ['onclick', 'onerror', 'onload', 'onmouseover'].forEach(attr => el.removeAttribute(attr));
  });

  return doc.querySelector('body')?.innerHTML ?? doc.documentElement.innerHTML;
}

function resolveResource(src: string, chapterHref: string, resources: Map<string, string>): string | null {
  if (resources.has(src)) return resources.get(src)!;
  // Try resolving relative to chapter path
  const base = chapterHref.includes('/') ? chapterHref.slice(0, chapterHref.lastIndexOf('/') + 1) : '';
  const resolved = base + src;
  if (resources.has(resolved)) return resources.get(resolved)!;
  // Try just the filename
  const filename = src.split('/').pop() ?? src;
  return resources.get(filename) ?? null;
}

export function revokeEpubResources(book: EpubBook) {
  // Deduplicate URLs before revoking
  const seen = new Set<string>();
  for (const url of book.resources.values()) {
    if (!seen.has(url)) { seen.add(url); URL.revokeObjectURL(url); }
  }
}
