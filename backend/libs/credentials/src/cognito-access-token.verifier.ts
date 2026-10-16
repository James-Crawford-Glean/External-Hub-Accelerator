// Cognito access-token verification for OAuth clients of the MCP server (RFC 9728
// resource server role). Trust is pinned to the resource-server scopes rather than a
// client_id: DCR mints a fresh app client per MCP host, so the client set is open but
// every client can only ever be granted `<resource>/read` / `<resource>/write`. The
// email claim is present because the pool's Pre Token Generation V2 trigger copies it
// into access tokens; without it no roster lookup is possible, so it is required.
import { CognitoJwks, emailAtDomain, isExpired, jwksLoaderFor, verifySignedClaims, type JwksLoader } from './cognito-jwt';
import type { JwtVerifier, Scope, UserPrincipal } from './types';

export interface CognitoAccessTokenConfig {
  issuer: string;
  /** Cognito resource-server identifier; scopes are `<resourceIdentifier>/<name>`. */
  resourceIdentifier: string;
  allowedEmailDomain?: string; // comma-separated list; unset = any domain
}

const RESOURCE_SCOPES: readonly Scope[] = ['read', 'write'];

export class CognitoAccessTokenVerifier implements JwtVerifier {
  private readonly jwks: CognitoJwks;

  constructor(
    private readonly cfg: CognitoAccessTokenConfig,
    loadJwks: JwksLoader = jwksLoaderFor(cfg.issuer),
    private readonly now: () => number = () => Date.now(),
  ) {
    this.jwks = new CognitoJwks(loadJwks);
  }

  async verify(token: string): Promise<UserPrincipal | null> {
    const claims = await verifySignedClaims(token, this.jwks);
    if (!claims) return null;
    if (claims.iss !== this.cfg.issuer) return null;
    if (claims.token_use !== 'access') return null;
    if (isExpired(claims, this.now())) return null;
    if (!claims.sub) return null;
    // Classic Cognito access tokens carry no aud; when managed login v2 adds one it
    // must name us (RFC 8707 resource binding).
    if (claims.aud !== undefined && !audMatches(claims.aud, this.cfg.resourceIdentifier)) return null;

    const scopes = resourceScopes(claims.scope, this.cfg.resourceIdentifier);
    if (scopes.length === 0) return null;

    const email = (claims.email ?? '').toLowerCase();
    if (!email) return null;
    if (this.cfg.allowedEmailDomain && !emailAtDomain(email, this.cfg.allowedEmailDomain)) return null;

    return { kind: 'user', email, sub: claims.sub, name: claims.name ?? null, scopes };
  }
}

/** Our scopes out of the space-separated OAuth `scope` claim; openid/email etc. drop. */
export function resourceScopes(scopeClaim: string | undefined, resourceIdentifier: string): Scope[] {
  const prefix = `${resourceIdentifier}/`;
  return (scopeClaim ?? '')
    .split(' ')
    .filter((s) => s.startsWith(prefix))
    .map((s) => s.slice(prefix.length))
    .filter((s): s is Scope => (RESOURCE_SCOPES as readonly string[]).includes(s));
}

function audMatches(aud: string | string[], resource: string): boolean {
  return Array.isArray(aud) ? aud.includes(resource) : aud === resource;
}
