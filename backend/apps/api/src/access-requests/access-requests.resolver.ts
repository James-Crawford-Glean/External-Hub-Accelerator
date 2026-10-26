// Query.accessRequests + Mutation.denyAccessRequest — admin review of denied
// logins. accessRequests lists allowed-domain users who authenticated but
// resolved to no role (captured by users.me via AccessRequestsService). Approval reuses updateRosterMember (assigning a role
// clears the request via roster.upsert); denyAccessRequest dismisses one without
// granting.
import { AuroraService } from '@libs/aurora';
import { AccessRequestsService, type AccessRequest } from '@libs/access-requests';
import { AuthzService, type Identity } from '@libs/authz';

export class AccessRequestsResolver {
  constructor(
    private readonly requests: AccessRequestsService,
    private readonly authz: AuthzService,
  ) {}

  async accessRequests(
    _args: Record<string, unknown>,
    _source: unknown,
    identity: Identity,
  ): Promise<Record<string, unknown>[]> {
    await this.authz.requireAdmin(identity);
    return (await this.requests.pending()).map((r) => this.shape(r));
  }

  async denyAccessRequest(
    args: Record<string, unknown>,
    _source: unknown,
    identity: Identity,
  ): Promise<boolean> {
    await this.authz.requireAdmin(identity);
    const email = ((args.email as string) ?? '').trim().toLowerCase();
    if (!email || !email.includes('@')) {
      throw new Error('a valid email is required');
    }
    await this.requests.deny(email);
    return true;
  }

  private shape(r: AccessRequest): Record<string, unknown> {
    return {
      email: r.email,
      name: r.name || null,
      attempts: Number(r.attempts || 0),
      firstSeen: AuroraService.iso8601(r.first_seen),
      lastSeen: AuroraService.iso8601(r.last_seen),
    };
  }
}
