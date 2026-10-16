// Transport-neutral authorizer core. Reads the bearer out of either an AppSync
// Lambda-authorizer event or an API Gateway v2 REQUEST event, resolves it to a
// Principal via the injected verifier, and returns the response shape that source
// expects. Kept free of AWS clients so it unit-tests with a fake verifier.
import type { Principal } from '@libs/credentials';

type Verify = (bearer: string) => Promise<Principal | null>;

// Authorized results are cacheable by token for this long (AppSync ttlOverride).
// Short so a revoked key stops working promptly; API Gateway caching TTL is set
// separately on its authorizer.
const AUTH_TTL_SECONDS = 60;

interface AppSyncAuthEvent {
  authorizationToken?: string;
}

interface HttpAuthEvent {
  type?: string;
  version?: string;
  identitySource?: string[];
  headers?: Record<string, string | undefined>;
}

interface AppSyncResponse {
  isAuthorized: boolean;
  resolverContext: Record<string, string>;
  ttlOverride: number;
}

interface HttpResponse {
  isAuthorized: boolean;
  context: Record<string, string>;
}

export async function authorize(rawEvent: unknown, verify: Verify): Promise<AppSyncResponse | HttpResponse> {
  const event = (rawEvent ?? {}) as AppSyncAuthEvent & HttpAuthEvent;
  const isAppSync = typeof event.authorizationToken === 'string';
  const bearer = isAppSync ? (event.authorizationToken ?? '') : httpBearer(event);

  const principal = bearer ? await verify(bearer) : null;
  const ctx = principal ? principalContext(principal) : {};

  return isAppSync
    ? { isAuthorized: principal != null, resolverContext: ctx, ttlOverride: principal ? AUTH_TTL_SECONDS : 0 }
    : { isAuthorized: principal != null, context: ctx };
}

/** API Gateway v2 puts the configured identitySource first; fall back to the header. */
function httpBearer(event: HttpAuthEvent): string {
  const fromSource = event.identitySource?.[0];
  if (fromSource) return fromSource;
  const headers = event.headers ?? {};
  return headers.authorization ?? headers.Authorization ?? '';
}

/** Principal → string map for the downstream resolver/handler. Context values must be
 *  strings on both AppSync (resolverContext) and API Gateway (authorizer context). */
function principalContext(p: Principal): Record<string, string> {
  return p.kind === 'user'
    ? { kind: 'user', email: p.email, sub: p.sub, name: p.name ?? '', ...(p.scopes ? { scopes: p.scopes.join(',') } : {}) }
    : { kind: 'apiKey', keyId: p.keyId, scopes: p.scopes.join(',') };
}
