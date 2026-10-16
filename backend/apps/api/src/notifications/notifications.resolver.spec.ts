import { NotificationsResolver } from './notifications.resolver';
import type { AuroraService } from '@libs/aurora';
import type { IdentityService } from '@libs/identity';

const identity = { email: 'Matt@Example.com' };

function resolver(query = jest.fn(async () => []), execute = jest.fn(async () => ({}))) {
  const aurora = { query, execute } as unknown as AuroraService;
  const ids = { callerEmail: (i: { email?: string } | null) => (i?.email ? i.email.trim().toLowerCase() : null) };
  return { resolver: new NotificationsResolver(aurora, ids as unknown as IdentityService), query, execute };
}

describe('NotificationsResolver', () => {
  it('lists only the caller unread rows', async () => {
    const { resolver: svc, query } = resolver(
      jest.fn(async () => [
        {
          id: 'ntf_1',
          title: 'First partner mapped on 1 account',
          body: 'WWT · no open pipeline',
          href: '/accounts/acc_1',
          created_at: '2026-10-09T00:00:00Z',
        },
      ]),
    );
    const rows = await svc.notifications({}, null, identity);
    expect(query.mock.calls[0][0]).toContain('read_at IS NULL');
    expect(query.mock.calls[0][1]).toMatchObject({ email: 'matt@example.com' });
    expect(rows[0]?.href).toBe('/accounts/acc_1');
  });

  it('marks read only for the caller email', async () => {
    const { resolver: svc, execute } = resolver();
    await svc.markNotificationRead({ id: 'ntf_1' }, null, identity);
    expect(execute.mock.calls[0][0]).toContain('recipient_email = :email');
    expect(execute.mock.calls[0][1]).toMatchObject({ id: 'ntf_1', email: 'matt@example.com' });
  });

  it('returns nothing when the caller has no email', async () => {
    const { resolver: svc, query } = resolver();
    await expect(svc.notifications({}, null, {})).resolves.toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
});
