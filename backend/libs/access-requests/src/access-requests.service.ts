// Pending-access queue: sign-ins that authenticated but resolved to no roster
// role. me() records them so an administrator can approve from the access
// screen; granting a role (roster.upsert) or denying clears the row. Backed by
// app.access_requests.
//
// With no Aurora configured (offline/local/tests) every op is a no-op, so callers
// stay DB-agnostic. AuroraService is constructor-injected.
import { AuroraService } from '@libs/aurora';

export interface AccessRequest {
  email: string;
  name: string | null;
  attempts: number;
  first_seen: string;
  last_seen: string;
}

export class AccessRequestsService {
  constructor(private readonly aurora: AuroraService) {}

  private live(): boolean {
    return Boolean(process.env.AURORA_CLUSTER_ARN);
  }

  /** Upsert a denied login: first sighting inserts, repeats bump attempts +
   *  last_seen. Best-effort — invoked off the auth-denied path; the only guard here
   *  is the offline no-op. */
  async record(email: string | null | undefined, name: string | null | undefined, sub: string | null | undefined): Promise<void> {
    if (!this.live() || !email || !email.trim()) return;
    await this.aurora.execute(
      'INSERT INTO app.access_requests (email, name, sub) VALUES (lower(:email), :name, :sub) ' +
        'ON CONFLICT (email) DO UPDATE SET attempts = access_requests.attempts + 1, ' +
        'last_seen = now(), name = COALESCE(EXCLUDED.name, access_requests.name)',
      { email: email.trim(), name: name ?? null, sub: sub ?? null },
    );
  }

  /** Requests still awaiting a decision — those not yet granted a roster role.
   *  Newest first. */
  async pending(): Promise<AccessRequest[]> {
    if (!this.live()) return [];
    return this.aurora.query<AccessRequest>(
      'SELECT email, name, attempts, first_seen, last_seen FROM app.access_requests ' +
        'WHERE email NOT IN (SELECT email FROM app.access_roster) ORDER BY last_seen DESC',
    );
  }

  /** Drop a request once access is granted (called from roster.upsert). */
  async clear(email: string | null | undefined): Promise<void> {
    await this.delete(email);
  }

  /** Dismiss a request without granting access. */
  async deny(email: string | null | undefined): Promise<void> {
    await this.delete(email);
  }

  private async delete(email: string | null | undefined): Promise<void> {
    if (!this.live() || !email || !email.trim()) return;
    await this.aurora.execute('DELETE FROM app.access_requests WHERE email = lower(:email)', { email: email.trim() });
  }
}
