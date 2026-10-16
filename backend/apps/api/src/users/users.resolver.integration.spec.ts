// Runs the real migrations in embedded Postgres and exercises the user registry,
// roster, and authz path end to end: an off-roster sign-in becomes an access
// request; granting a role clears it; roster-scoped authz follows.
import { pgAurora, type PgAurora } from '@libs/testkit';
import { AccessRequestsService } from '@libs/access-requests';
import { AuthzService } from '@libs/authz';
import { IdentityService } from '@libs/identity';
import { RosterService, EDITOR } from '@libs/roster';
import type { AvatarService } from '@libs/avatar';
import { UsersResolver } from './users.resolver';
import { RosterResolver } from '../roster/roster.resolver';

const noAvatar = { avatarUrlForEmail: async () => null } as unknown as AvatarService;

describe('users + roster against the platform migrations', () => {
  let pg: PgAurora;
  let users: UsersResolver;
  let rosterResolver: RosterResolver;
  let authz: AuthzService;

  beforeAll(async () => {
    pg = await pgAurora();
    const roster = new RosterService(pg.aurora);
    const identity = new IdentityService(pg.aurora);
    const requests = new AccessRequestsService(pg.aurora);
    authz = new AuthzService(roster);
    users = new UsersResolver(pg.aurora, authz, identity, roster, requests, noAvatar);
    rosterResolver = new RosterResolver(authz, roster, requests);
    await pg.exec("INSERT INTO app.access_roster (email, role, is_admin) VALUES ('admin@example.com', 'ADMINISTRATOR', true)");
  });
  afterAll(() => pg.close());

  const admin = { sub: 'sub-admin', email: 'admin@example.com', name: 'Ada Admin' };
  const newcomer = { sub: 'sub-new', email: 'New@Example.com', name: 'Nia New' };

  it('mints a registry id and records an access request for an off-roster caller', async () => {
    const me = await users.me({}, null, newcomer);
    expect(me).toMatchObject({ email: 'new@example.com', role: 'VIEWER', isAdmin: false });
    expect(me!.id).toMatch(/^usr_[A-Za-z0-9]{14}$/);
    const again = await users.me({}, null, newcomer);
    expect(again!.id).toBe(me!.id);

    const pending = await pg.aurora.query<{ email: string; attempts: number }>('SELECT email, attempts FROM app.access_requests');
    expect(pending).toEqual([{ email: 'new@example.com', attempts: 2 }]);
    await expect(authz.canWrite(newcomer)).resolves.toBe(false);
  });

  it('granting a role clears the request and unlocks writes', async () => {
    const member = await rosterResolver.updateRosterMember({ email: 'new@example.com', role: EDITOR }, null, admin);
    expect(member).toMatchObject({ email: 'new@example.com', role: 'EDITOR', isAdmin: false, name: 'Nia New' });
    expect(await pg.aurora.query('SELECT 1 FROM app.access_requests')).toEqual([]);
    await expect(authz.canWrite(newcomer)).resolves.toBe(true);
    await expect(authz.requireAdmin(newcomer)).rejects.toThrow('requires administrator');
  });

  it('lists registry users with roster roles joined', async () => {
    const res = await users.users({ search: 'new' }, null, admin);
    expect(res.total).toBe(1);
    expect(res.items[0]).toMatchObject({ email: 'new@example.com', role: 'EDITOR' });
  });

  it('refuses to demote the last administrator', async () => {
    await expect(
      rosterResolver.updateRosterMember({ email: 'admin@example.com', role: 'VIEWER', isAdmin: false }, null, {
        sub: 'x',
        email: 'new@example.com',
      }),
    ).rejects.toThrow();
  });
});
