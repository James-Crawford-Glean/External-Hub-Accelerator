// Pure logo discovery + classification: crawl, parse, rank, sniff. The AWS/DDB
// caching lives in the service. Uses global fetch for the network I/O;
// everything below the fetch is deterministic and unit-testable.
//
// Priority chain — favors square images for tile rendering:
//   1. JSON-LD Organization.logo  (<script type="application/ld+json">)
//   2. apple-touch-icon declared in HTML, largest size if multiple
//   3. apple-touch-icon probed at /apple-touch-icon[-precomposed].png
//   4. <link rel="icon" sizes="N">, largest size
//   5. <link rel="image_src"> — older share-preview slot, often a logo
//   6. og:image — usually a hero/banner; second-to-last
//   7. <link rel="icon"> with no size hint
//   8. /favicon.ico fallback

// A real-browser UA + browser-like headers. A self-identifying "...Bot..." UA is the
// first thing edge WAFs reject, so we present as a current Chrome. This does NOT defeat
// active JS challenges (Cloudflare managed challenge etc.) — failure is silent and the
// tile falls back to initials.
export const UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/133.0.0.0 Safari/537.36';

const ACCEPT = 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8';
const DEFAULT_HEADERS: Record<string, string> = {
  'User-Agent': UA,
  Accept: ACCEPT,
  'Accept-Language': 'en-US,en;q=0.9',
  'Upgrade-Insecure-Requests': '1',
};

export const HTML_BYTES_CAP = 2 * 1024 * 1024;
export const IMAGE_BYTES_CAP = 4 * 1024 * 1024;
export const TIMEOUT_MS = 10_000;
export const PROBE_TIMEOUT_MS = 5_000;

// Source tags, ordered best->worst for ranking when intrinsic dims are unavailable.
export const SOURCE_JSONLD = 'jsonld';
export const SOURCE_APPLE = 'apple-touch';
export const SOURCE_LINK_ICON = 'link-icon';
export const SOURCE_IMAGE_SRC = 'image_src';
export const SOURCE_OG = 'og-image';
export const SOURCE_FAVICON = 'favicon';

export const KIND_ICON = 'icon';
export const KIND_MARK = 'mark';
export const KIND_WORDMARK = 'wordmark';
export const KIND_BANNER = 'banner';
export const KIND_UNKNOWN = 'unknown';

export type LogoKind =
  typeof KIND_ICON | typeof KIND_MARK | typeof KIND_WORDMARK | typeof KIND_BANNER | typeof KIND_UNKNOWN;

// kind -> rank for the two selection goals. Higher wins. Mirrors _LOGO_RANK / _ICON_RANK.
const LOGO_RANK: Record<string, number> = {
  [KIND_MARK]: 4,
  [KIND_WORDMARK]: 3,
  [KIND_UNKNOWN]: 2,
  [KIND_ICON]: 1,
  [KIND_BANNER]: 0,
};
const ICON_RANK: Record<string, number> = {
  [KIND_ICON]: 4,
  [KIND_MARK]: 3,
  [KIND_UNKNOWN]: 2,
  [KIND_WORDMARK]: 1,
  [KIND_BANNER]: 0,
};
const DEFAULT_RANK = 2;

/** Structural shape shared by the manifest builder and any consumer ranking stored variants. */
export interface RankableVariant {
  readonly kind: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly declared_size?: number | null;
}

export type LogoGoal = 'logo' | 'icon';

export function areaOf(v: RankableVariant): number {
  if (v.width && v.height) return v.width * v.height;
  const s = v.declared_size;
  return s ? s * s : 0;
}

/** Best-first ordering for a selection goal: kind rank, then pixel area. `logo` prefers a
 *  full mark, `icon` prefers a square tile. Callers take index 0. */
export function rankVariants<T extends RankableVariant>(variants: readonly T[], goal: LogoGoal): T[] {
  const rank = goal === 'icon' ? ICON_RANK : LOGO_RANK;
  return variants.toSorted(
    (a, b) => (rank[b.kind] ?? DEFAULT_RANK) - (rank[a.kind] ?? DEFAULT_RANK) || areaOf(b) - areaOf(a),
  );
}

