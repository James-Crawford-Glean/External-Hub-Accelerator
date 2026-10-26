// Mutation.recordLogin + Query.loginActivity.
// recordLogin appends one interactive-login audit row for the caller (SPA
// onSigninCallback, once per completed Cognito sign-in — silent renews/reloads skip
// it, so each row is one real re-auth); best-effort, caller-self, failures never
// surface. loginActivity is the admin-only paginated read of that audit, querying
// app.login_events directly (inline WHERE + count(*) OVER()) as the Python does.
import { AuroraService, type Params } from '@libs/aurora';
import { AuthzService, type Identity } from '@libs/authz';
import { IdentityService } from '@libs/identity';
import { LoginEventsService } from '@libs/login-events';
import { paginate } from '@libs/sql';

export class LoginEventsResolver {
  constructor(
    private readonly aurora: AuroraService,
    private readonly events: LoginEventsService,
    private readonly authz: AuthzService,
    private readonly identity: IdentityService,
  ) {}

  async recordLogin(
    args: Record<string, unknown>,
    _source: unknown,
    identity: Identity,
  ): Promise<boolean> {
    const email = this.identity.callerEmail(identity);
    if (!email) return false;
    await this.events.record(email, this.identity.callerSub(identity), args.userAgent as string | undefined);
    return true;
  }

  async loginActivity(
    args: Record<string, unknown>,
    _source: unknown,
    identity: Identity,
  ): Promise<{ items: Record<string, unknown>[]; total: number }> {
    await this.authz.requireAdmin(identity);
    const clauses: string[] = [];
    const params: Params = {};
    const q = ((args.search as string) ?? '').trim();
    if (q) {
      params.q = `%${q}%`;
      clauses.push('email ILIKE :q');
    }
    const frm = ((args.from as string) ?? '').trim();
    if (frm) {
      params.frm = frm;
      clauses.push('created_at >= :frm::timestamptz');
    }
    const to = ((args.to as string) ?? '').trim();
    if (to) {
      params.to = to;
      clauses.push('created_at <= :to::timestamptz');
    }
    const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
    paginate(args as { limit?: number | null; offset?: number | null }, params, { def: 50, maxLimit: 200 });
    const rows = await this.aurora.query<Record<string, any>>(
      'SELECT id, email, user_agent, created_at, count(*) OVER() AS total ' +
        `FROM app.login_events${where} ORDER BY created_at DESC LIMIT :lim OFFSET :off`,
      params,
    );
    const total = rows.length ? Number(rows[0].total) : 0;
    return { items: rows.map((r) => this.shape(r)), total };
  }

  private shape(r: Record<string, any>): Record<string, unknown> {
    return {
      id: String(r.id),
      email: r.email,
      userAgent: r.user_agent || null,
      createdAt: AuroraService.iso8601(r.created_at),
    };
  }
}
