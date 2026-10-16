// Authenticated logo lookup for external Action/tool callers: look a domain up in
// the logo cache, pick a variant, and hand back metadata or a redirect. Ranking is
// not re-derived here; it reuses @libs/logo so stored manifests and this route agree
// on "best". Every URL is re-validated against the configured CDN origin because
// the stored value is only a path.
import type { AuthzService, Identity } from '@libs/authz';
import { areaOf, rankVariants, KIND_ICON, type LogoService } from '@libs/logo';

export type LogoVariantMode = 'auto' | 'large' | 'small';
type LogoResponseMode = 'metadata' | 'image';

export interface LogoVariant {
  readonly url: string;
  readonly kind: string;
  readonly width: number | null;
  readonly height: number | null;
  readonly format: string;
}

interface LogoRouteResponse {
  readonly statusCode: number;
  readonly headers: Record<string, string>;
  readonly body: string;
}

export interface LogoCandidate {
  readonly domain: string;
  readonly logoUrl: string | null;
  readonly logoIconUrl: string | null;
  readonly variants: readonly LogoVariant[];
}

interface LogoRouteDependencies {
  readonly logos: Pick<LogoService, 'getLogoManifest'>;
  readonly authz: Pick<AuthzService, 'requireRead'>;
  readonly cdnOrigin: string;
}

const JSON_HEADERS = { 'content-type': 'application/json' } as const;
const VARIANT_MODES: readonly LogoVariantMode[] = ['auto', 'large', 'small'];
const RESPONSE_MODES: readonly LogoResponseMode[] = ['metadata', 'image'];

const json = (statusCode: number, payload: unknown): LogoRouteResponse => ({
  statusCode,
  headers: { ...JSON_HEADERS },
  body: JSON.stringify(payload),
});

const isIcon = (variant: LogoVariant): boolean => variant.kind === KIND_ICON;

const bestFor = (variants: readonly LogoVariant[], goal: 'logo' | 'icon'): LogoVariant | null =>
  rankVariants(variants, goal)[0] ?? null;

const byAreaDesc = (variants: readonly LogoVariant[]): LogoVariant | null =>
  variants.toSorted((a, b) => areaOf(b) - areaOf(a))[0] ?? null;

function originUrl(origin: string): URL | null {
  try {
    const parsed = new URL(origin);
    return parsed.protocol === 'https:' && parsed.pathname === '/' && !parsed.search && !parsed.hash ? parsed : null;
  } catch {
    return null;
  }
}

function safeLogoUrl(value: unknown, origin: URL): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value, origin);
    if (url.origin !== origin.origin || !url.pathname.startsWith('/logos/') || url.search || url.hash) return null;
    return url.href;
  } catch {
    return null;
  }
}

function positiveInteger(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 ? value : null;
}

function variantsOf(value: unknown, origin: URL): LogoVariant[] {
  const parsed =
    typeof value === 'string'
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            return [];
          }
        })()
      : value;
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item): LogoVariant[] => {
    if (!item || typeof item !== 'object') return [];
    const row = item as Record<string, unknown>;
    const url = safeLogoUrl(row.url, origin);
    if (!url) return [];
    return [
      {
        url,
        kind: typeof row.kind === 'string' ? row.kind : 'unknown',
        width: positiveInteger(row.width),
        height: positiveInteger(row.height),
        format: typeof row.format === 'string' ? row.format : 'unknown',
      },
    ];
  });
}

function candidateOf(domain: string, value: Record<string, unknown>, origin: URL): LogoCandidate {
  return {
    domain,
    logoUrl: safeLogoUrl(value.logoUrl, origin),
    logoIconUrl: safeLogoUrl(value.iconUrl, origin),
    variants: variantsOf(value.variants, origin),
  };
}

const DOMAIN_RE = /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i;

function fallbackVariant(url: string | null, kind: string): LogoVariant | null {
  return url ? { url, kind, width: null, height: null, format: 'unknown' } : null;
}

export function selectLogoVariant(candidate: LogoCandidate, mode: LogoVariantMode): LogoVariant | null {
  const logo = fallbackVariant(candidate.logoUrl, 'mark');
  const icon = fallbackVariant(candidate.logoIconUrl, KIND_ICON);

  // `large` means most pixels, so it sorts on area alone; `small`/`auto` defer to the
  // shared kind-then-area ranking that produced the stored logoUrl / logoIconUrl.
  if (mode === 'small') return icon ?? bestFor(candidate.variants, 'icon') ?? logo;
  if (mode === 'large') {
    const nonIcons = candidate.variants.filter((variant) => !isIcon(variant));
    return byAreaDesc(nonIcons) ?? byAreaDesc(candidate.variants) ?? logo ?? icon;
  }
  return logo ?? bestFor(candidate.variants, 'logo') ?? icon;
}

function parseMode(params: URLSearchParams): LogoVariantMode | null {
  const value = params.get('variant') ?? 'auto';
  return VARIANT_MODES.includes(value as LogoVariantMode) ? (value as LogoVariantMode) : null;
}

function parseResponseMode(params: URLSearchParams): LogoResponseMode | null {
  const value = params.get('response') ?? 'metadata';
  return RESPONSE_MODES.includes(value as LogoResponseMode) ? (value as LogoResponseMode) : null;
}

export async function handleLogoRequest(
  params: URLSearchParams,
  identity: Identity,
  deps: LogoRouteDependencies,
): Promise<LogoRouteResponse> {
  try {
    deps.authz.requireRead(identity);
  } catch {
    return json(403, { error: 'forbidden', message: 'A read-capable credential is required' });
  }

  const domain = params.get('domain')?.trim().toLowerCase().replace(/^www\./, '') ?? '';
  if (!domain || !DOMAIN_RE.test(domain)) return json(400, { error: 'invalid_request', message: 'domain is required' });

  const mode = parseMode(params);
  if (!mode) return json(400, { error: 'invalid_request', message: 'variant must be auto, large, or small' });

  const responseMode = parseResponseMode(params);
  if (!responseMode) return json(400, { error: 'invalid_request', message: 'response must be metadata or image' });

  const origin = originUrl(deps.cdnOrigin);
  if (!origin) return json(500, { error: 'internal_error', message: 'Logo CDN origin is not configured' });

  const manifest = await deps.logos.getLogoManifest(domain);
  const candidate = manifest ? candidateOf(domain, manifest as unknown as Record<string, unknown>, origin) : null;
  const selected = candidate ? selectLogoVariant(candidate, mode) : null;
  if (!candidate || !selected)
    return json(404, { error: 'logo_not_found', message: 'No logo was found for the requested domain' });

  if (responseMode === 'image') {
    return {
      statusCode: 302,
      headers: { location: selected.url, 'cache-control': 'no-store' },
      body: '',
    };
  }

  return json(200, {
    domain: candidate.domain,
    selectedVariant: selected,
    logoUrl: candidate.logoUrl,
    logoIconUrl: candidate.logoIconUrl,
    downloadUrl: selected.url,
    variants: candidate.variants,
  });
}
