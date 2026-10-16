import { LoginEventsResolver } from './login-events.resolver';
import type { AuroraService } from '@libs/aurora';
import type { AuthzService } from '@libs/authz';
import type { IdentityService } from '@libs/identity';
import type { LoginEventsService } from '@libs/login-events';

const IDENT = { email: 'Ada@example.com', sub: 'sub-1' };

const eventRow = (extra: Record<string, unknown> = {}) => ({
  id: 42,
  email: 'ada@example.com',
  user_agent: 'Mozilla/5.0',
  created_at: '2026-06-16 19:20:38+00',
  total: 3,
  ...extra,
});

const make = (
  query: jest.Mock = jest.fn(async () => []),
  events: Partial<LoginEventsService> = {},
  authz: Partial<AuthzService> = {},
  identity: Partial<IdentityService> = {},
) =>
  new LoginEventsResolver(
    { query } as unknown as AuroraService,
    { record: jest.fn(async () => undefined), ...events } as unknown as LoginEventsService,
    { requireAdmin: jest.fn(async () => undefined), ...authz } as unknown as AuthzService,
    {
      callerEmail: jest.fn((i: any) => (i?.email ? String(i.email).toLowerCase() : null)),
      callerSub: jest.fn((i: any) => i?.sub || 'anonymous'),
      ...identity,
    } as unknown as IdentityService,
  );

describe('LoginEventsResolver.recordLogin', () => {
  it('records the caller-self login (email/sub from identity) and returns true', async () => {
    const record = jest.fn(async () => undefined);
    const out = await make(jest.fn(), { record }).recordLogin({ userAgent: 'UA' }, null, IDENT);
    expect(record).toHaveBeenCalledWith('ada@example.com', 'sub-1', 'UA');
    expect(out).toBe(true);
  });

  it('returns false and records nothing when the caller has no email', async () => {
    const record = jest.fn();
    const out = await make(jest.fn(), { record }, {}, { callerEmail: jest.fn(() => null) }).recordLogin(
      { userAgent: 'UA' },
      null,
      { sub: 'sub-1' },
    );
    expect(out).toBe(false);
    expect(record).not.toHaveBeenCalled();
  });
});

describe('LoginEventsResolver.loginActivity', () => {
  it('requires admin, no filters -> plain paginated read (default 50)', async () => {
    const requireAdmin = jest.fn(async () => undefined);
    const query = jest.fn(async () => [eventRow()]);
    const out = await make(query, {}, { requireAdmin }).loginActivity({}, null, IDENT);
    expect(requireAdmin).toHaveBeenCalledWith(IDENT);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('FROM app.login_events ORDER BY created_at DESC LIMIT :lim OFFSET :off');
    expect(sql).not.toContain('WHERE');
    expect(params).toMatchObject({ lim: 50, off: 0 });
    expect(out.total).toBe(3);
    expect(out.items[0]).toMatchObject({ id: '42', email: 'ada@example.com', userAgent: 'Mozilla/5.0' });
    expect(out.items[0].createdAt).toMatch(/^2026-06-16T/);
  });

  it('builds search + from/to clauses and binds params', async () => {
    const query = jest.fn(async () => []);
    await make(query).loginActivity(
      { search: '  ada ', from: '2026-06-01', to: '2026-06-30', limit: 10, offset: 5 },
      null,
      IDENT,
    );
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('WHERE email ILIKE :q AND created_at >= :frm::timestamptz AND created_at <= :to::timestamptz');
    expect(params).toMatchObject({ q: '%ada%', frm: '2026-06-01', to: '2026-06-30', lim: 10, off: 5 });
  });

  it('clamps limit to the 200 max', async () => {
    const query = jest.fn(async () => []);
    await make(query).loginActivity({ limit: 999 }, null, IDENT);
    expect(query.mock.calls[0][1].lim).toBe(200);
  });

  it('empty result -> total 0', async () => {
    const out = await make(jest.fn(async () => [])).loginActivity({}, null, IDENT);
    expect(out).toEqual({ items: [], total: 0 });
  });

  it('denied admin propagates and never queries', async () => {
    const requireAdmin = jest.fn(async () => {
      throw new Error('not authorized: requires administrator');
    });
    const query = jest.fn();
    await expect(make(query, {}, { requireAdmin }).loginActivity({}, null, IDENT)).rejects.toThrow(
      'requires administrator',
    );
    expect(query).not.toHaveBeenCalled();
  });
});
