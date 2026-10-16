// Query.me / Query.user / Query.users: the caller's profile and the user
// registry. Off-roster callers are not blocked here; their first sign-in is
// recorded as an access request so an administrator can grant a role, and
// they see VIEWER until then. The null true role still flows to authz for
// data scoping, so a defaulted caller sees only unrestricted rows.
import { AuroraService } from '@libs/aurora';
import { Logger } from '@libs/log';
import { AuthzService, type Identity } from '@libs/authz';
import { IdentityService } from '@libs/identity';
import { AccessRequestsService } from '@libs/access-requests';
import { AvatarService } from '@libs/avatar';
import { RosterService, VIEWER } from '@libs/roster';
import { paginate, type Params } from '@libs/sql';

export interface PortalUser {
  id: string;
  name: string;
  email: string;
  title: string | null;
  role: string | null;
  isAdmin: boolean;
  isActive: boolean;
  initials: string;
  avatarUrl: string | null;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return parts
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join('');
}

interface UserRow {
  id: string;
  email: string;
  name: string | null;
  title: string | null;
  is_active: boolean;
  total?: number;
}

export class UsersResolver {
  private readonly log = new Logger(UsersResolver.name);

  constructor(
    private readonly aurora: AuroraService,
    private readonly authz: AuthzService,
    private readonly identity: IdentityService,
    private readonly roster: RosterService,
    private readonly accessRequests: AccessRequestsService,
    private readonly avatar: AvatarService,
  ) {}

  async me(_args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<PortalUser | null> {
    if (!identity || !identity.sub) return null;
    const email = this.identity.callerEmail(identity) ?? 'unknown@example.com';
    const name = (identity.name as string | undefined) || email;
    const trueRole = await this.authz.roleFromIdentity(identity);
    if (trueRole === null) {
      try {
        await this.accessRequests.record(email, identity.name as string | null | undefined, identity.sub);
      } catch {
        this.log.error('me.record_access_request_failed');
      }
    }
    const id = await this.identity.callerId(identity);
    const profile = await this.identity.userByEmail(email);
    return {
      id,
      name: profile?.name || name,
      email,
      title: profile?.title ?? null,
      role: trueRole ?? VIEWER,
      isAdmin: await this.authz.isAdminFromIdentity(identity),
      isActive: profile?.is_active ?? true,
      initials: initials(profile?.name || name),
      avatarUrl: await this.avatar.avatarUrlForEmail(email),
    };
  }

  async user(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<PortalUser | null> {
    this.authz.requireRead(identity);
    const row = await this.identity.userById(String(args.id ?? ''));
    return row ? this.toUser(row) : null;
  }

  async users(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<{ items: PortalUser[]; total: number }> {
    this.authz.requireRead(identity);
    const params: Params = {};
    const where: string[] = ['TRUE'];
    const search = String(args.search ?? '').trim().toLowerCase();
    if (search) {
      params.q = `%${search}%`;
      where.push('(lower(name) LIKE :q OR lower(email) LIKE :q)');
    }
    if (args.activeOnly !== false) where.push('is_active');
    paginate(args as { limit?: number | null; offset?: number | null }, params, { def: 50, maxLimit: 500 });
    const rows = await this.aurora.query<UserRow>(
      'SELECT id, email, name, title, is_active, count(*) OVER() AS total FROM app.users ' +
        `WHERE ${where.join(' AND ')} ORDER BY lower(coalesce(name, email)) LIMIT :lim OFFSET :off`,
      params,
    );
    const items = await Promise.all(rows.map((r) => this.toUser(r)));
    return { items, total: Number(rows[0]?.total ?? 0) };
  }

  private async toUser(row: UserRow): Promise<PortalUser> {
    const entry = await this.roster.entryForEmail(row.email);
    const name = row.name || row.email;
    return {
      id: row.id,
      name,
      email: row.email,
      title: row.title,
      role: entry?.role ?? null,
      isAdmin: entry?.isAdmin ?? false,
      isActive: row.is_active,
      initials: initials(name),
      avatarUrl: await this.avatar.avatarUrlForEmail(row.email),
    };
  }
}
