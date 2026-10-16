// Opaque API key lifecycle + verification. The raw secret is generated here, returned
// once from create(), and never persisted — only HMAC(pepper, token) is stored. Keys
// are high-entropy (256-bit) so a keyed hash (not a slow password hash) is the correct,
// cheap choice for the hot verify path. The pepper is fetched once and memoized.
import { createHmac, randomBytes } from 'node:crypto';
import { ApiKeyStore } from './api-key.store';
import {
  type ApiKeyPrincipal,
  type ApiKeyRecord,
  type CreateApiKeyInput,
  type CreateApiKeyResult,
  type Principal,
  type Scope,
  principalId,
} from './types';

/** Resolves the HMAC pepper (e.g. from Secrets Manager). Injected so the lib stays
 *  free of any secrets-store specifics. */
export type PepperProvider = () => Promise<string>;

export const KEY_PREFIX = 'psk_live';
const TOKEN_PREFIX = `${KEY_PREFIX}_`;

/** Raised when a key id doesn't exist for revoke/remove. */
export class ApiKeyNotFound extends Error {
  constructor(id: string) {
    super(`api key not found: ${id}`);
    this.name = 'ApiKeyNotFound';
  }
}

export class ApiKeyService {
  private pepper: Promise<string> | null = null;

  constructor(
    private readonly store: ApiKeyStore,
    private readonly getPepper: PepperProvider,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): Promise<ApiKeyRecord[]> {
    return this.store.list();
  }

  /** Mint a key. Returns the full secret exactly once; only its hash is stored. */
  async create(input: CreateApiKeyInput, actor: Principal): Promise<CreateApiKeyResult> {
    const name = input.name.trim();
    if (!name) throw new Error('api key name is required');
    const scopes = dedupe(input.scopes);
    if (scopes.length === 0) throw new Error('at least one scope is required');
    const secret = `${TOKEN_PREFIX}${b64url(32)}`;
    const record: ApiKeyRecord = {
      id: `apk_${b64url(9)}`,
      name,
      prefix: KEY_PREFIX,
      last4: secret.slice(-4),
      scopes,
      status: 'active',
      createdAt: this.now().toISOString(),
      createdBy: principalId(actor),
      lastUsedAt: null,
      expiresAt: input.expiresAt ?? null,
      revokedAt: null,
    };
    await this.store.put(record, await this.hash(secret));
    return { record, secret };
  }

  async revoke(id: string): Promise<ApiKeyRecord> {
    const updated = await this.store.revoke(id, this.now().toISOString());
    if (!updated) throw new ApiKeyNotFound(id);
    return updated;
  }

  async remove(id: string): Promise<void> {
    const existing = await this.store.get(id);
    if (!existing) throw new ApiKeyNotFound(id);
    await this.store.remove(id);
  }

  /** Resolve an opaque token to a principal, or null (unknown / revoked / expired). */
  async verifyKey(token: string): Promise<ApiKeyPrincipal | null> {
    if (!token.startsWith(TOKEN_PREFIX)) return null;
    const record = await this.store.getByHash(await this.hash(token));
    if (!record || record.status !== 'active') return null;
    if (record.expiresAt && Date.parse(record.expiresAt) <= this.now().getTime()) return null;
    void this.store.touchLastUsed(record.id, this.now().toISOString());
    return { kind: 'apiKey', keyId: record.id, scopes: record.scopes };
  }

  private async hash(token: string): Promise<string> {
    this.pepper ??= this.getPepper();
    return createHmac('sha256', await this.pepper)
      .update(token)
      .digest('hex');
  }
}

/** url-safe base64 of n random bytes (matches the house shared.ids style). */
function b64url(bytes: number): string {
  return randomBytes(bytes).toString('base64url');
}

/** Stable-order de-dup of scopes. */
function dedupe(scopes: Scope[]): Scope[] {
  return [...new Set(scopes)];
}
