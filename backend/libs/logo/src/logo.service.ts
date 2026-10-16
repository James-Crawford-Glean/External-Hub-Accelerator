// Logo enrichment — domain-keyed crawl -> extract -> classify -> store -> cache.
// Ports lib/logo_cache.py (S3 store + ranked manifest), lib/logo_sources.py (the
// multi-source resolve chain), and the enrichment_cache slice of lib/cache.py (DDB
// stale-while-revalidate). The pure crawl/parse/rank/sniff logic lives in ./logo.extract.
//
// Cache key is the normalized domain (e.g. "glean.com"); the S3 object key is
// sha256-truncated so the URL reveals nothing about which domain it belongs to.
// Logos live as `logos/dom_<sha>.<ext>` in the SPA bucket (LOGO_BUCKET_NAME); CloudFront's
// default behavior serves them. A domain is fetched once per 30-day TTL window.
import { Logger } from '@libs/log';
import { createHash } from 'node:crypto';
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient, GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb';
import { normalizeDomain, websiteHost } from '@libs/urls';
import {
  classify,
  downscale,
  extractLogoCandidates,
  extractLogoUrl,
  fetchImage,
  rankVariants,
  sniffDimensions,
  KIND_ICON,
  type LogoCandidate,
} from './logo.extract';

export const LOGOS_KEY_PREFIX = 'logos'; // all logo objects live under this prefix in the SPA bucket
const CACHE_CONTROL = 'public, max-age=2592000'; // 30d browser/edge cache; CloudFront picks this up

// enrichment_cache SWR window (lib/cache.py: enrichment_cache.logo = 30d).
const LOGO_TTL_S = 2_592_000;
const STALE_MULTIPLIER = 4;
export const FRESH = 'fresh';
export const STALE = 'stale';
export const MISS = 'miss';
export type CacheStatus = typeof FRESH | typeof STALE | typeof MISS;

const FETCH_CAP = 6; // distinct images stored per domain
const ATTEMPT_CAP = 8; // candidate URLs tried (some 404/redirect)

const EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/avif': 'avif',
  'image/svg+xml': 'svg',
  'image/x-icon': 'ico',
  'image/vnd.microsoft.icon': 'ico',
};

function extFor(ct: string): string {
  return EXT[ct] || ct.split('/').pop()!.split('+')[0]! || 'img';
}

const sha = (buf: Uint8Array | string, n: number): string =>
  createHash('sha256')
    .update(typeof buf === 'string' ? Buffer.from(buf) : Buffer.from(buf))
    .digest('hex')
    .slice(0, n);

export interface LogoVariant {
  url: string;
  kind: string;
  width: number | null;
  height: number | null;
  format: string;
}

export interface LogoManifest {
  domain: string;
  cdn_url: string; // back-compat: getLogo returns this
  logoUrl: string;
  iconUrl: string;
  quality: 'icon' | 'logo';
  variants: LogoVariant[];
  // permit use through the Record<string, unknown> DDB-cache boundary
  [key: string]: unknown;
}

// Negative sentinel cached on extraction failure — without it every failing domain is
// re-fetched live on every page load. Caching the miss means one retry per TTL window.
const MISS_SENTINEL: { cdn_url: null } = { cdn_url: null };

const MIN_BYTES = 100; // skip 1x1 / empty placeholders some favicon services return

export class LogoService {
  private readonly log = new Logger(LogoService.name);
  private s3Client: S3Client | null = null;
  private ddbDoc: DynamoDBDocumentClient | null = null;

  // Env is read lazily so the module loads without these vars set (tests, cold import).
  private s3(): S3Client {
    return (this.s3Client ??= new S3Client({}));
  }
  private ddb(): DynamoDBDocumentClient {
    return (this.ddbDoc ??= DynamoDBDocumentClient.from(new DynamoDBClient({})));
  }
  private bucket(): string {
    const b = process.env.LOGO_BUCKET_NAME;
    if (!b) throw new Error('LOGO_BUCKET_NAME is required');
    return b;
  }
  private ddbTable(): string {
    const prefix = process.env.DDB_TABLE_PREFIX ?? 'portal-local';
    return `${prefix}-enrichment_cache`;
  }
  private hunterUrl(): string {
    // Hunter's free logo service — a real logo for most domains, 404 (clean miss) for
    // unknown ones. Blank the env to disable.
    return (process.env.LOGO_HUNTER_URL ?? 'https://logos.hunter.io/{domain}').trim();
  }

  /** example.com from any URL-ish value; shared with the matcher via @libs/urls. */
  normalizeDomain(value: string | null | undefined): string {
    return normalizeDomain(value);
  }

  /** Display host for a website field (keeps www.) — re-exported for callers. */
  websiteHost(value: string | null | undefined): string {
    return websiteHost(value);
  }

  // S3 keys ------------------------------------------------------------------

