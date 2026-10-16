import { ApiKeysResolver } from './api-keys.resolver';
import type { ApiKeyService, ApiKeyRecord } from '@libs/credentials';
import { AuthzService, Unauthorized } from '@libs/authz';

const RECORD: ApiKeyRecord = {
  id: 'apk_1',
  name: 'Sync',
  prefix: 'psk_live',
  last4: 'ab12',
  scopes: ['read', 'write'],
  status: 'active',
  createdAt: '2026-05-22T17:00:00Z',
  createdBy: 'admin@example.com',
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
};

const ADMIN = { email: 'admin@example.com', sub: 's1', name: 'Admin' };

function make(admin = true) {
  const create = jest.fn(async () => ({ record: RECORD, secret: 'psk_live_thesecret' }));
  const list = jest.fn(async () => [RECORD]);
  const revoke = jest.fn(async () => ({ ...RECORD, status: 'revoked' as const, revokedAt: '2026-05-23T00:00:00Z' }));
  const remove = jest.fn(async () => undefined);
  const keys = { create, list, revoke, remove } as unknown as ApiKeyService;
  const authz = {
    requireAdmin: jest.fn(async () => {
      if (!admin) throw new Unauthorized('not authorized: requires administrator');
    }),
  } as unknown as AuthzService;
  return { resolver: new ApiKeysResolver(keys, authz), create, list, revoke, remove, authz };
}

describe('ApiKeysResolver', () => {
  it('lists keys with UPPER-case scopes/status and no secret', async () => {
    const { resolver } = make();
    const [key] = await resolver.apiKeys_({}, null, ADMIN);
    expect(key).toMatchObject({ id: 'apk_1', scopes: ['READ', 'WRITE'], status: 'ACTIVE' });
    expect(key).not.toHaveProperty('secret');
  });

  it('creates a key: lowercases scopes to the service, returns UPPER + the secret once', async () => {
    const { resolver, create } = make();
    const res = await resolver.createApiKey({ input: { name: 'Sync', scopes: ['READ', 'ADMIN'] } }, null, ADMIN);

    expect(create).toHaveBeenCalledWith(
      { name: 'Sync', scopes: ['read', 'admin'], expiresAt: null },
      { kind: 'user', email: 'admin@example.com', sub: 's1', name: 'Admin' },
    );
    expect(res.secret).toBe('psk_live_thesecret');
    expect(res.apiKey).toMatchObject({ scopes: ['READ', 'WRITE'], status: 'ACTIVE' });
  });

  it('revokes and deletes', async () => {
    const { resolver, revoke, remove } = make();
    expect((await resolver.revokeApiKey({ id: 'apk_1' }, null, ADMIN)).status).toBe('REVOKED');
    expect(revoke).toHaveBeenCalledWith('apk_1');
    expect(await resolver.deleteApiKey({ id: 'apk_1' }, null, ADMIN)).toBe(true);
    expect(remove).toHaveBeenCalledWith('apk_1');
  });

  it('enforces admin on every field', async () => {
    const { resolver, create } = make(false);
    await expect(resolver.apiKeys_({}, null, {})).rejects.toBeInstanceOf(Unauthorized);
    await expect(resolver.createApiKey({ input: { name: 'x', scopes: ['READ'] } }, null, {})).rejects.toBeInstanceOf(
      Unauthorized,
    );
    expect(create).not.toHaveBeenCalled();
  });
});
