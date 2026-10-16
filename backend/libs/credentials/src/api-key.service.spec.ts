import { ApiKeyService, ApiKeyNotFound } from './api-key.service';
import type { ApiKeyStore } from './api-key.store';
import type { ApiKeyRecord, Principal } from './types';

// In-memory ApiKeyStore double: keeps {record, hash} so create→verify round-trips
// through the real HMAC (same pepper), the way the DDB GSI lookup would.
class FakeStore {
  readonly items = new Map<string, { record: ApiKeyRecord; hash: string }>();

  async put(record: ApiKeyRecord, hash: string): Promise<void> {
    this.items.set(record.id, { record: { ...record }, hash });
  }
  async list(): Promise<ApiKeyRecord[]> {
    return [...this.items.values()].map((v) => v.record);
  }
  async get(id: string): Promise<ApiKeyRecord | null> {
    return this.items.get(id)?.record ?? null;
  }
  async getByHash(hash: string): Promise<ApiKeyRecord | null> {
    for (const v of this.items.values()) if (v.hash === hash) return v.record;
    return null;
  }
  async revoke(id: string, revokedAt: string): Promise<ApiKeyRecord | null> {
    const v = this.items.get(id);
    if (!v) return null;
    v.record = { ...v.record, status: 'revoked', revokedAt };
    return v.record;
  }
  async remove(id: string): Promise<void> {
    this.items.delete(id);
  }
  async touchLastUsed(id: string, at: string): Promise<void> {
    const v = this.items.get(id);
    if (v) v.record = { ...v.record, lastUsedAt: at };
  }
}

const NOW = new Date('2026-05-22T17:00:00Z');
const ADMIN: Principal = { kind: 'user', email: 'admin@example.com', sub: 'sub-1', name: 'Admin' };

function makeService(now: () => Date = () => NOW): { svc: ApiKeyService; store: FakeStore } {
  const store = new FakeStore();
  const svc = new ApiKeyService(store as unknown as ApiKeyStore, async () => 'test-pepper', now);
  return { svc, store };
}

describe('ApiKeyService.create', () => {
  it('returns a psk_live secret once and stores only its hash', async () => {
    const { svc, store } = makeService();
    const { record, secret } = await svc.create({ name: 'Sync', scopes: ['read'] }, ADMIN);

    expect(secret.startsWith('psk_live_')).toBe(true);
    expect(record.id.startsWith('apk_')).toBe(true);
    expect(record.prefix).toBe('psk_live');
    expect(record.last4).toBe(secret.slice(-4));
    expect(record.status).toBe('active');
    expect(record.createdBy).toBe('admin@example.com');
    expect(record.createdAt).toBe(NOW.toISOString());
    // stored item carries a hash, never the plaintext
    const stored = store.items.get(record.id)!;
    expect(stored.hash).not.toContain(secret);
    expect(stored.hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('stores the selected scopes (de-duped) and rejects an empty set', async () => {
    const { svc } = makeService();
    expect((await svc.create({ name: 'k', scopes: ['read', 'write'] }, ADMIN)).record.scopes).toEqual([
      'read',
      'write',
    ]);
    expect((await svc.create({ name: 'k', scopes: ['read', 'read', 'admin'] }, ADMIN)).record.scopes).toEqual([
      'read',
      'admin',
    ]);
    await expect(svc.create({ name: 'k', scopes: [] }, ADMIN)).rejects.toThrow('at least one scope');
    await expect(svc.create({ name: '  ', scopes: ['read'] }, ADMIN)).rejects.toThrow('name is required');
  });
});

describe('ApiKeyService.verifyKey', () => {
  it('round-trips a freshly created key to an apiKey principal', async () => {
    const { svc } = makeService();
    const { record, secret } = await svc.create({ name: 'k', scopes: ['read', 'write', 'admin'] }, ADMIN);

    expect(await svc.verifyKey(secret)).toEqual({
      kind: 'apiKey',
      keyId: record.id,
      scopes: ['read', 'write', 'admin'],
    });
  });

  it('rejects unknown, non-psk, revoked, and expired tokens', async () => {
    const { svc } = makeService();
    const { record, secret } = await svc.create({ name: 'k', scopes: ['read'] }, ADMIN);

    expect(await svc.verifyKey('psk_live_nope')).toBeNull();
    expect(await svc.verifyKey('eyJ.a.jwt')).toBeNull();

    await svc.revoke(record.id);
    expect(await svc.verifyKey(secret)).toBeNull();
  });

  it('rejects an expired key', async () => {
    const { svc } = makeService();
    const { secret } = await svc.create({ name: 'k', scopes: ['read'], expiresAt: '2026-05-01T00:00:00Z' }, ADMIN);
    // NOW (2026-05-22) is past the expiry
    expect(await svc.verifyKey(secret)).toBeNull();
  });
});

describe('ApiKeyService.revoke / remove', () => {
  it('revoke stamps status + revoked_at, then throws on a missing id', async () => {
    const { svc } = makeService();
    const { record } = await svc.create({ name: 'k', scopes: ['read'] }, ADMIN);

    const revoked = await svc.revoke(record.id);
    expect(revoked.status).toBe('revoked');
    expect(revoked.revokedAt).toBe(NOW.toISOString());

    await expect(svc.revoke('apk_missing')).rejects.toBeInstanceOf(ApiKeyNotFound);
  });

  it('remove deletes an existing key and throws on a missing id', async () => {
    const { svc, store } = makeService();
    const { record } = await svc.create({ name: 'k', scopes: ['read'] }, ADMIN);

    await svc.remove(record.id);
    expect(store.items.has(record.id)).toBe(false);
    await expect(svc.remove('apk_missing')).rejects.toBeInstanceOf(ApiKeyNotFound);
  });
});
