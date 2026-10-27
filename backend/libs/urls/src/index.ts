// URL / host normalization — the single source for turning any dirty URL-ish value
// (`https://www.x.com/`, the colon-less `https//www.x.com`, protocol-relative `//x.com`,
// or a bare `x.com`) into a clean host. The logo service uses it so a scheme is never
// doubled and the logo cache key is never garbage; any code that stores a website
// should normalize through it too.
// Pure — no dependencies, safe to import from any layer.

// Leading scheme in any form: 'https://', the malformed colon-less 'https//', or a
// bare protocol-relative '//'. Requires the '//' (or ':') so a bare 'www.x.com' — where
// '.' is a legal host char — is never mistaken for a scheme and eaten.
const SCHEME_RE = /^\s*(?:[a-z][a-z0-9+.-]*:?\/\/|\/\/)/i;

/** Bare host from any URL-ish value: strips the scheme (incl. malformed forms),
 *  path/query/fragment, lowercases, and trims trailing dots. Keeps `www.`. */
export function host(raw: string | null | undefined): string {
  if (!raw) return '';
  const stripped = raw.trim().toLowerCase().replace(SCHEME_RE, '');
  const hostPart = stripped.split(/[/?#]/, 1)[0] ?? '';
  return hostPart.replace(/\.+$/, '');
}

/** Display host for the `website` field (keeps `www.`), e.g. www.360insights.com. */
export function websiteHost(raw: string | null | undefined): string {
  return host(raw);
}

/** Match/logo key: host without the `www.` prefix, e.g. 360insights.com. */
export function normalizeDomain(raw: string | null | undefined): string {
  const h = host(raw);
  return h.startsWith('www.') ? h.slice(4) : h;
}

/** Disambiguation key that KEEPS the path: normalized host (www-stripped) + the
 *  lowercased path, minus scheme/query/fragment and any trailing slash. This is the
 *  signal that tells a regional sub-site from the global site — e.g.
 *  urlPathKey('https://www.accenture.com/nz-en/') === 'accenture.com/nz-en' while
 *  urlPathKey('www.accenture.com') === 'accenture.com'. Returns '' for nullish. */
export function urlPathKey(raw: string | null | undefined): string {
  if (!raw) return '';
  const h = normalizeDomain(raw);
  if (!h) return '';
  const afterScheme = raw.trim().toLowerCase().replace(SCHEME_RE, '');
  const rawHost = afterScheme.split(/[/?#]/, 1)[0] ?? '';
  const rest = afterScheme.slice(rawHost.length); // '/path?query#frag' or ''
  const path = (rest.split(/[?#]/, 1)[0] ?? '').replace(/\/+$/, '');
  return h + path;
}
