// Access roster: email -> { role, isAdmin }. The single source of truth for
// authz, backed by app.access_roster with a short in-process cache. Admin is
// orthogonal to the role (any role can be admin). An authenticated caller who
// is not on the roster gets no role, which the authz gates treat as blocked.
//
// Roles are a small fixed set the portal owns. Add one here and in the SPA's
// role picker; nothing else enumerates them.
import { Logger } from '@libs/log';
import { AuroraService } from '@libs/aurora';

export const ADMIN = 'ADMINISTRATOR';
export const EDITOR = 'EDITOR';
export const VIEWER = 'VIEWER';

export const ROLES: readonly string[] = [ADMIN, EDITOR, VIEWER];

/** Roles that may change portal data. Admins may regardless of role. */
export const WRITE_ROLES: ReadonlySet<string> = new Set([ADMIN, EDITOR]);

const TTL_MS = 30_000; // bounds cross-instance staleness after a roster edit

export interface RosterEntry {
  role: string;
  isAdmin: boolean;
}

export interface RosterRow {
  email: string;
  role: string;
  isAdmin: boolean;
  updatedBy: string | null;
  updatedAt: string | null;
}

export interface UserProfile {
  email: string;
  name: string | null;
  title: string | null;
}

interface AccessRosterRow {
  email: string;
  role: string;
  is_admin: boolean;
}

export class RosterService {
  private readonly log = new Logger(RosterService.name);

  // Persists across warm Lambda invokes for the process lifetime (the service
  // is a singleton).
  private cache: Map<string, RosterEntry> | null = null;
  private loadedAt = 0;

  constructor(private readonly aurora: AuroraService) {}

  /** Memoized email -> entry from app.access_roster, refreshed past the TTL.
   *  Fail-closed: a read failure propagates (authz denies) rather than serving
   *  a stale list. Without a configured database (local/tests) the roster is
   *  empty; tests stub this service. */
  private async load(): Promise<Map<string, RosterEntry>> {
    if (this.cache !== null && Date.now() - this.loadedAt < TTL_MS) return this.cache;
    if (!process.env.AURORA_CLUSTER_ARN) {
      this.cache = new Map();
      this.loadedAt = Date.now();
      return this.cache;
    }
    const rows = await this.aurora.query<AccessRosterRow>(
      'SELECT lower(email) AS email, role, is_admin FROM app.access_roster',
    );
    if (rows.length === 0) {
      this.log.warn('roster.empty_table: app.access_roster has no rows; seed the first administrator (see README)');
    }
    this.cache = new Map(rows.map((r) => [r.email, { role: r.role, isAdmin: Boolean(r.is_admin) }]));
    this.loadedAt = Date.now();
    return this.cache;
  }

  /** Drop the cache so the next read reflects a just-written change. */
  invalidate(): void {
    this.cache = null;
  }

  async entryForEmail(email: string | null | undefined): Promise<RosterEntry | null> {
    if (!email) return null;
    return (await this.load()).get(email.toLowerCase()) ?? null;
  }

  async roleForEmail(email: string | null | undefined): Promise<string | null> {
    return (await this.entryForEmail(email))?.role ?? null;
  }

  async isAdminForEmail(email: string | null | undefined): Promise<boolean> {
    return (await this.entryForEmail(email))?.isAdmin ?? false;
  }

  /** Display profile from the user registry; null when the person has never
   *  signed in. */
  async profileForEmail(email: string | null | undefined): Promise<UserProfile | null> {
    if (!email) return null;
    const rows = await this.aurora.query<UserProfile>(
      'SELECT lower(email) AS email, name, title FROM app.users WHERE lower(email) = :e LIMIT 1',
      { e: email.toLowerCase() },
    );
    return rows[0] ?? null;
  }

  async entries(): Promise<RosterRow[]> {
    const rows = await this.aurora.query<{
      email: string;
      role: string;
      is_admin: boolean;
      updated_by: string | null;
      updated_at: string | null;
    }>('SELECT lower(email) AS email, role, is_admin, updated_by, updated_at FROM app.access_roster ORDER BY email');
    return rows.map((r) => ({
      email: r.email,
      role: r.role,
      isAdmin: Boolean(r.is_admin),
      updatedBy: r.updated_by,
      updatedAt: r.updated_at,
    }));
  }

  async upsert(email: string, role: string, isAdmin: boolean, by: string | null): Promise<void> {
    if (!ROLES.includes(role)) throw new Error(`unknown role: ${role}`);
    await this.aurora.execute(
      'INSERT INTO app.access_roster (email, role, is_admin, updated_by, updated_at) ' +
        'VALUES (:email, :role, :is_admin, :by, now()) ' +
        'ON CONFLICT (email) DO UPDATE SET role = EXCLUDED.role, is_admin = EXCLUDED.is_admin, ' +
        'updated_by = EXCLUDED.updated_by, updated_at = now()',
      { email: email.toLowerCase(), role, is_admin: isAdmin, by },
    );
    this.invalidate();
  }

  async remove(email: string): Promise<boolean> {
    const rows = await this.aurora.query<{ email: string }>(
      'DELETE FROM app.access_roster WHERE email = :email RETURNING email',
      { email: email.toLowerCase() },
    );
    this.invalidate();
    return rows.length > 0;
  }
}
