// Server-side authorization. Capability-based: a role plus an orthogonal admin
// flag resolve from the roster by the caller's email.
//
//   requireUser   -> any authenticated caller (per-user self-service)
//   requireRead   -> read scope (keys) or any signed-in user
//   requireWrite  -> admin, or a WRITE_ROLES role, or a key with write/admin scope
//   requireAdmin  -> admin flag (people) or admin scope (keys)
//
// require* throw Unauthorized; the dispatcher turns that into an AppSync error.
//
// Two principal kinds converge here. People arrive as an email identity and
// are resolved against the roster. Machine callers (opaque API keys) arrive
// with `kind: 'apiKey'` plus scopes and are authorized by scope alone. OAuth
// user tokens carry scopes too, which cap what the person's role would allow.
import { RosterService, ROLES, WRITE_ROLES } from '@libs/roster';
import { parseScopes, type Scope } from '@libs/credentials';

/** A caller's visibility capability: their roster role + admin flag. */
export interface Visibility {
  role: string | null;
  isAdmin: boolean;
}

// SQL predicate restricting rows to those the caller may see: admins see all;
// otherwise rows with a NULL visibility role (the default) plus rows whose
// visibility role matches the caller's. The role is validated against the
// fixed ROLES set before inlining, so this is injection-safe and param-free.
export function visibilitySql(v: Visibility, column = 'visibility_role'): string {
  if (v.isAdmin) return 'TRUE';
  if (v.role && ROLES.includes(v.role)) return `(${column} IS NULL OR ${column} = '${v.role}')`;
  return `${column} IS NULL`;
}

export interface Identity {
  email?: string | null;
  sub?: string | null;
  name?: string | null;
  kind?: string;
  keyId?: string;
  scopes?: string | string[];
  [key: string]: unknown;
}

function isApiKey(identity: Identity | null | undefined): boolean {
  return identity?.kind === 'apiKey';
}

function scopesOf(identity: Identity | null | undefined): Scope[] {
  return parseScopes(identity?.scopes);
}

/** An OAuth user token carries explicit scopes that cap what its client was
 *  granted: a read-only grant can never write, whatever the roster says. Users
 *  without scopes (SPA ID tokens) are uncapped. An empty parse is the same as
 *  absent. */
function userLacksWriteScope(identity: Identity | null | undefined): boolean {
  if (isApiKey(identity)) return false;
  const scopes = scopesOf(identity);
  if (scopes.length === 0) return false;
  return !(scopes.includes('write') || scopes.includes('admin'));
}

/** Caller lacks the required capability; surfaced to AppSync via the dispatcher. */
export class Unauthorized extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'Unauthorized';
  }
}

export class AuthzService {
  constructor(private readonly roster: RosterService) {}

  /** Role from the caller's email via the roster, or null. Keys have no roster
   *  role (they carry scopes), so a key principal is always null here. */
  async roleFromIdentity(identity: Identity | null | undefined): Promise<string | null> {
    if (isApiKey(identity)) return null;
    return this.roster.roleForEmail(identity?.email);
  }

  async isAdminFromIdentity(identity: Identity | null | undefined): Promise<boolean> {
    if (isApiKey(identity)) return scopesOf(identity).includes('admin');
    if (userLacksWriteScope(identity)) return false;
    return this.roster.isAdminForEmail(identity?.email);
  }

  async canWrite(identity: Identity | null | undefined): Promise<boolean> {
    if (isApiKey(identity)) {
      const scopes = scopesOf(identity);
      return scopes.includes('write') || scopes.includes('admin');
    }
    if (userLacksWriteScope(identity)) return false;
    if (await this.isAdminFromIdentity(identity)) return true;
    const role = await this.roleFromIdentity(identity);
    return role !== null && WRITE_ROLES.has(role);
  }

  /** Any authenticated caller. The authorizer already gated entry; this asserts
   *  a real principal is present (a signed-in user, or a key, which always
   *  carries at least read). */
  requireUser(identity: Identity | null | undefined): void {
    if (isApiKey(identity)) return;
    const ident = identity ?? {};
    if (!(ident.email || ident.sub)) throw new Unauthorized('not authorized: requires a signed-in user');
  }

  requireRead(identity: Identity | null | undefined): void {
    const scopes = scopesOf(identity);
    if (scopes.includes('read') || scopes.includes('admin')) return;
    if (isApiKey(identity)) throw new Unauthorized('not authorized: requires read scope');
    this.requireUser(identity);
  }

  async requireWrite(identity: Identity | null | undefined): Promise<void> {
    if (!(await this.canWrite(identity))) {
      throw new Unauthorized('not authorized: requires write access (administrator or editor)');
    }
  }

  async requireAdmin(identity: Identity | null | undefined): Promise<void> {
    if (!(await this.isAdminFromIdentity(identity))) {
      throw new Unauthorized('not authorized: requires administrator');
    }
  }

  /** The caller's visibility capability, for row-level gating: pass to
   *  visibilitySql to scope reads, or check against a fetched row's visibility
   *  role with canAccess before a write. */
  async visibilityFor(identity: Identity | null | undefined): Promise<Visibility> {
    if (isApiKey(identity)) return { role: null, isAdmin: scopesOf(identity).includes('admin') };
    // Visibility is what the person may see; the scope cap only limits what
    // they may change, so admin resolves from the roster directly here.
    const [role, isAdmin] = await Promise.all([
      this.roleFromIdentity(identity),
      this.roster.isAdminForEmail(identity?.email),
    ]);
    return { role, isAdmin };
  }

  /** Whether a caller may access a row given that row's visibility role.
   *  Mirrors visibilitySql for the single-row case. */
  canAccess(v: Visibility, visibilityRole: string | null | undefined): boolean {
    if (v.isAdmin) return true;
    if (visibilityRole == null) return true;
    return v.role != null && v.role === visibilityRole;
  }
}
