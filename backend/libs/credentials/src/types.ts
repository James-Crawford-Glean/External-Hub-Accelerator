// The credential contract every API surface authorizes against. A bearer resolves
// to exactly one Principal: a person (Cognito JWT) or a service key (opaque token).
// Surfaces never re-implement token parsing/hashing/JWKS — they consume this lib.

/** Capability a credential carries. Keys are authorized by scope; people by roster role. */
export type Scope = 'read' | 'write' | 'admin';

/** A signed-in person, resolved from a Cognito JWT (email → roster role downstream).
 *  `scopes` is set only for OAuth access tokens (MCP clients); the roster still decides
 *  what the person may do, the scopes cap what the client was granted. */
export interface UserPrincipal {
  kind: 'user';
  email: string;
  sub: string;
  name: string | null;
  scopes?: Scope[];
}

/** A service credential, resolved from an opaque API key (authorized by its scopes). */
export interface ApiKeyPrincipal {
  kind: 'apiKey';
  keyId: string;
  scopes: Scope[];
}

export type Principal = UserPrincipal | ApiKeyPrincipal;

/** Verifies a Cognito JWT against the pool JWKS. Implemented by the authorizer (later
 *  task); injected here so CredentialService composes both credential types without
 *  depending on any JWKS/HTTP specifics. */
export interface JwtVerifier {
  verify(token: string): Promise<UserPrincipal | null>;
}

export type ApiKeyStatus = 'active' | 'revoked';

/** Public view of a key — never carries the secret or its hash. */
export interface ApiKeyRecord {
  id: string; // apk_<random>
  name: string;
  prefix: string; // 'psk_live' (display)
  last4: string; // last 4 chars of the secret (display)
  scopes: Scope[];
  status: ApiKeyStatus;
  createdAt: string; // ISO
  createdBy: string; // actor principal id (email or keyId)
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface CreateApiKeyInput {
  name: string;
  scopes: Scope[]; // caller-selected; at least one required
  expiresAt?: string | null; // ISO; null = never expires
}

/** Result of creating a key. `secret` is the full token, revealed exactly once. */
export interface CreateApiKeyResult {
  record: ApiKeyRecord;
  secret: string;
}

/** Human-readable meaning of each scope, for UI/consumer docs and one source of truth. */
export const SCOPE_DESCRIPTIONS: Record<Scope, string> = {
  read: 'Read partner, account, opportunity, mapping, and activity data.',
  write: 'Create and modify data — partners, contacts, activities, mappings, and special pricing.',
  admin: 'Administrative operations — roles & access, sync configuration, and API keys.',
};

/** Stable id for a principal (used to stamp createdBy). */
export function principalId(actor: Principal): string {
  return actor.kind === 'user' ? actor.email : actor.keyId;
}

const ALL_SCOPES: readonly Scope[] = ['read', 'write', 'admin'];

/** Scopes from a comma-separated string (how the authorizer serializes them) or an
 *  array. Unknown values are dropped, so only real scopes ever reach an authz check. */
export function parseScopes(raw: unknown): Scope[] {
  const parts = Array.isArray(raw) ? raw : String(raw ?? '').split(',');
  return parts.map((s) => String(s).trim()).filter((s): s is Scope => (ALL_SCOPES as readonly string[]).includes(s));
}

/** Normalize an authorizer-context / identity object into a typed Principal, or null.
 *  Keys carry a `kind: 'apiKey'` marker + scopes; legacy identities (email/sub, no
 *  kind) resolve to a user principal. Used by the dispatcher and authz layer. */
export function principalFromContext(ctx: Record<string, unknown> | null | undefined): Principal | null {
  const c = ctx ?? {};
  if (c.kind === 'apiKey') {
    return { kind: 'apiKey', keyId: String(c.keyId ?? ''), scopes: parseScopes(c.scopes) };
  }
  const email = typeof c.email === 'string' ? c.email : '';
  const sub = typeof c.sub === 'string' ? c.sub : '';
  const name = typeof c.name === 'string' ? c.name : null;
  if (!email && !sub) return null;
  const scopes = c.scopes ? parseScopes(c.scopes) : [];
  return { kind: 'user', email: email.toLowerCase(), sub, name, ...(scopes.length ? { scopes } : {}) };
}
