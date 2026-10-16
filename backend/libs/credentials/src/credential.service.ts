// The single entry point every surface calls: resolve a bearer to a Principal, or null
// to deny. Opaque keys (psk_*) go to the ApiKeyService; JWTs dispatch on their
// token_use claim — `access` to the OAuth access-token verifier (MCP clients), anything
// else to the ID-token verifier (SPA). The peek is unverified and only picks the
// verifier; each verifier re-checks signature and every claim itself. Adding a future
// credential type is a change here + a new verifier — not a change at any call site.
import { ApiKeyService } from './api-key.service';
import { peekClaims } from './cognito-jwt';
import type { JwtVerifier, Principal } from './types';

export class CredentialService {
  constructor(
    private readonly keys: ApiKeyService | null,
    private readonly idToken: JwtVerifier | null,
    private readonly accessToken: JwtVerifier | null = null,
  ) {}

  /** Accepts a raw header value or a bare token. Returns null on empty/invalid. */
  async verify(bearer: string | null | undefined): Promise<Principal | null> {
    const token = stripBearer(bearer);
    if (!token) return null;
    if (token.startsWith('psk_')) return this.keys?.verifyKey(token) ?? null;
    const verifier = peekClaims(token)?.token_use === 'access' ? this.accessToken : this.idToken;
    return verifier?.verify(token) ?? null;
  }
}

function stripBearer(header: string | null | undefined): string {
  return (header ?? '').replace(/^Bearer\s+/i, '').trim();
}