  private s3Key(domain: string, ct: string): string {
    // `logos/dom_<sha16>.<ext>`
    return `${LOGOS_KEY_PREFIX}/dom_${sha(domain, 16)}.${extFor(ct)}`;
  }

  private variantKey(domain: string, raw: Uint8Array, ct: string): string {
    // `logos/dom_<sha16(domain)>_<sha8(bytes)>.<ext>` — content-hashed so a domain's
    // variants coexist and identical bytes collapse to one object.
    return `${LOGOS_KEY_PREFIX}/dom_${sha(domain, 16)}_${sha(raw, 8)}.${extFor(ct)}`;
  }

  /** Put logo bytes into the SPA bucket under logos/<sha>.<ext>; return the CDN URL (or
   *  null on S3 failure). Shared by the request-path cache and the async enrich job. */
  async storeImage(domain: string, bytes: Uint8Array, ct: string): Promise<string | null> {
    return this.put(this.s3Key(domain, ct), bytes, ct, domain);
  }

  /** Put one variant under its content-hashed key; return the CDN URL. */
  async storeVariant(domain: string, raw: Uint8Array, ct: string): Promise<string | null> {
    return this.put(this.variantKey(domain, raw, ct), raw, ct, domain);
  }

  private async put(key: string, body: Uint8Array, ct: string, domain: string): Promise<string | null> {
    try {
      await this.s3().send(
        new PutObjectCommand({
          Bucket: this.bucket(),
          Key: key,
          Body: body,
          ContentType: ct,
          CacheControl: CACHE_CONTROL,
        }),
      );
    } catch (e) {
      this.log.error(`logo.s3_put_failed domain=${domain} key=${key} err=${String(e)}`);
      return null;
    }
    return `/${key}`; // origin-relative (/logos/dom_<sha>.<ext>) so the same DB value renders on any env host
  }

  // multi-variant manifest ---------------------------------------------------

  /** Crawl every candidate, classify + store the distinct ones, rank into a manifest.
   *  Returns MISS_SENTINEL when nothing fetchable. Mirrors build_manifest. */
  async buildManifest(domain: string): Promise<LogoManifest | { cdn_url: null }> {
    const candidates = (await extractLogoCandidates(domain)).slice(0, ATTEMPT_CAP);
    const variants: Array<LogoVariant & { source: string; declared_size: number | null }> = [];
    const seenHashes = new Set<string>();

    for (const cand of candidates) {
      if (variants.length >= FETCH_CAP) break;
      const fetched = await fetchImage(cand.url);
      if (!fetched) continue;
      let [raw, ct] = fetched;
      [raw, ct] = downscale(raw, ct); // dimension cap + re-encode (see logo.extract TODO)
      const h = sha(raw, 8);
      if (seenHashes.has(h)) continue;
      seenHashes.add(h);
      const dims = sniffDimensions(raw, ct);
      const [w, ht] = dims ?? [null, null];
      const url = await this.storeVariant(domain, raw, ct);
      if (!url) continue;
      variants.push({
        url,
        source: cand.source,
        declared_size: cand.declared_size,
        width: w,
        height: ht,
        format: extFor(ct),
        kind: classify(cand.source, ct, w ?? cand.declared_size, ht ?? cand.declared_size),
      });
    }
    if (!variants.length) return MISS_SENTINEL;

    const ranked = rankVariants(variants, 'logo');
    const bestLogo = ranked[0]!;
    const bestIcon = rankVariants(variants, 'icon')[0]!;

    return {
      domain,
      cdn_url: bestLogo.url,
      logoUrl: bestLogo.url,
      iconUrl: bestIcon.url,
      quality: bestLogo.kind === KIND_ICON ? 'icon' : 'logo',
      variants: ranked.map((v) => ({
        url: v.url,
        kind: v.kind,
        width: v.width,
        height: v.height,
        format: v.format,
      })),
    };
  }

  /** Cached ranked manifest for a domain (variants + logoUrl + iconUrl), or null. */
  async getLogoManifest(domain: string | null | undefined): Promise<LogoManifest | null> {
    const d = normalizeDomain(domain);
    if (!d) return null;
    const [data, status] = await this.cachedGet(`domain#${d}`, () => this.buildManifest(d));
    this.log.log(`logo.manifest domain=${d} status=${status}`);
    return data && (data as LogoManifest).logoUrl ? (data as LogoManifest) : null;
  }

  /** Best (primary) logo CDN URL for a domain, or null. */
  async getLogo(domain: string | null | undefined): Promise<string | null> {
    const m = await this.getLogoManifest(domain);
    return m ? m.logoUrl : null;
  }

