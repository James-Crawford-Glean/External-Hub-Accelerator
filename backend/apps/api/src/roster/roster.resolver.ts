// Admin screen over app.access_roster: list members, grant or change a
// member's role and admin flag, remove a member. Guards: the caller must be
// an admin, cannot change their own access, and cannot remove the last admin.
import { Logger } from '@libs/log';
import { AuthzService, type Identity } from '@libs/authz';
import { RosterService, ROLES } from '@libs/roster';
import { AccessRequestsService } from '@libs/access-requests';

export interface RosterMember {
  email: string;
  name: string;
  role: string;
  isAdmin: boolean;
}

export function nameFromEmail(email: string): string {
  return email
    .split('@', 1)[0]!
    .replace(/[._]/g, ' ')
    .replace(/[A-Za-z]+/g, (w) => w[0]!.toUpperCase() + w.slice(1).toLowerCase());
}

export class RosterResolver {
  private readonly log = new Logger(RosterResolver.name);

  constructor(
    private readonly authz: AuthzService,
    private readonly roster: RosterService,
    private readonly accessRequests: AccessRequestsService,
  ) {}

  async accessRoster(_args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<RosterMember[]> {
    await this.authz.requireAdmin(identity);
    const entries = await this.roster.entries();
    return Promise.all(
      entries.map(async (e) => ({
        email: e.email,
        name: await this.displayName(e.email),
        role: e.role,
        isAdmin: e.isAdmin,
      })),
    );
  }

  async updateRosterMember(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<RosterMember> {
    await this.authz.requireAdmin(identity);
    const email = String(args.email ?? '').trim().toLowerCase();
    const role = String(args.role ?? '').trim().toUpperCase();
    const wantAdmin = args.isAdmin as boolean | null | undefined;
    if (!email || !email.includes('@')) throw new Error('a valid email is required');
    if (!ROLES.includes(role)) throw new Error(`unknown role: ${role}`);
    const caller = this.callerEmail(identity);
    if (email === caller) throw new Error('you cannot change your own access');

    const entries = await this.roster.entries();
    const target = entries.find((e) => e.email === email);
    const admins = entries.filter((e) => e.isAdmin);
    const finalAdmin = wantAdmin != null ? Boolean(wantAdmin) : Boolean(target?.isAdmin);
    if (target?.isAdmin && !finalAdmin && admins.length <= 1) throw new Error('keep at least one administrator');

    await this.roster.upsert(email, role, finalAdmin, caller || null);
    await this.accessRequests.clear(email);
    this.log.log(`updateRosterMember email=${email} role=${role} admin=${finalAdmin} by=${caller}`);
    return { email, name: await this.displayName(email), role, isAdmin: finalAdmin };
  }

  async removeRosterMember(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<boolean> {
    await this.authz.requireAdmin(identity);
    const email = String(args.email ?? '').trim().toLowerCase();
    const caller = this.callerEmail(identity);
    if (email === caller) throw new Error('you cannot remove your own access');
    const entries = await this.roster.entries();
    const target = entries.find((e) => e.email === email);
    if (target?.isAdmin && entries.filter((e) => e.isAdmin).length <= 1) {
      throw new Error('keep at least one administrator');
    }
    const removed = await this.roster.remove(email);
    if (removed) this.log.log(`removeRosterMember email=${email} by=${caller}`);
    return removed;
  }

  private callerEmail(identity: Identity | null | undefined): string {
    return identity?.email?.toLowerCase() ?? '';
  }

  private async displayName(email: string): Promise<string> {
    const profile = await this.roster.profileForEmail(email);
    return profile?.name || nameFromEmail(email);
  }
}