export interface LogoCandidate {
  url: string;
  source: string;
  declared_size: number | null;
}

const ICO_CTS = new Set(['image/x-icon', 'image/vnd.microsoft.icon', 'image/ico']);
const ORG_TYPES = new Set(['Organization', 'Corporation', 'Company', 'WebSite', 'LocalBusiness']);

// We accept ANY image/* content-type; when the server sends a generic/missing type
// (octet-stream, text/plain — common for mislabeled favicons) we sniff these magic-byte
// signatures so a real image still gets through.
const IMAGE_MAGIC: ReadonlyArray<readonly [number[], string]> = [
  [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 'image/png'],
  [[0xff, 0xd8, 0xff], 'image/jpeg'],
  [[0x47, 0x49, 0x46, 0x38, 0x37, 0x61], 'image/gif'], // GIF87a
  [[0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 'image/gif'], // GIF89a
  [[0x00, 0x00, 0x01, 0x00], 'image/x-icon'],
  [[0x42, 0x4d], 'image/bmp'], // BM
];

function startsWithBytes(raw: Uint8Array, sig: number[]): boolean {
  if (raw.length < sig.length) return false;
  for (let i = 0; i < sig.length; i++) if (raw[i] !== sig[i]) return false;
  return true;
}

function asciiSlice(raw: Uint8Array, start: number, end: number): string {
  let s = '';
  for (let i = start; i < end && i < raw.length; i++) s += String.fromCharCode(raw[i]!);
  return s;
}

/** Detect an image content-type from magic bytes; null if not an image. */
export function sniffImageCt(raw: Uint8Array): string | null {
  for (const [sig, ct] of IMAGE_MAGIC) if (startsWithBytes(raw, sig)) return ct;
  if (raw.length >= 12 && asciiSlice(raw, 0, 4) === 'RIFF' && asciiSlice(raw, 8, 12) === 'WEBP') {
    return 'image/webp';
  }
  if (raw.length >= 12 && asciiSlice(raw, 4, 8) === 'ftyp') {
    const brand = asciiSlice(raw, 8, 12);
    if (brand === 'avif' || brand === 'avis') return 'image/avif';
  }
  const head = asciiSlice(raw, 0, 512).replace(/^\s+/, '').toLowerCase();
  if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'image/svg+xml';
  return null;
}

// HTML head parsing -----------------------------------------------------------

interface ParsedHead {
  ogImage: string | null;
  imageSrc: string | null;
  appleIcons: Map<number | null, string>;
  icons: Map<number | null, string>;
  jsonLdPayloads: string[];
}

function parseSize(sizes: string): number | null {
  const m = /(\d+)x\d+/.exec(sizes);
  return m ? Number.parseInt(m[1]!, 10) : null;
}

function attrs(tag: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([a-zA-Z_:][-a-zA-Z0-9_:.]*)\s*(?:=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
  let m: RegExpExecArray | null;
  let first = true;
  while ((m = re.exec(tag)) !== null) {
    if (first) {
      first = false; // skip the tag name itself
      continue;
    }
    const name = m[1]!.toLowerCase();
    const value = m[2] ?? m[3] ?? m[4] ?? '';
    out[name] = value;
  }
  return out;
}

/** Parse a page's <head> for logo candidates. Mirrors _LogoSelector: reads only up to
 *  </head>, collects og:image / image_src / apple-touch-icon+icon (by size) / JSON-LD. */
export function parseHead(html: string): ParsedHead {
  const headEnd = html.toLowerCase().indexOf('</head>');
  const scope = headEnd >= 0 ? html.slice(0, headEnd) : html;

  const out: ParsedHead = {
    ogImage: null,
    imageSrc: null,
    appleIcons: new Map(),
    icons: new Map(),
    jsonLdPayloads: [],
  };

  const tagRe = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(scope)) !== null) {
    const tag = m[1]!.toLowerCase();
    const a = attrs(m[0]!);
    if (tag === 'meta' && a['property'] === 'og:image') {
      out.ogImage = out.ogImage ?? (a['content'] || null);
    } else if (tag === 'link') {
      const rel = (a['rel'] ?? '').toLowerCase();
      const href = a['href'];
      if (!href) continue;
      const size = parseSize(a['sizes'] ?? '');
      if (rel.includes('apple-touch-icon')) {
        if (!out.appleIcons.has(size)) out.appleIcons.set(size, href);
      } else if (rel === 'image_src') {
        out.imageSrc = out.imageSrc ?? href;
      } else if (rel === 'icon' || rel === 'shortcut icon') {
        if (!out.icons.has(size)) out.icons.set(size, href);
      }
    } else if (tag === 'script' && (a['type'] ?? '').toLowerCase() === 'application/ld+json') {
      // capture the raw payload up to the next </script>
      const rest = scope.slice(tagRe.lastIndex);
      const close = rest.toLowerCase().indexOf('</script>');
      out.jsonLdPayloads.push(close >= 0 ? rest.slice(0, close) : rest);
    }
  }
  return out;
}

