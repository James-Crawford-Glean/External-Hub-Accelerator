// Interactive-login audit: one row per completed Cognito sign-in (SPA
// onSigninCallback -> Mutation.recordLogin). Silent renews and page reloads
// don't record, so each row is a genuine re-auth. Backed by app.login_events;
// the query helpers read the same table for the admin surfaces.
//
// With no Aurora configured (offline/local/tests) record is a no-op, so callers stay
// DB-agnostic. AuroraService is constructor-injected.
import { AuroraService } from '@libs/aurora';

const UA_MAX = 512;

export interface LoginEvent {
  email: string;
  sub: string | null;
  user_agent: string | null;
  created_at: string;
}

export class LoginEventsService {
  constructor(private readonly aurora: AuroraService) {}

  private live(): boolean {
    return Boolean(process.env.AURORA_CLUSTER_ARN);
  }

  /** Append one interactive-login row. Best-effort — called off the sign-in path;
   *  the only guard here is the offline no-op. user_agent is capped to keep rows
   *  bounded (empty -> null). */
  async record(email: string | null | undefined, sub: string | null | undefined, userAgent: string | null | undefined): Promise<void> {
    if (!this.live() || !email || !email.trim()) return;
    const ua = (userAgent ?? '').trim().slice(0, UA_MAX) || null;
    await this.aurora.execute(
      'INSERT INTO app.login_events (email, sub, user_agent) VALUES (lower(:email), :sub, :ua)',
      { email: email.trim(), sub: sub ?? null, ua },
    );
  }

  /** Most recent interactive logins across all users, newest first. */
  async recent(limit = 100): Promise<LoginEvent[]> {
    if (!this.live()) return [];
    return this.aurora.query<LoginEvent>(
      'SELECT email, sub, user_agent, created_at FROM app.login_events ORDER BY created_at DESC LIMIT :limit',
      { limit },
    );
  }

  /** Most recent interactive logins for one email (case-insensitive), newest first. */
  async forEmail(email: string | null | undefined, limit = 100): Promise<LoginEvent[]> {
    if (!this.live() || !email || !email.trim()) return [];
    return this.aurora.query<LoginEvent>(
      'SELECT email, sub, user_agent, created_at FROM app.login_events ' +
        'WHERE email = lower(:email) ORDER BY created_at DESC LIMIT :limit',
      { email: email.trim(), limit },
    );
  }

  /** Total interactive-login count for one email (case-insensitive). */
  async countForEmail(email: string | null | undefined): Promise<number> {
    if (!this.live() || !email || !email.trim()) return 0;
    const rows = await this.aurora.query<{ n: number }>(
      'SELECT count(*)::int AS n FROM app.login_events WHERE email = lower(:email)',
      { email: email.trim() },
    );
    return rows.length ? Number(rows[0]!.n) : 0;
  }
}
