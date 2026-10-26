// Cognito ID-token verification (the SPA / AppSync path). Preserves the contract the
// old AppSync OIDC authorizer enforced: token_use=id, aud pinned to the SPA app client.
import { CognitoJwks, emailAtDomain, isExpired, jwksLoaderFor, verifySignedClaims, type JwksLoader } from './cognito-jwt';
import type { JwtVerifier, UserPrincipal } from './types';

export interface CognitoJwtConfig {
  issuer: string;
  clientId: string;
  /**
   * When set, only tokens whose email is at one of these domains are accepted; anything
   * else verifies cryptographically but is rejected. This is the single enforcement point
   * for the email-domain allowlist and also revokes any out-of-domain session minted
   * before it was enforced. Case-insensitive; empty/undefined disables the check.
   */
  allowedEmailDomain?: string; // comma-separated list; unset = any domain
}

export class CognitoJwtVerifier implements JwtVerifier {
  private readonly jwks: CognitoJwks;

  constructor(
    private readonly cfg: CognitoJwtConfig,
    loadJwks: JwksLoader = jwksLoaderFor(cfg.issuer),
    private readonly now: () => number = () => Date.now(),
  ) {
    this.jwks = new CognitoJwks(loadJwks);
  }

  async verify(token: string): Promise<UserPrincipal | null> {
    const claims = await verifySignedClaims(token, this.jwks);
    if (!claims) return null;
    if (claims.iss !== this.cfg.issuer) return null;
    if (claims.token_use !== 'id') return null;
    if (!audMatches(claims.aud, this.cfg.clientId)) return null;
    if (isExpired(claims, this.now())) return null;
    if (!claims.sub) return null;

    const email = (claims.email ?? '').toLowerCase();
    if (this.cfg.allowedEmailDomain && !emailAtDomain(email, this.cfg.allowedEmailDomain)) return null;

    return { kind: 'user', email, sub: claims.sub, name: claims.name ?? null };
  }
}

function audMatches(aud: string | string[] | undefined, clientId: string): boolean {
  if (!aud) return false;
  return Array.isArray(aud) ? aud.includes(clientId) : aud === clientId;
}