/** Largest declared size; falls back to any unsized entry. */
export function largest(bySize: Map<number | null, string>): string | null {
  let bestKey: number | null = null;
  let bestVal: string | null = null;
  for (const [k, v] of bySize) {
    if (k !== null && (bestKey === null || k > bestKey)) {
      bestKey = k;
      bestVal = v;
    }
  }
  if (bestVal !== null) return bestVal;
  const first = bySize.values().next();
  return first.done ? null : first.value;
}

/** Walk JSON-LD blobs (incl. @graph) for an Organization.logo. */
export function logoFromJsonLd(payloads: string[]): string | null {
  function* candidates(data: unknown): Generator<unknown> {
    if (Array.isArray(data)) {
      yield* data;
    } else if (data && typeof data === 'object') {
      yield data;
      const graph = (data as Record<string, unknown>)['@graph'];
      if (Array.isArray(graph)) for (const inner of graph) yield* candidates(inner);
    }
  }

  for (const raw of payloads) {
    let data: unknown;
    try {
      data = JSON.parse(raw);
    } catch {
      continue;
    }
    for (const c of candidates(data)) {
      if (!c || typeof c !== 'object') continue;
      const obj = c as Record<string, unknown>;
      let t: unknown = obj['@type'] ?? '';
      if (Array.isArray(t)) t = t.find((x) => typeof x === 'string' && ORG_TYPES.has(x)) ?? '';
      if (typeof t === 'string' && ORG_TYPES.has(t) && obj['logo']) {
        const logo = obj['logo'];
        if (typeof logo === 'string') return logo;
        if (logo && typeof logo === 'object') {
          const lo = logo as Record<string, unknown>;
          const url = lo['url'] ?? lo['contentUrl'];
          if (typeof url === 'string') return url;
        }
      }
    }
  }
  return null;
}

/** urljoin(base, href) — resolve a possibly-relative href against the final page URL. */
export function resolveUrl(base: string, href: string): string {
  try {
    return new URL(href, base).toString();
  } catch {
    return href;
  }
}

/** origin ('scheme://host[:port]') from a URL. */
export function originOf(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return '';
  }
}

/** Every logo candidate exposed by a parsed head, in priority order, deduped by absolute
 *  URL. Mirrors extract_logo_candidates: the caller fetches/sniffs/classifies/ranks. */
export function candidatesFromHead(finalUrl: string, p: ParsedHead): LogoCandidate[] {
  const origin = originOf(finalUrl);
  const out: LogoCandidate[] = [];
  const seen = new Set<string>();

  const add = (url: string | null, source: string, declared: number | null = null): void => {
    if (!url) return;
    const absolute = resolveUrl(finalUrl, url);
    if (seen.has(absolute)) return;
    seen.add(absolute);
    out.push({ url: absolute, source, declared_size: declared });
  };

  const ld = logoFromJsonLd(p.jsonLdPayloads);
  if (ld) add(ld, SOURCE_JSONLD);
  for (const [size, url] of p.appleIcons) add(url, SOURCE_APPLE, size);
  for (const path of ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']) {
    add(`${origin}${path}`, SOURCE_APPLE);
  }
  for (const [size, url] of p.icons) add(url, SOURCE_LINK_ICON, size);
  add(p.imageSrc, SOURCE_IMAGE_SRC);
  add(p.ogImage, SOURCE_OG);
  add(`${origin}/favicon.ico`, SOURCE_FAVICON);
  return out;
}

