// Caller identity: JWT claim extractors plus the internal user registry
// (app.users). Every "who" reference in the portal resolves to our own usr_*
// id keyed by email, so an upstream system's user ids never leak into URLs or
// foreign keys. AuroraService is constructor-injected.
import { AuroraService } from '@libs/aurora';
import { genUserId } from './gen-id';

// The identity claims the resolvers receive (authorizer context).
export interface Identity {
  sub?: string | null;
  email?: string | null;
  name?: string | null;
  [k: string]: unknown;
}

/** Optional attributes to seed onto a registry row when first created. */
export interface RegistrySeed {
  name?: string | null;
  title?: string | null;
  source?: string;
}

export interface RegistryUser {
  id: string;
  email: string;
  name: string | null;
  title: string | null;
  is_active: boolean;
}

export class IdentityService {
  constructor(private readonly aurora: AuroraService) {}

  /** Lowercased email from the identity; null when absent. */
  callerEmail(identity: Identity | null | undefined): string | null {
    const raw = identity?.email;
    return raw ? raw.toLowerCase() : null;
  }

  /** Cognito sub from the identity; 'anonymous' when absent. */
  callerSub(identity: Identity | null | undefined): string {
    return identity?.sub || 'anonymous';
  }

  /** Stable caller key: the registry usr_* id when the caller has an email,
   *  else the Cognito sub. Creates the registry row on first sight. */
  async callerId(identity: Identity | null | undefined): Promise<string> {
    const id = await this.resolveUserIdByEmail(this.callerEmail(identity), {
      name: identity?.name ?? null,
      source: 'app_login',
    });
    return id ?? this.callerSub(identity);
  }

  /**
   * Get-or-create the registry id for an email (null when no email). Fills
   * name/title only when the existing row lacks them; never clobbers a value
   * with a blank.
   */
  async resolveUserIdByEmail(email: string | null | undefined, seed: RegistrySeed = {}): Promise<string | null> {
    if (!email) return null;
    const rows = await this.aurora.query<{ id: string }>(
      'INSERT INTO app.users (id, email, name, title, source) ' +
        "VALUES (:id, :email, NULLIF(:name,''), NULLIF(:title,''), NULLIF(:source,'')) " +
        'ON CONFLICT (lower(email)) DO UPDATE SET ' +
        'name = COALESCE(app.users.name, EXCLUDED.name), ' +
        'title = COALESCE(app.users.title, EXCLUDED.title), ' +
        'updated_at = now() ' +
        'RETURNING id',
      {
        id: genUserId(),
        email: email.toLowerCase(),
        name: seed.name ?? '',
        title: seed.title ?? '',
        source: seed.source ?? 'app_login',
      },
    );
    return rows.length ? rows[0]!.id : null;
  }

  /** Get-or-create registry ids for many emails. Returns lower(email) -> usr_*. */
  async bulkResolveByEmail(emails: Array<string | null | undefined>, seed: RegistrySeed = {}): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(emails.filter((e): e is string => Boolean(e)).map((e) => e.toLowerCase()))];
    for (const e of unique) {
      const id = await this.resolveUserIdByEmail(e, seed);
      if (id) out.set(e, id);
    }
    return out;
  }

  async userById(id: string): Promise<RegistryUser | null> {
    const rows = await this.aurora.query<RegistryUser>(
      'SELECT id, email, name, title, is_active FROM app.users WHERE id = :id',
      { id },
    );
    return rows[0] ?? null;
  }

  async userByEmail(email: string | null | undefined): Promise<RegistryUser | null> {
    if (!email) return null;
    const rows = await this.aurora.query<RegistryUser>(
      'SELECT id, email, name, title, is_active FROM app.users WHERE lower(email) = :e LIMIT 1',
      { e: email.toLowerCase() },
    );
    return rows[0] ?? null;
  }

  /** lower(email) for each registry id that exists. */
  async emailsForUserIds(ids: string[]): Promise<Map<string, string>> {
    const out = new Map<string, string>();
    const unique = [...new Set(ids.filter(Boolean))];
    if (unique.length === 0) return out;
    const params: Record<string, string> = {};
    const marks = unique.map((id, i) => {
      params[`i${i}`] = id;
      return `:i${i}`;
    });
    const rows = await this.aurora.query<{ id: string; email: string }>(
      `SELECT id, lower(email) AS email FROM app.users WHERE id IN (${marks.join(',')})`,
      params,
    );
    for (const r of rows) out.set(r.id, r.email);
    return out;
  }
}
