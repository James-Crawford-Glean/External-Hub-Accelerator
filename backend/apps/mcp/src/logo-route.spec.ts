import type { AuthzService, Identity } from '@libs/authz';
import { KIND_ICON, rankVariants } from '@libs/logo';
import type { LogoService } from '@libs/logo';
import { handleLogoRequest, selectLogoVariant, type LogoCandidate } from './logo-route';

const USER: Identity = { kind: 'user', sub: 'oauth-sub' };
const READ_KEY: Identity = { kind: 'apiKey', keyId: 'apk_read', scopes: 'read' };

const candidate: LogoCandidate = {
  domain: 'acme.example',
  logoUrl: 'https://example.portal.example.com/logos/dom_primary.png',
  logoIconUrl: 'https://example.portal.example.com/logos/dom_icon.ico',
  variants: [
    {
      url: 'https://example.portal.example.com/logos/dom_small.png',
      kind: 'mark',
      width: 128,
      height: 128,
      format: 'png',
    },
    {
      url: 'https://example.portal.example.com/logos/dom_large.png',
      kind: 'wordmark',
      width: 1024,
      height: 512,
      format: 'png',
    },
    {
      url: 'https://example.portal.example.com/logos/dom_icon.ico',
      kind: 'icon',
      width: 64,
      height: 64,
      format: 'ico',
    },
  ],
};

function deps(overrides: Partial<LogoCandidate> = {}) {
  const logos = {
    getLogoManifest: jest.fn(async () => ({
      logoUrl: overrides.logoUrl ?? candidate.logoUrl,
      iconUrl: overrides.logoIconUrl ?? candidate.logoIconUrl,
      variants: candidate.variants,
    })),
  } as unknown as Pick<LogoService, 'getLogoManifest'>;
  const authz = { requireRead: jest.fn() } as unknown as Pick<AuthzService, 'requireRead'>;
  return { logos, authz, cdnOrigin: 'https://example.portal.example.com' };
}

describe('selectLogoVariant', () => {
  it('large prefers the largest non-icon variant', () => {
    expect(selectLogoVariant(candidate, 'large')?.url).toBe('https://example.portal.example.com/logos/dom_large.png');
  });

  it('small prefers the icon variant', () => {
    expect(selectLogoVariant(candidate, 'small')?.url).toBe('https://example.portal.example.com/logos/dom_icon.ico');
  });

  it('auto prefers the stored primary logo', () => {
    expect(selectLogoVariant(candidate, 'auto')?.url).toBe('https://example.portal.example.com/logos/dom_primary.png');
  });

  it('large picks the biggest non-icon even when the shared ranking prefers another kind', () => {
    // The shared kind-first ranking puts the 128px mark above the 1024x512 wordmark; `large`
    // must not inherit that preference. Pins the two orderings apart.
    expect(rankVariants(candidate.variants, 'logo')[0]?.kind).toBe('mark');
    expect(selectLogoVariant(candidate, 'large')?.kind).toBe('wordmark');
  });

  it('falls back to the shared logo ranking when no primary logo is stored', () => {
    const noPrimary: LogoCandidate = { ...candidate, logoUrl: null, logoIconUrl: null };
    expect(selectLogoVariant(noPrimary, 'auto')?.kind).toBe(rankVariants(candidate.variants, 'logo')[0]?.kind);
  });

  it('small falls back to the shared icon ranking when no stored icon exists', () => {
    const noIcon: LogoCandidate = { ...candidate, logoIconUrl: null };
    expect(selectLogoVariant(noIcon, 'small')?.kind).toBe(KIND_ICON);
  });
});

describe('handleLogoRequest', () => {
  it('returns metadata and keeps the selected URL on the configured CDN origin', async () => {
    const dependencies = deps();
    const response = await handleLogoRequest(
      new URLSearchParams({ domain: 'acme.example', variant: 'large' }),
      READ_KEY,
      dependencies,
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toMatchObject({
      domain: 'acme.example',
      selectedVariant: { url: 'https://example.portal.example.com/logos/dom_large.png' },
    });
    expect(dependencies.authz.requireRead).toHaveBeenCalledWith(READ_KEY);
    expect(dependencies.logos.getLogoManifest).toHaveBeenCalledWith('acme.example');
  });

  it('redirects image requests to the selected logo without proxying arbitrary URLs', async () => {
    const dependencies = deps();
    const response = await handleLogoRequest(
      new URLSearchParams({ domain: 'www.acme.example', response: 'image', variant: 'large' }),
      USER,
      dependencies,
    );

    expect(response.statusCode).toBe(302);
    expect(response.headers.location).toBe('https://example.portal.example.com/logos/dom_large.png');
    expect(response.body).toBe('');
  });

  it('rejects a logo URL outside the configured CDN origin', async () => {
    const dependencies = deps({ logoUrl: 'https://attacker.example/logo.png' });
    const response = await handleLogoRequest(
      new URLSearchParams({ domain: 'acme.example' }),
      USER,
      dependencies,
    );

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body).logoUrl).toBeNull();
  });

  it('rejects callers without read capability before querying the logo cache', async () => {
    const dependencies = deps();
    dependencies.authz.requireRead = jest.fn(() => {
      throw new Error('not authorized');
    });

    const response = await handleLogoRequest(
      new URLSearchParams({ domain: 'acme.example' }),
      USER,
      dependencies,
    );

    expect(response.statusCode).toBe(403);
    expect(dependencies.logos.getLogoManifest).not.toHaveBeenCalled();
  });

  it('requires a domain', async () => {
    const dependencies = deps();
    const response = await handleLogoRequest(new URLSearchParams(), USER, dependencies);

    expect(response.statusCode).toBe(400);
    expect(dependencies.logos.getLogoManifest).not.toHaveBeenCalled();
  });
});
