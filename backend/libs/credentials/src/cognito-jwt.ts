// Signature + structure layer shared by the Cognito ID-token and access-token
// verifiers: fetch the pool JWKS, verify RS256 over header.payload with node:crypto
// (no jose dep), return the decoded claims. Claim semantics (iss / aud / exp /
// token_use / scope) are each verifier's job.
import { createPublicKey, verify as cryptoVerify, type KeyObject } from 'node:crypto';

export interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
  use?: string;
}

export type JwksLoader = () => Promise<Jwk[]>;

export interface CognitoClaims {
  iss?: string;
  aud?: string | string[];
  client_id?: string;
  exp?: number;
  token_use?: string;
  scope?: string;
  email?: string;
  name?: string;
  sub?: string;
  username?: string;
}

export function jwksLoaderFor(issuer: string): JwksLoader {
  return async () => {
    const resp = await fetch(`${issuer}/.well-known/jwks.json`);
    if (!resp.ok) throw new Error(`jwks fetch failed: ${resp.status}`);
    const body = (await resp.json()) as { keys?: Jwk[] };
    return body.keys ?? [];
  };
}

/** Caches the pool's RSA keys by kid; refetches once on a miss (key rotation). */
export class CognitoJwks {
  private keys: Map<string, KeyObject> | null = null;

  constructor(private readonly load: JwksLoader) {}

  async keyFor(kid: string): Promise<KeyObject | null> {
    if (this.keys?.has(kid)) return this.keys.get(kid) ?? null;
    this.keys = await this.build();
    return this.keys.get(kid) ?? null;
  }

  private async build(): Promise<Map<string, KeyObject>> {
    const map = new Map<string, KeyObject>();
    for (const jwk of await this.load()) {
      if (jwk.kty !== 'RSA') continue;
      map.set(
        jwk.kid,
        createPublicKey({ key: jwk, format: 'jwk' } as unknown as Parameters<typeof createPublicKey>[0]),
      );
    }
    return map;
  }
}

/** Verifies the RS256 signature and returns the claims, or null for anything that
 *  is not a well-formed, correctly-signed JWT from this key set. */
export async function verifySignedClaims(token: string, jwks: CognitoJwks): Promise<CognitoClaims | null> {
  const parts = token.split('.');
  if (parts.length !== 3) return null;
  const [headerB64, payloadB64, sigB64] = parts as [string, string, string];

  const header = decodeJson<{ alg?: string; kid?: string }>(headerB64);
  if (!header || header.alg !== 'RS256' || !header.kid) return null;

  const key = await jwks.keyFor(header.kid);
  if (!key) return null;

  const ok = cryptoVerify(
    'RSA-SHA256',
    Buffer.from(`${headerB64}.${payloadB64}`),
    key,
    Buffer.from(sigB64, 'base64url'),
  );
  if (!ok) return null;

  return decodeJson<CognitoClaims>(payloadB64);
}

/** Unverified read of a claim for dispatch only; never trust the value. */
export function peekClaims(token: string): CognitoClaims | null {
  const payload = token.split('.')[1];
  return payload ? decodeJson<CognitoClaims>(payload) : null;
}

export function isExpired(claims: CognitoClaims, nowMs: number): boolean {
  return !claims.exp || claims.exp * 1000 <= nowMs;
}

/** True when `email` (already lowercased) is at `domain`. Matches the full "@domain"
 *  tail so a look-alike such as evil@example.com.attacker.tld does not slip past. */
export function emailAtDomain(email: string, domains: string): boolean {
  const at = email.toLowerCase();
  return domains
    .split(',')
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean)
    .some((d) => at.endsWith(`@${d}`));
}

function decodeJson<T>(segment: string): T | null {
  try {
    return JSON.parse(Buffer.from(segment, 'base64url').toString('utf8')) as T;
  } catch {
    return null;
  }
}