  /** Peek the domain-keyed manifest cache WITHOUT crawling on a miss (unlike
   *  getLogoManifest, which builds+downloads). The enrich worker uses this to relink an
   *  already-built manifest — whose variant URLs still point at existing S3 objects —
   *  instead of re-fetching. Returns a cached manifest at any age (stale is fine: the S3
   *  objects persist), or null when the domain was never cached. */
  async getCachedManifest(domain: string | null | undefined): Promise<LogoManifest | null> {
    const d = normalizeDomain(domain);
    if (!d) return null;
    const row = await this.readCache(`domain#${d}`);
    if (!row) return null;
    const data = this.decode(row['data']);
    return data && (data as LogoManifest).logoUrl ? (data as LogoManifest) : null;
  }

  // multi-source resolve (async enrich job) ----------------------------------

  /** Try sources in quality order, return the first usable (bytes, content_type): site
   *  scrape -> Hunter's logo service -> the site's own favicon. Each source is guarded so
   *  one slow/failing source never blocks the others. Mirrors logo_sources.resolve. */
  async resolveSource(domain: string): Promise<[Uint8Array, string] | null> {
    const sources: Array<[string, () => Promise<[Uint8Array, string] | null>]> = [
      ['scrape', () => this.fromScrape(domain)],
      ['hunter', () => this.fromHunter(domain)],
      ['favicon', () => this.fromFavicon(domain)],
    ];
    for (const [name, source] of sources) {
      let img: [Uint8Array, string] | null = null;
      try {
        img = await source();
      } catch (e) {
        this.log.log(`logo_source.error src=${name} domain=${domain} err=${String(e)}`);
        continue;
      }
      if (img && img[0].length >= MIN_BYTES) {
        this.log.log(`logo_source.hit src=${name} domain=${domain} bytes=${img[0].length}`);
        return img;
      }
    }
    return null;
  }

  private async fromScrape(domain: string): Promise<[Uint8Array, string] | null> {
    const url = await extractLogoUrl(domain);
    return url ? fetchImage(url) : null;
  }

  private async fromHunter(domain: string): Promise<[Uint8Array, string] | null> {
    const tpl = this.hunterUrl();
    if (!tpl) return null;
    return fetchImage(tpl.replace('{domain}', domain));
  }

  private async fromFavicon(domain: string): Promise<[Uint8Array, string] | null> {
    // Deliberately the domain's OWN icon — no third-party favicon proxies (Google s2 /
    // DuckDuckGo): re-hosting their output is a TOS grey area.
    for (const path of ['/apple-touch-icon.png', '/apple-touch-icon-precomposed.png', '/favicon.ico']) {
      const img = await fetchImage(`https://${domain}${path}`);
      if (img && img[0].length >= MIN_BYTES) return img;
    }
    return null;
  }

  // DDB stale-while-revalidate (enrichment_cache.logo facet) ------------------

  /** Read-through cache over enrichment_cache with the logo facet's 30d TTL. Returns
   *  [data, status]. First miss blocks on the loader; within the stale window returns
   *  cached data (async refresh is a no-op here — the enrich job repopulates). */
  private async cachedGet(
    itemId: string,
    loader: () => Promise<Record<string, unknown> | { cdn_url: null } | null>,
  ): Promise<[Record<string, unknown> | null, CacheStatus]> {
    const now = Math.floor(Date.now() / 1000);
    const row = await this.readCache(itemId);
    if (row) {
      const age = now - Number(row['cached_at'] ?? 0);
      const cached = this.decode(row['data']);
      if (age <= LOGO_TTL_S) return [cached, FRESH];
      if (age <= LOGO_TTL_S * STALE_MULTIPLIER) return [cached, STALE];
    }
    const data = await loader();
    if (data !== null) await this.writeCache(itemId, data, now);
    return [(data as Record<string, unknown>) ?? null, MISS];
  }

  private decode(raw: unknown): Record<string, unknown> | null {
    // `data` is stored as a JSON string (see writeCache); parse it back.
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return (raw as Record<string, unknown>) ?? null;
  }

  private async readCache(itemId: string): Promise<Record<string, unknown> | null> {
    try {
      const resp = await this.ddb().send(
        new GetCommand({ TableName: this.ddbTable(), Key: { id: itemId, facet: 'logo' } }),
      );
      return (resp.Item as Record<string, unknown>) ?? null;
    } catch (e) {
      this.log.error(`cache.read_error id=${itemId} err=${String(e)}`);
      return null;
    }
  }

  private async writeCache(itemId: string, data: unknown, cachedAt: number): Promise<void> {
    try {
      await this.ddb().send(
        new PutCommand({
          TableName: this.ddbTable(),
          Item: {
            id: itemId,
            facet: 'logo',
            // JSON string, not a map: the DynamoDB document client rejects some shapes
            // (floats), and a string round-trips cleanly.
            data: JSON.stringify(data),
            cached_at: cachedAt,
            expires_at: cachedAt + LOGO_TTL_S * STALE_MULTIPLIER,
          },
        }),
      );
    } catch (e) {
      this.log.error(`cache.write_error id=${itemId} err=${String(e)}`);
    }
  }
}

export type { LogoCandidate };
