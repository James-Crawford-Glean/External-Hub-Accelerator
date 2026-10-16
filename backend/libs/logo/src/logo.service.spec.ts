// @libs/urls has no jest moduleNameMapper entry yet (config is owned elsewhere), so we
// mock it here with the same pure implementation the real module exports.
jest.mock(
  '@libs/urls',
  () => ({
    host: (r: string | null | undefined) =>
      !r ? '' : (r.trim().toLowerCase().replace(/^\s*(?:[a-z][a-z0-9+.-]*:?\/\/|\/\/)/i, '').split(/[/?#]/, 1)[0] ?? '').replace(/\.+$/, ''),
    websiteHost: (r: string | null | undefined) =>
      !r ? '' : (r.trim().toLowerCase().replace(/^\s*(?:[a-z][a-z0-9+.-]*:?\/\/|\/\/)/i, '').split(/[/?#]/, 1)[0] ?? '').replace(/\.+$/, ''),
    normalizeDomain: (r: string | null | undefined) => {
      const h = !r ? '' : (r.trim().toLowerCase().replace(/^\s*(?:[a-z][a-z0-9+.-]*:?\/\/|\/\/)/i, '').split(/[/?#]/, 1)[0] ?? '').replace(/\.+$/, '');
      return h.startsWith('www.') ? h.slice(4) : h;
    },
  }),
  { virtual: true },
);

import {
  candidatesFromHead,
  classify,
  logoFromJsonLd,
  parseHead,
  sniffDimensions,
  sniffImageCt,
  largest,
  resolveUrl,
  KIND_ICON,
  KIND_MARK,
  KIND_WORDMARK,
  KIND_BANNER,
  SOURCE_JSONLD,
  SOURCE_APPLE,
  SOURCE_FAVICON,
  SOURCE_OG,
} from './logo.extract';
import { LogoService, LOGOS_KEY_PREFIX } from './logo.service';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';

// pure extraction ------------------------------------------------------------

describe('parseHead + candidatesFromHead (source ranking)', () => {
  const html = `<!doctype html><html><head>
    <script type="application/ld+json">{"@type":"Organization","logo":"/brand.png"}</script>
    <link rel="apple-touch-icon" sizes="120x120" href="/at-120.png">
    <link rel="apple-touch-icon" sizes="180x180" href="/at-180.png">
    <link rel="icon" sizes="32x32" href="/fav-32.png">
    <link rel="image_src" href="/share.png">
    <meta property="og:image" content="https://cdn.example.com/og.jpg">
  </head><body>ignored <link rel="icon" href="/should-not-see.png"></body></html>`;

  it('discovers candidates in priority order, deduped, absolute', () => {
    const head = parseHead(html);
    const cands = candidatesFromHead('https://example.com/', head);
    const bySource = cands.map((c) => c.source);
    // jsonld first, then apple (declared + probed defaults), then link-icon, image_src, og, favicon
    expect(bySource[0]).toBe(SOURCE_JSONLD);
    expect(bySource).toContain(SOURCE_APPLE);
    expect(bySource).toContain(SOURCE_FAVICON);
    expect(bySource).toContain(SOURCE_OG);
    // JSON-LD logo resolved to absolute
    expect(cands[0]!.url).toBe('https://example.com/brand.png');
    // og:image kept absolute as-is
    expect(cands.find((c) => c.source === SOURCE_OG)!.url).toBe('https://cdn.example.com/og.jpg');
    // apple declared sizes captured
    const apple = cands.filter((c) => c.source === SOURCE_APPLE);
    expect(apple.map((c) => c.declared_size)).toEqual(expect.arrayContaining([120, 180, null]));
  });

  it('ignores markup after </head>', () => {
    const head = parseHead(html);
    const cands = candidatesFromHead('https://example.com/', head);
    expect(cands.some((c) => c.url.includes('should-not-see'))).toBe(false);
  });

  it('always appends /favicon.ico under the origin', () => {
    const head = parseHead('<head></head>');
    const cands = candidatesFromHead('https://example.com/path', head);
    expect(cands.some((c) => c.url === 'https://example.com/favicon.ico')).toBe(true);
  });
});

describe('logoFromJsonLd', () => {
  it('finds Organization.logo as a string', () => {
    expect(logoFromJsonLd(['{"@type":"Organization","logo":"/x.png"}'])).toBe('/x.png');
  });
  it('finds logo via @graph and object form (url/contentUrl)', () => {
    const p = ['{"@graph":[{"@type":"WebSite","logo":{"url":"/g.png"}}]}'];
    expect(logoFromJsonLd(p)).toBe('/g.png');
  });
  it('handles @type arrays and ignores non-org types', () => {
    expect(logoFromJsonLd(['{"@type":["Thing","Corporation"],"logo":"/c.png"}'])).toBe('/c.png');
    expect(logoFromJsonLd(['{"@type":"Article","logo":"/no.png"}'])).toBeNull();
  });
  it('skips invalid JSON', () => {
    expect(logoFromJsonLd(['{not json'])).toBeNull();
  });
});

describe('largest', () => {
  it('picks the largest sized entry, else any unsized', () => {
    expect(largest(new Map([[32, 'a'], [180, 'b'], [null, 'c']]))).toBe('b');
    expect(largest(new Map([[null, 'only']]))).toBe('only');
    expect(largest(new Map())).toBeNull();
  });
});

describe('resolveUrl', () => {
  it('resolves relative against the final URL', () => {
    expect(resolveUrl('https://x.com/a/b', '/logo.png')).toBe('https://x.com/logo.png');
    expect(resolveUrl('https://x.com/', 'https://cdn.x.com/l.png')).toBe('https://cdn.x.com/l.png');
  });
});

describe('sniffImageCt', () => {
  const bytes = (arr: number[]) => new Uint8Array(arr);
  it('detects PNG / JPEG / GIF / ICO / BMP magic', () => {
    expect(sniffImageCt(bytes([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(sniffImageCt(bytes([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImageCt(bytes([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif');
    expect(sniffImageCt(bytes([0x00, 0x00, 0x01, 0x00]))).toBe('image/x-icon');
    expect(sniffImageCt(bytes([0x42, 0x4d, 0x00]))).toBe('image/bmp');
  });
  it('detects RIFF/WEBP and SVG text', () => {
    const webp = new Uint8Array(16);
    webp.set([0x52, 0x49, 0x46, 0x46], 0); // RIFF
    webp.set([0x57, 0x45, 0x42, 0x50], 8); // WEBP
    expect(sniffImageCt(webp)).toBe('image/webp');
    expect(sniffImageCt(new TextEncoder().encode('  <svg xmlns="...">'))).toBe('image/svg+xml');
  });
  it('returns null for non-images', () => {
    expect(sniffImageCt(new TextEncoder().encode('hello world'))).toBeNull();
  });
});

describe('sniffDimensions', () => {
  it('reads PNG IHDR width/height', () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    // width=256 (0x100) at 16, height=64 (0x40) at 20, big-endian
    png.set([0x00, 0x00, 0x01, 0x00], 16);
    png.set([0x00, 0x00, 0x00, 0x40], 20);
    expect(sniffDimensions(png, 'image/png')).toEqual([256, 64]);
  });
  it('reads GIF little-endian dims', () => {
    const gif = new Uint8Array(10);
    gif.set([0x47, 0x49, 0x46, 0x38, 0x39, 0x61], 0);
    gif.set([0x20, 0x00, 0x10, 0x00], 6); // 32 x 16
    expect(sniffDimensions(gif, 'image/gif')).toEqual([32, 16]);
  });
  it('reads ICO first-dir-entry dims (0 => 256)', () => {
    const ico = new Uint8Array(8);
    ico.set([0x00, 0x00, 0x01, 0x00], 0);
    ico[6] = 0; // width 0 -> 256
    ico[7] = 48;
    expect(sniffDimensions(ico, 'image/x-icon')).toEqual([256, 48]);
  });
  it('reads SVG viewBox', () => {
    const svg = new TextEncoder().encode('<svg viewBox="0 0 200 100"></svg>');
    expect(sniffDimensions(svg, 'image/svg+xml')).toEqual([200, 100]);
  });
  it('returns null on truncated/unknown', () => {
    expect(sniffDimensions(new Uint8Array([1, 2, 3]), 'image/unknown')).toBeNull();
  });
});

describe('classify', () => {
  it('ICO content-type is always icon', () => {
    expect(classify(SOURCE_FAVICON, 'image/x-icon', 512, 512)).toBe(KIND_ICON);
  });
  it('uses dimensions: square small=icon, square large=mark, wide=wordmark, very wide=banner', () => {
    expect(classify(SOURCE_APPLE, 'image/png', 64, 64)).toBe(KIND_ICON);
    expect(classify(SOURCE_MARK_PNG(), 'image/png', 512, 512)).toBe(KIND_MARK);
    expect(classify(SOURCE_APPLE, 'image/png', 400, 200)).toBe(KIND_WORDMARK);
    expect(classify(SOURCE_APPLE, 'image/png', 1200, 200)).toBe(KIND_BANNER);
  });
  it('og:image with a ~1.91:1 ratio is a banner', () => {
    expect(classify(SOURCE_OG, 'image/jpeg', 1200, 630)).toBe(KIND_BANNER);
  });
  it('falls back to source when dimensions unknown', () => {
    expect(classify(SOURCE_FAVICON, 'image/png', null, null)).toBe(KIND_ICON);
    expect(classify(SOURCE_JSONLD, 'image/png', null, null)).toBe(KIND_MARK);
    expect(classify(SOURCE_OG, 'image/png', null, null)).toBe(KIND_BANNER);
  });
});
function SOURCE_MARK_PNG(): string {
  return 'link-icon'; // any non-og source; dims drive the verdict
}

// service: keys, ranking, cache -----------------------------------------------

interface Fakes {
  svc: LogoService;
  s3Send: jest.Mock;
  ddbSend: jest.Mock;
  puts: PutObjectCommand[];
}

function makeService(ddbGetItem?: Record<string, unknown> | null): Fakes {
  const puts: PutObjectCommand[] = [];
  const s3Send = jest.fn(async (cmd: unknown) => {
    if (cmd instanceof PutObjectCommand) puts.push(cmd);
    return {};
  });
  const ddbSend = jest.fn(async (cmd: unknown) => {
    if (cmd instanceof GetCommand) return { Item: ddbGetItem ?? undefined };
    return {};
  });
  const svc = new LogoService();
  // inject fakes into the lazy client slots
  (svc as unknown as { s3Client: unknown }).s3Client = { send: s3Send };
  (svc as unknown as { ddbDoc: unknown }).ddbDoc = { send: ddbSend };
  process.env.LOGO_BUCKET_NAME = 'spa-bucket';
  process.env.LOGO_CDN_URL_PREFIX = 'https://example.portal.example.com/';
  return { svc, s3Send, ddbSend, puts };
}

describe('LogoService S3 keys + storeImage', () => {
  it('storeImage builds a domain-hashed logos/ key and returns an origin-relative URL', async () => {
    const { svc, puts } = makeService();
    const url = await svc.storeImage('example.com', new Uint8Array([1, 2, 3]), 'image/png');
    expect(url).toMatch(/^\/logos\/dom_[0-9a-f]{16}\.png$/); // relative so it renders on any env host
    const cmd = puts[0]!.input;
    expect(cmd.Bucket).toBe('spa-bucket');
    expect(cmd.Key).toMatch(new RegExp(`^${LOGOS_KEY_PREFIX}/dom_[0-9a-f]{16}\\.png$`));
    expect(cmd.CacheControl).toBe('public, max-age=2592000');
  });

  it('storeVariant content-hashes the bytes so identical bytes collapse to one key', async () => {
    const { svc } = makeService();
    const a = await svc.storeVariant('example.com', new Uint8Array([1, 2, 3]), 'image/png');
    const b = await svc.storeVariant('example.com', new Uint8Array([1, 2, 3]), 'image/png');
    const c = await svc.storeVariant('example.com', new Uint8Array([9, 9, 9]), 'image/png');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(a).toMatch(/logos\/dom_[0-9a-f]{16}_[0-9a-f]{8}\.png$/);
  });

  it('derives an extension from the subtype for unmapped content-types', async () => {
    const { svc } = makeService();
    const url = await svc.storeImage('example.com', new Uint8Array([1]), 'image/svg+xml');
    expect(url!.endsWith('.svg')).toBe(true);
    const bmp = await svc.storeImage('example.com', new Uint8Array([1]), 'image/bmp');
    expect(bmp!.endsWith('.bmp')).toBe(true);
  });

  it('returns null when S3 put throws', async () => {
    const { svc } = makeService();
    (svc as unknown as { s3Client: { send: jest.Mock } }).s3Client.send = jest.fn().mockRejectedValue(new Error('boom'));
    expect(await svc.storeImage('example.com', new Uint8Array([1]), 'image/png')).toBeNull();
  });
});

describe('LogoService cache (SWR)', () => {
  it('FRESH: returns cached manifest without invoking the loader', async () => {
    const cachedManifest = { logoUrl: 'https://cdn/logos/dom_x.png', domain: 'example.com' };
    const now = Math.floor(Date.now() / 1000);
    const { svc, s3Send } = makeService({ data: JSON.stringify(cachedManifest), cached_at: now });
    const out = await svc.getLogoManifest('https://www.example.com/');
    expect(out!.logoUrl).toBe(cachedManifest.logoUrl);
    expect(s3Send).not.toHaveBeenCalled(); // no crawl on a fresh hit
  });

  it('normalizes the domain into the cache key (id=domain#<normalized>)', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { svc, ddbSend } = makeService({ data: JSON.stringify({ logoUrl: 'u' }), cached_at: now });
    await svc.getLogoManifest('WWW.Example.com');
    const getCmd = ddbSend.mock.calls.map((c) => c[0]).find((c) => c instanceof GetCommand) as GetCommand;
    expect(getCmd.input.Key).toEqual({ id: 'domain#example.com', facet: 'logo' });
  });

  it('returns null for an empty/nullish domain (no DDB call)', async () => {
    const { svc, ddbSend } = makeService();
    expect(await svc.getLogoManifest(null)).toBeNull();
    expect(await svc.getLogoManifest('')).toBeNull();
    expect(ddbSend).not.toHaveBeenCalled();
  });

  it('getLogo unwraps logoUrl from the manifest', async () => {
    const now = Math.floor(Date.now() / 1000);
    const { svc } = makeService({ data: JSON.stringify({ logoUrl: 'https://cdn/l.png' }), cached_at: now });
    expect(await svc.getLogo('example.com')).toBe('https://cdn/l.png');
  });

  it('miss + loader failure writes the negative sentinel and yields null (data has no logoUrl)', async () => {
    const { svc, ddbSend } = makeService(null);
    // no cached row; force buildManifest to the MISS sentinel by stubbing candidate extraction
    jest.spyOn(svc, 'buildManifest').mockResolvedValue({ cdn_url: null });
    const out = await svc.getLogoManifest('example.com');
    expect(out).toBeNull();
    // a PutCommand persists the miss so we don't refetch every request
    const putCmd = ddbSend.mock.calls.map((c) => c[0]).find((c) => c instanceof PutCommand) as PutCommand;
    expect(putCmd).toBeDefined();
    expect(JSON.parse(putCmd.input.Item!['data'] as string)).toEqual({ cdn_url: null });
    expect(putCmd.input.Item!['facet']).toBe('logo');
  });
});

describe('LogoService.buildManifest ranking', () => {
  it('ranks a square mark above a favicon for logoUrl and the favicon top for iconUrl', async () => {
    const { svc } = makeService();
    // three candidates: a big square mark, a wide banner (og), and a tiny favicon
    const mark = new Uint8Array(24);
    mark.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    mark.set([0x00, 0x00, 0x02, 0x00], 16); // 512 w
    mark.set([0x00, 0x00, 0x02, 0x00], 20); // 512 h
    const fav = new Uint8Array([0x00, 0x00, 0x01, 0x00, 0, 0, 32, 32]); // ICO 32x32
    const banner = new Uint8Array(24);
    banner.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], 0);
    banner.set([0x00, 0x00, 0x04, 0xb0], 16); // 1200 w
    banner.set([0x00, 0x00, 0x02, 0x76], 20); // 630 h

    const extract = require('./logo.extract');
    jest.spyOn(extract, 'extractLogoCandidates').mockResolvedValue([
      { url: 'https://example.com/mark.png', source: SOURCE_JSONLD, declared_size: null },
      { url: 'https://example.com/og.png', source: SOURCE_OG, declared_size: null },
      { url: 'https://example.com/favicon.ico', source: SOURCE_FAVICON, declared_size: null },
    ]);
    jest.spyOn(extract, 'fetchImage').mockImplementation(async (url: unknown) => {
      if ((url as string).endsWith('mark.png')) return [mark, 'image/png'];
      if ((url as string).endsWith('og.png')) return [banner, 'image/png'];
      return [fav, 'image/x-icon'];
    });

    const m = (await svc.buildManifest('example.com')) as {
      logoUrl: string;
      iconUrl: string;
      quality: string;
      variants: unknown[];
    };
    // logoUrl -> the square mark (highest LOGO_RANK*area); iconUrl -> the favicon
    expect(m.logoUrl).toMatch(/dom_[0-9a-f]{16}_[0-9a-f]{8}\.png$/); // stored square mark
    expect(m.iconUrl).toMatch(/\.ico$/); // stored favicon
    expect(m.quality).toBe('logo');
    expect(m.variants.length).toBe(3);
  });

  it('returns the MISS sentinel when nothing is fetchable', async () => {
    const { svc } = makeService();
    const extract = require('./logo.extract');
    jest.spyOn(extract, 'extractLogoCandidates').mockResolvedValue([
      { url: 'https://example.com/x.png', source: SOURCE_FAVICON, declared_size: null },
    ]);
    jest.spyOn(extract, 'fetchImage').mockResolvedValue(null);
    expect(await svc.buildManifest('example.com')).toEqual({ cdn_url: null });
  });
});