/** Best single logo URL for a parsed head (absolute), mirroring extract_logo_url's chain.
 *  Note: the Python version probes apple-touch paths over the network; this pure form
 *  emits the first declared apple path as a best-effort (the caller can probe if needed). */
export function bestLogoUrlFromHead(finalUrl: string, p: ParsedHead): string | null {
  const cand = logoFromJsonLd(p.jsonLdPayloads);
  if (cand) return resolveUrl(finalUrl, cand);
  const apple = largest(p.appleIcons);
  if (apple) return resolveUrl(finalUrl, apple);
  const origin = originOf(finalUrl);
  // sized icons win over unsized before we fall to image_src/og/favicon
  let bestKey: number | null = null;
  let bestVal: string | null = null;
  for (const [k, v] of p.icons) {
    if (k !== null && (bestKey === null || k > bestKey)) {
      bestKey = k;
      bestVal = v;
    }
  }
  if (bestVal) return resolveUrl(finalUrl, bestVal);
  if (p.imageSrc) return resolveUrl(finalUrl, p.imageSrc);
  if (p.ogImage) return resolveUrl(finalUrl, p.ogImage);
  const icon = largest(p.icons);
  if (icon) return resolveUrl(finalUrl, icon);
  return `${origin}/favicon.ico`;
}

// dimension sniffing ----------------------------------------------------------

function u16be(raw: Uint8Array, o: number): number {
  return (raw[o]! << 8) | raw[o + 1]!;
}
function u16le(raw: Uint8Array, o: number): number {
  return raw[o]! | (raw[o + 1]! << 8);
}
function u32be(raw: Uint8Array, o: number): number {
  return (raw[o]! * 0x1000000 + (raw[o + 1]! << 16) + (raw[o + 2]! << 8) + raw[o + 3]!) >>> 0;
}
function i32le(raw: Uint8Array, o: number): number {
  const v = raw[o]! | (raw[o + 1]! << 8) | (raw[o + 2]! << 16) | (raw[o + 3]! << 24);
  return v; // signed by construction of <<24
}

/** Intrinsic [width, height] from an image's header bytes — no decode. null when the
 *  format isn't recognized or the header is truncated. Mirrors sniff_dimensions. */
export function sniffDimensions(raw: Uint8Array, ct: string): [number, number] | null {
  try {
    if (startsWithBytes(raw, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) && raw.length >= 24) {
      return [u32be(raw, 16), u32be(raw, 20)];
    }
    if (
      (startsWithBytes(raw, [0x47, 0x49, 0x46, 0x38, 0x37, 0x61]) ||
        startsWithBytes(raw, [0x47, 0x49, 0x46, 0x38, 0x39, 0x61])) &&
      raw.length >= 10
    ) {
      return [u16le(raw, 6), u16le(raw, 8)];
    }
    if (startsWithBytes(raw, [0x42, 0x4d]) && raw.length >= 26) {
      return [Math.abs(i32le(raw, 18)), Math.abs(i32le(raw, 22))];
    }
    if (startsWithBytes(raw, [0x00, 0x00, 0x01, 0x00]) && raw.length >= 8) {
      // ICO: first dir entry; 0 encodes 256
      return [raw[6]! || 256, raw[7]! || 256];
    }
    if (asciiSlice(raw, 0, 4) === 'RIFF' && asciiSlice(raw, 8, 12) === 'WEBP') {
      return webpDims(raw);
    }
    if (ct === 'image/jpeg' || startsWithBytes(raw, [0xff, 0xd8, 0xff])) {
      return jpegDims(raw);
    }
    const head = asciiSlice(raw, 0, 512).replace(/^\s+/, '').toLowerCase();
    if (ct === 'image/svg+xml' || head.startsWith('<?xml') || head.startsWith('<svg')) {
      return svgDims(raw);
    }
  } catch {
    return null;
  }
  return null;
}

function jpegDims(raw: Uint8Array): [number, number] | null {
  let i = 2;
  const n = raw.length;
  while (i + 9 < n) {
    if (raw[i] !== 0xff) {
      i += 1;
      continue;
    }
    const marker = raw[i + 1]!;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      const h = u16be(raw, i + 5);
      const w = u16be(raw, i + 7);
      return [w, h];
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      i += 2;
      continue;
    }
    const seg = u16be(raw, i + 2);
    i += 2 + seg;
  }
  return null;
}

