// Query.gleanConnection / Mutation.glean* — per-user Glean OAuth (public DCR
// client + PKCE). Port of resolvers/glean.py. Connect/status/disconnect are
// per-user (any signed-in caller manages their own token custody);
// gleanSetEndpoint switches the shared tenant and stays admin-only. Tokens are
// stored server-side keyed by the caller's SF user id; the SPA never sees a
// Glean token.
//
// gleanToken() is the internal token RPC for the glean-stream Node proxy (direct
// invoke, not AppSync). It is registered under the key 'op:glean_token' — it
// returns a live { access_token, base } for the asserted caller, refreshing if
// needed. Trusts the caller-asserted email/sub (IAM gates who can invoke).
//
// Error-code contract: GleanService throws GleanError{code}. The streaming proxy
// forwards that code structurally over SSE, but this AppSync Lambda data source
// only surfaces the error *message* to the SPA (no VTL to attach extensions), so
// the code rides in the message and the SPA maps it via gleanCodeFromMessage.
import { Logger } from '@libs/log';
import { GleanService, type GleanConnection } from '@libs/glean';
import { WorkerService } from '@libs/worker';
import { AuthzService, type Identity } from '@libs/authz';

export class GleanResolver {
  private readonly log = new Logger(GleanResolver.name);

  constructor(
    private readonly glean: GleanService,
    private readonly worker: WorkerService,
    private readonly authz: AuthzService,
  ) {}

  private ownerId(identity: Identity | null | undefined): Promise<string> {
    const ident = identity ?? {};
    return this.glean.ownerId(ident.email, ident.sub);
  }

  async gleanConnection(
    _args: Record<string, any>,
    _source: unknown,
    identity: Identity,
  ): Promise<GleanConnection> {
    this.authz.requireUser(identity);
    return this.glean.connection(await this.ownerId(identity));
  }

  async gleanBeginConnect(
    args: Record<string, any>,
    _source: unknown,
    identity: Identity,
  ): Promise<{ url: string }> {
    this.authz.requireUser(identity);
    const url = await this.glean.begin(await this.ownerId(identity), args.redirectUri);
    return { url };
  }

  async gleanCompleteConnect(
    args: Record<string, any>,
    _source: unknown,
    identity: Identity,
  ): Promise<GleanConnection> {
    this.authz.requireUser(identity);
    const owner = await this.ownerId(identity);
    const conn = await this.glean.complete(owner, args.code, args.state);
    await this.dispatchSelfAvatarSync(owner);
    return conn;
  }

  // On connect, sync ONLY the connecting user's own avatar, via the decoupled avatar-sync
  // worker in "self" mode. Doing it inline/fire-and-forget in this API lambda is unreliable:
  // the runtime freezes the execution environment the instant the connect response returns,
  // suspending any in-flight Glean fetch until its wall-clock abort timer trips on thaw
  // (observed as glean.avatar_sync_failed TimeoutError). invokeAsync is a fast Event dispatch
  // that never throws, so it can neither delay nor fail the connect. Bulk directory sync
  // stays an explicit admin action (AvatarsResolver.triggerAvatarSync).
  private async dispatchSelfAvatarSync(owner: string): Promise<void> {
    const fn = process.env.AVATAR_SYNC_FUNCTION ?? '';
    if (!fn) {
      this.log.warn('glean.avatar_sync_skipped reason=no_function');
      return;
    }
    await this.worker.invokeAsync(fn, { ownerUserId: owner, self: true });
  }

  async gleanDisconnect(
    _args: Record<string, any>,
    _source: unknown,
    identity: Identity,
  ): Promise<GleanConnection> {
    this.authz.requireUser(identity);
    const owner = await this.ownerId(identity);
    await this.glean.disconnect(owner);
    this.log.log(`glean.disconnect owner=${owner}`);
    return this.glean.connection(owner);
  }

  async gleanSetEndpoint(
    args: Record<string, any>,
    _source: unknown,
    identity: Identity,
  ): Promise<GleanConnection> {
    await this.authz.requireAdmin(identity);
    await this.glean.setEndpoint(args.baseUrl, identity?.email ?? null);
    return this.glean.connection(await this.ownerId(identity));
  }

  // Internal token RPC (direct invoke, registered under 'op:glean_token'). Returns
  // a live token + base for the asserted caller; mirrors handler._glean_token.
  async gleanToken(
    args: Record<string, any>,
    _source: unknown,
    _identity: Identity,
  ): Promise<{ access_token: string; base: string }> {
    const owner = await this.glean.ownerId(args.email, args.sub);
    const [access_token, base] = await this.glean.accessToken(owner);
    return { access_token, base };
  }
}
