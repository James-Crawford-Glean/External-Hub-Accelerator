// MCP server: API Gateway HTTP entry point. Stateless Streamable-HTTP
// transport: a POST carries a JSON-RPC MCP request, GET /health is a liveness probe.
// Mirrors apps/stream's API Gateway proxy event handling, but plain request/response
// JSON rather than SSE. esbuild auto-discovers this entry -> dist/mcp/index.js.
//
// Two auth paths coexist. The gateway authorizer (opaque keys, Cognito JWTs) hands us a
// resolved principal in requestContext.authorizer.lambda. When OAuth is configured and
// no such context arrives — the authorizer has been detached from the route — we verify
// the bearer ourselves so we can answer 401 + WWW-Authenticate, which the gateway's
// fixed 403 cannot, and serve the OAuth discovery / registration endpoints MCP hosts
// need before they hold a token.
import { handleRpc, type JsonRpcRequest } from './mcp/server';
import { handleLogoRequest } from './logo-route';
import { authz, credentials, logos, oauth, poolClients } from './container';
import type { Identity } from '@libs/authz';
import type { CredentialService } from '@libs/credentials';
import type { OAuthConfig } from './auth/config';
import { authorizationServerMetadata, metadataKind, protectedResourceMetadata, REGISTRATION_PATH } from './auth/metadata';
import { registerClient, RegistrationError, type UserPoolClients } from './auth/register';
import { bearerFrom, unauthorized } from './auth/http';
import { authMethodOf, classifyDenial, emitAudit, registrationSummary, type RegisterEvent } from './auth/audit';

// Accepts both API Gateway HTTP API (v2) and REST proxy event shapes.
interface ProxyEvent {
  body?: string | null;
  isBase64Encoded?: boolean;
  rawPath?: string;
  rawQueryString?: string;
  path?: string;
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  queryStringParameters?: Record<string, string | undefined>;
  requestContext?: { http?: { method?: string }; authorizer?: { lambda?: Record<string, unknown> } };
  warmup?: boolean;
}

interface ProxyResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const JSON_HEADERS: Record<string, string> = { 'content-type': 'application/json' };

function methodOf(e: ProxyEvent): string {
  return (e.requestContext?.http?.method ?? e.httpMethod ?? 'POST').toUpperCase();
}

function pathOf(e: ProxyEvent): string {
  return e.rawPath ?? e.path ?? '/';
}

function readBody(e: ProxyEvent): string {
  const raw = e.body ?? '';
  return e.isBase64Encoded && raw ? Buffer.from(raw, 'base64').toString('utf8') : raw;
}

function queryOf(e: ProxyEvent): URLSearchParams {
  if (e.rawQueryString != null) return new URLSearchParams(e.rawQueryString);
  const entries = Object.entries(e.queryStringParameters ?? {}).flatMap(([key, value]): [string, string][] =>
    value == null ? [] : [[key, value]],
  );
  return new URLSearchParams(entries);
}

function json(statusCode: number, payload: unknown): ProxyResult {
  return { statusCode, headers: { ...JSON_HEADERS }, body: JSON.stringify(payload) };
}

// The authorizer's resolved principal arrives in requestContext.authorizer.lambda
// (HTTP API v2 simple response); the in-Lambda verifier produces the same shape.
// Glean's static-key integration forwards the acting user as x-user-email, which wins
// for owner attribution on a key identity. A user identity (Cognito token) is the
// user; the header never overrides a token-bound email.
export function identityFrom(e: ProxyEvent, ctx: Record<string, unknown> = e.requestContext?.authorizer?.lambda ?? {}): Identity {
  const headers = e.headers ?? {};
  const tokenEmail = typeof ctx.email === 'string' && ctx.email ? ctx.email : undefined;
  // No fallback identity: a write with no acting user must fail rather than be
  // attributed to a shared account.
  const email = ctx.kind === 'user' && tokenEmail ? tokenEmail : (headers['x-user-email'] ?? tokenEmail);
  return {
    kind: typeof ctx.kind === 'string' ? ctx.kind : undefined,
    keyId: typeof ctx.keyId === 'string' ? ctx.keyId : undefined,
    scopes: typeof ctx.scopes === 'string' ? ctx.scopes : undefined,
    email: email ?? null,
    sub: typeof ctx.sub === 'string' ? ctx.sub : null,
  };
}

export interface RouteDeps {
  oauth: OAuthConfig | null;
  credentials: () => CredentialService | null;
  poolClients: () => UserPoolClients;
}

function defaultDeps(): RouteDeps {
  return { oauth: oauth(), credentials, poolClients };
}