function webpDims(raw: Uint8Array): [number, number] | null {
  const fourcc = asciiSlice(raw, 12, 16);
  if (fourcc === 'VP8X' && raw.length >= 30) {
    const w = (raw[24]! | (raw[25]! << 8) | (raw[26]! << 16)) + 1;
    const h = (raw[27]! | (raw[28]! << 8) | (raw[29]! << 16)) + 1;
    return [w, h];
  }
  if (fourcc === 'VP8 ' && raw.length >= 30) {
    const w = u16le(raw, 26) & 0x3fff;
    const h = u16le(raw, 28) & 0x3fff;
    return [w, h];
  }
  if (fourcc === 'VP8L' && raw.length >= 25 && raw[20] === 0x2f) {
    const b = (raw[21]! | (raw[22]! << 8) | (raw[23]! << 16) | (raw[24]! << 24)) >>> 0;
    return [(b & 0x3fff) + 1, ((b >> 14) & 0x3fff) + 1];
  }
  return null;
}

function svgDims(raw: Uint8Array): [number, number] | null {
  const head = asciiSlice(raw, 0, 1024);
  const vb = /viewBox\s*=\s*["']\s*[\d.]+\s+[\d.]+\s+([\d.]+)\s+([\d.]+)/.exec(head);
  if (vb) return [Math.trunc(Number.parseFloat(vb[1]!)), Math.trunc(Number.parseFloat(vb[2]!))];
  const w = /\bwidth\s*=\s*["']?\s*([\d.]+)/.exec(head);
  const h = /\bheight\s*=\s*["']?\s*([\d.]+)/.exec(head);
  if (w && h) return [Math.trunc(Number.parseFloat(w[1]!)), Math.trunc(Number.parseFloat(h[1]!))];
  return null;
}

/** icon | mark | wordmark | banner | unknown, from intrinsic size + source. Dimensions
 *  win when known; otherwise the source tag is the signal. Mirrors classify(). */
export function classify(source: string, ct: string, w: number | null, h: number | null): LogoKind {
  if (ICO_CTS.has(ct)) return KIND_ICON;
  if (w && h) {
    const ratio = Math.max(w, h) / Math.min(w, h);
    if (source === SOURCE_OG && ratio > 1.6) return KIND_BANNER; // the classic 1.91:1 social card
    if (ratio <= 1.25) return Math.max(w, h) <= 128 ? KIND_ICON : KIND_MARK;
    if (ratio <= 2.6) return KIND_WORDMARK;
    return KIND_BANNER;
  }
  if (source === SOURCE_FAVICON || source === SOURCE_APPLE || source === SOURCE_LINK_ICON) {
    return KIND_ICON;
  }
  if (source === SOURCE_JSONLD) return KIND_MARK;
  if (source === SOURCE_OG) return KIND_BANNER;
  return KIND_UNKNOWN;
}

// network I/O -----------------------------------------------------------------

async function fetchWithTimeout(url: string, init: RequestInit, timeoutMs: number): Promise<Response> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    // redirect: follow so resp.url is the final URL (mirrors urllib's resp.url).
    return await fetch(url, { ...init, redirect: 'follow', signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

async function readCapped(resp: Response, cap: number): Promise<Uint8Array> {
  const buf = await resp.arrayBuffer();
  const all = new Uint8Array(buf);
  return all.length > cap ? all.subarray(0, cap) : all;
}

/** Fetch a site's HTML and parse its <head>. Returns { finalUrl, head } or null. Global
 *  fetch decompresses gzip/br transparently, so no manual decode is needed. */
export async function fetchAndParse(website: string): Promise<{ finalUrl: string; head: ParsedHead } | null> {
  if (!website) return null;
  let url = website;
  if (!url.startsWith('http://') && !url.startsWith('https://')) url = `https://${url}`;
  let resp: Response;
  try {
    resp = await fetchWithTimeout(
      url,
      { headers: { ...DEFAULT_HEADERS, Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9' } },
      TIMEOUT_MS,
    );
  } catch {
    return null;
  }
  let html: string;
  try {
    const raw = await readCapped(resp, HTML_BYTES_CAP);
    html = new TextDecoder('utf-8', { fatal: false }).decode(raw);
  } catch {
    return null;
  }
  return { finalUrl: resp.url || url, head: parseHead(html) };
}

/** Every logo candidate a site exposes ({url, source, declared_size}). */
export async function extractLogoCandidates(website: string): Promise<LogoCandidate[]> {
  const parsed = await fetchAndParse(website);
  if (!parsed) return [];
  return candidatesFromHead(parsed.finalUrl, parsed.head);
}

/** HEAD probe; true if URL responds with an image content-type. */
export async function probeImage(url: string): Promise<boolean> {
  try {
    const resp = await fetchWithTimeout(url, { method: 'HEAD', headers: DEFAULT_HEADERS }, PROBE_TIMEOUT_MS);
    const ct = (resp.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
    return ct.startsWith('image/');
  } catch {
    return false;
  }
}

/** Best single logo URL for a site (absolute). null on failure. Probes the apple-touch
 *  default paths over the network like extract_logo_url. */
export async function extractLogoUrl(website: string): Promise<string | null> {
  const parsed = await fetchAndParse(website);
  if (!parsed) return null;
  const { finalUrl, head } = parsed;

  const ld = logoFromJsonLd(head.jsonLdPayloads);
  if (ld) return resolveUrl(finalUrl, ld);
  const apple = largest(head.appleIcons);
  if (apple) return resolveUrl(finalUrl, apple);
  const origin = originOf(finalUrl);
  for (const path of ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png']) {
    const cand = `${origin}${path}`;
    if (await probeImage(cand)) return cand;
  }
  let bestKey: number | null = null;
  let bestVal: string | null = null;
  for (const [k, v] of head.icons) {
    if (k !== null && (bestKey === null || k > bestKey)) {
      bestKey = k;
      bestVal = v;
    }
  }
  if (bestVal) return resolveUrl(finalUrl, bestVal);
  if (head.imageSrc) return resolveUrl(finalUrl, head.imageSrc);
  if (head.ogImage) return resolveUrl(finalUrl, head.ogImage);
  const icon = largest(head.icons);
  if (icon) return resolveUrl(finalUrl, icon);
  return `${origin}/favicon.ico`;
}

/** (bytes, content_type) or null. Rejects images over IMAGE_BYTES_CAP (never
 *  truncates — a partial image is corrupt but still header-sniffable, so it would
 *  be stored and served as a broken tile instead of falling back to initials).
 *  Accepts any image/* by header; otherwise sniffs the bytes (servers mislabel
 *  favicons as octet-stream / text/plain). */
export async function fetchImage(url: string): Promise<[Uint8Array, string] | null> {
  let resp: Response;
  try {
    resp = await fetchWithTimeout(url, { headers: DEFAULT_HEADERS }, TIMEOUT_MS);
  } catch {
    return null;
  }
  if (!resp.ok) return null;
  // Skip the download when the server advertises an oversized payload.
  const declared = Number(resp.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > IMAGE_BYTES_CAP) return null;
  let raw: Uint8Array;
  try {
    raw = new Uint8Array(await resp.arrayBuffer());
  } catch {
    return null;
  }
  if (raw.length > IMAGE_BYTES_CAP) return null; // oversize -> reject, don't truncate
  let ct = (resp.headers.get('content-type') ?? '').split(';')[0]!.trim().toLowerCase();
  if (!ct.startsWith('image/')) {
    const sniffed = sniffImageCt(raw);
    if (!sniffed) return null;
    ct = sniffed;
  }
  return [raw, ct];
}

/** Cap the longest side to `cap`px and re-encode to WEBP. In Python this uses Pillow;
 *  Node has no stdlib image codec and heavy deps (sharp) are out of scope, so this is a
 *  faithful-intent passthrough: SVG and byte payloads return unchanged. TODO: wire an
 *  optional image resizer on the enrich lambda if source-image weight becomes a problem
 *  (entity logos render at <=64px). Never blocks enrichment. */
export function downscale(raw: Uint8Array, ct: string, _cap = 256): [Uint8Array, string] {
  return [raw, ct];
}
