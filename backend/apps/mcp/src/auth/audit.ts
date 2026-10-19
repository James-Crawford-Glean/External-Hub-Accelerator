// One JSON line per auth-path outcome the Lambda decides: every /register result and
// every 401 / 403 it issues. Together with the HTTP API access log this makes the
// Register and Authorize stages of a host rollout diagnosable from CloudWatch. No
// token material is ever logged; the denial reason is derived from the token's shape
// and unverified claims, which is enough to tell "no token" from "wrong audience"
// without trusting them.
import { isExpired, peekClaims } from '@libs/credentials';

export type AuthMethod = 'none' | 'api_key' | 'oauth_access_token' | 'id_token' | 'jwt' | 'unknown';

export type DenialReason =
  | 'no_bearer'
  | 'api_key_rejected'
  | 'token_malformed'
  | 'token_expired'
  | 'issuer_mismatch'
  | 'audience_mismatch'
  | 'token_rejected';

export type RegisterOutcome = 'created' | 'reused' | 'rejected' | 'invalid_json' | 'method_not_allowed';

export interface RegisterEvent {
  readonly msg: 'mcp.register';
  readonly status: number;
  readonly outcome: RegisterOutcome;
  readonly clientName?: string;
  /** Distinct hostnames across the requested redirect_uris. */
  readonly redirectHosts?: number;
  readonly error?: string;
}

export interface DeniedEvent {
  readonly msg: 'mcp.denied';
  readonly status: 401 | 403;
  readonly method: string;
  readonly path: string;
  readonly reason: DenialReason | 'read_scope_required';
  readonly authMethod: AuthMethod;
  /** Principal kind when one was resolved (403s); absent on a 401. */
  readonly principal?: string;
}

export type AuditEvent = RegisterEvent | DeniedEvent;

export const emitAudit = (event: AuditEvent): void => console.log(JSON.stringify(event));

export interface ExpectedToken {
  readonly issuer: string;
  readonly resourceIdentifier: string;
}

/** The credential type a bearer's shape says it is; never its contents. */
export function authMethodOf(bearer: string | null): AuthMethod {
  if (!bearer) return 'none';
  if (bearer.startsWith('psk_')) return 'api_key';
  const claims = peekClaims(bearer);
  if (!claims) return 'unknown';
  return claims.token_use === 'access' ? 'oauth_access_token' : claims.token_use === 'id' ? 'id_token' : 'jwt';
}

/** Why a bearer failed, from its shape and unverified claims only. */
export function classifyDenial(
  bearer: string | null,
  expected: ExpectedToken,
  nowMs: number = Date.now(),
): { reason: DenialReason; authMethod: AuthMethod } {
  const authMethod = authMethodOf(bearer);
  if (authMethod === 'none') return { reason: 'no_bearer', authMethod };
  if (authMethod === 'api_key') return { reason: 'api_key_rejected', authMethod };
  const claims = peekClaims(bearer as string);
  if (!claims) return { reason: 'token_malformed', authMethod };
  if (isExpired(claims, nowMs)) return { reason: 'token_expired', authMethod };
  if (claims.iss && expected.issuer && claims.iss !== expected.issuer) return { reason: 'issuer_mismatch', authMethod };
  if (authMethod === 'oauth_access_token' && claims.aud !== undefined && !audIncludes(claims.aud, expected.resourceIdentifier)) {
    return { reason: 'audience_mismatch', authMethod };
  }
  return { reason: 'token_rejected', authMethod };
}

const audIncludes = (aud: string | string[], expected: string): boolean =>
  (Array.isArray(aud) ? aud : [aud]).includes(expected);

/** The two registration facts worth logging, read leniently from the raw body. */
export function registrationSummary(body: unknown): { clientName?: string; redirectHosts: number } {
  const req = typeof body === 'object' && body !== null && !Array.isArray(body) ? (body as Record<string, unknown>) : {};
  const clientName = typeof req.client_name === 'string' && req.client_name.trim() ? req.client_name.trim() : undefined;
  const uris = Array.isArray(req.redirect_uris) ? req.redirect_uris.filter((u): u is string => typeof u === 'string') : [];
  const hosts = new Set(uris.map(hostOf).filter((h): h is string => h !== null));
  return { ...(clientName ? { clientName } : {}), redirectHosts: hosts.size };
}

function hostOf(uri: string): string | null {
  try {
    return new URL(uri).host.toLowerCase();
  } catch {
    return null;
  }
}