/** Principal for the call: the gateway authorizer's context when present, else (OAuth
 *  on) the verified bearer. `null` means deny. `undefined` means no gate applies, which
 *  is only the case for stacks that have not enabled OAuth. */
async function principalContext(
  event: ProxyEvent,
  deps: RouteDeps,
): Promise<Record<string, unknown> | null | undefined> {
  const ctx = event.requestContext?.authorizer?.lambda;
  if (ctx && typeof ctx.kind === 'string') return ctx;
  if (!deps.oauth) return undefined;
  const token = bearerFrom(event.headers);
  const principal = token ? await deps.credentials()?.verify(token) : null;
  if (!principal) return null;
  return principal.kind === 'user'
    ? { kind: 'user', email: principal.email, sub: principal.sub, scopes: principal.scopes?.join(',') }
    : { kind: 'apiKey', keyId: principal.keyId, scopes: principal.scopes.join(',') };
}

async function routeOAuth(method: string, path: string, event: ProxyEvent, deps: RouteDeps): Promise<ProxyResult | null> {
  const cfg = deps.oauth;
  if (!cfg) return null;
  const kind = metadataKind(path);
  if (method === 'GET' && kind === 'as') return json(200, authorizationServerMetadata(cfg));
  if (method === 'GET' && kind === 'prm') return json(200, protectedResourceMetadata(cfg));
  if (path === REGISTRATION_PATH || path.endsWith(REGISTRATION_PATH)) {
    const registered = (status: number, outcome: RegisterEvent['outcome'], body: unknown, error?: string): void =>
      emitAudit({ msg: 'mcp.register', status, outcome, ...registrationSummary(body), ...(error ? { error } : {}) });
    if (method !== 'POST') {
      registered(405, 'method_not_allowed', null);
      return json(405, { error: 'method not allowed' });
    }
    let body: unknown;
    try {
      body = JSON.parse(readBody(event) || '{}');
    } catch {
      registered(400, 'invalid_json', null, 'invalid_client_metadata');
      return json(400, { error: 'invalid_client_metadata', error_description: 'body is not valid JSON' });
    }
    try {
      const { response, reused } = await registerClient(body, { cfg, clients: deps.poolClients() });
      registered(201, reused ? 'reused' : 'created', body);
      return json(201, response);
    } catch (e) {
      if (e instanceof RegistrationError) {
        registered(400, 'rejected', body, e.code);
        return json(400, { error: e.code, error_description: e.description });
      }
      throw e;
    }
  }
  return null;
}

/** Testable core: route one proxy event to a proxy result. */
export async function route(event: ProxyEvent, deps: RouteDeps = defaultDeps()): Promise<ProxyResult> {
  const method = methodOf(event);
  const path = pathOf(event);

  if (method === 'GET' && path.endsWith('/health')) {
    return json(200, { status: 'ok', server: 'mcp' });
  }
  const open = await routeOAuth(method, path, event, deps);
  if (open) return open;

  const ctx = await principalContext(event, deps);
  if (ctx === null && deps.oauth) {
    emitAudit({ msg: 'mcp.denied', status: 401, method, path, ...classifyDenial(bearerFrom(event.headers), deps.oauth) });
    return unauthorized(deps.oauth);
  }
  const identity = identityFrom(event, ctx ?? {});

  if (method === 'GET' && path.endsWith('/logos')) {
    const result = await handleLogoRequest(queryOf(event), identity, {
      logos: logos(),
      authz: authz(),
      cdnOrigin: process.env.LOGO_CDN_ORIGIN ?? '',
    });
    if (result.statusCode === 403) {
      emitAudit({
        msg: 'mcp.denied',
        status: 403,
        method,
        path,
        reason: 'read_scope_required',
        authMethod: authMethodOf(bearerFrom(event.headers)),
        ...(identity.kind ? { principal: identity.kind } : {}),
      });
    }
    return result;
  }
  if (method !== 'POST') {
    return json(405, { error: 'method not allowed' });
  }

  let req: JsonRpcRequest;
  try {
    req = JSON.parse(readBody(event)) as JsonRpcRequest;
  } catch {
    return json(200, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'parse error' } });
  }

  const response = await handleRpc(req, { identity });
  // Notifications (no id) get accepted-with-no-body per Streamable HTTP.
  if (response === null) return { statusCode: 202, headers: { ...JSON_HEADERS }, body: '' };
  return json(200, response);
}

export async function handler(event: unknown): Promise<ProxyResult> {
  // Warmer ping parity with the other apps: return before any real work.
  if ((event as ProxyEvent)?.warmup === true) return json(200, { warmed: true });
  try {
    return await route((event ?? {}) as ProxyEvent);
  } catch (e) {
    return json(500, { error: e instanceof Error ? e.message : 'internal error' });
  }
}
