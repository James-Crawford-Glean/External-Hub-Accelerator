import { AccessRequestsResolver } from './access-requests.resolver';
import type { AccessRequestsService, AccessRequest } from '@libs/access-requests';
import type { AuthzService } from '@libs/authz';

const IDENT = { email: 'admin@example.com', sub: 'sub-1' };

const req = (extra: Partial<AccessRequest> = {}): AccessRequest => ({
  email: 'ada@example.com',
  name: 'Ada',
  attempts: 2,
  first_seen: '2026-06-16 19:20:38+00',
  last_seen: '2026-06-17 08:00:00+00',
  ...extra,
});

const make = (
  requests: Partial<AccessRequestsService> = {},
  authz: Partial<AuthzService> = {},
) =>
  new AccessRequestsResolver(
    { pending: jest.fn(async () => []), deny: jest.fn(async () => undefined), ...requests } as unknown as AccessRequestsService,
    { requireAdmin: jest.fn(async () => undefined), ...authz } as unknown as AuthzService,
  );

describe('AccessRequestsResolver.accessRequests', () => {
  it('requires admin then shapes the pending queue', async () => {
    const requireAdmin = jest.fn(async () => undefined);
    const pending = jest.fn(async () => [req()]);
    const out = await make({ pending }, { requireAdmin }).accessRequests({}, null, IDENT);
    expect(requireAdmin).toHaveBeenCalledWith(IDENT);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ email: 'ada@example.com', name: 'Ada', attempts: 2 });
    expect(out[0].firstSeen).toMatch(/^2026-06-16T/);
    expect(out[0].lastSeen).toMatch(/^2026-06-17T/);
  });

  it('coerces empty name to null and null timestamps to null', async () => {
    const pending = jest.fn(async () => [req({ name: '', attempts: 0, first_seen: null as any, last_seen: null as any })]);
    const out = await make({ pending }).accessRequests({}, null, IDENT);
    expect(out[0]).toMatchObject({ name: null, attempts: 0, firstSeen: null, lastSeen: null });
  });

  it('denied admin propagates and never reads the queue', async () => {
    const requireAdmin = jest.fn(async () => {
      throw new Error('not authorized: requires administrator');
    });
    const pending = jest.fn(async () => []);
    await expect(make({ pending }, { requireAdmin }).accessRequests({}, null, IDENT)).rejects.toThrow(
      'requires administrator',
    );
    expect(pending).not.toHaveBeenCalled();
  });
});

describe('AccessRequestsResolver.denyAccessRequest', () => {
  it('requires admin, normalises the email, denies, returns true', async () => {
    const requireAdmin = jest.fn(async () => undefined);
    const deny = jest.fn(async () => undefined);
    const out = await make({ deny }, { requireAdmin }).denyAccessRequest({ email: '  Ada@Example.com ' }, null, IDENT);
    expect(requireAdmin).toHaveBeenCalledWith(IDENT);
    expect(deny).toHaveBeenCalledWith('ada@example.com');
    expect(out).toBe(true);
  });

  it('rejects a missing / invalid email without touching the queue', async () => {
    const deny = jest.fn();
    await expect(make({ deny }).denyAccessRequest({ email: 'nope' }, null, IDENT)).rejects.toThrow(
      'a valid email is required',
    );
    await expect(make({ deny }).denyAccessRequest({}, null, IDENT)).rejects.toThrow('a valid email is required');
    expect(deny).not.toHaveBeenCalled();
  });

  it('denied admin propagates and never denies', async () => {
    const requireAdmin = jest.fn(async () => {
      throw new Error('not authorized: requires administrator');
    });
    const deny = jest.fn();
    await expect(
      make({ deny }, { requireAdmin }).denyAccessRequest({ email: 'ada@example.com' }, null, IDENT),
    ).rejects.toThrow('requires administrator');
    expect(deny).not.toHaveBeenCalled();
  });
});
