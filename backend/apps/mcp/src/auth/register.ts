// RFC 7591 Dynamic Client Registration shim over Cognito's CreateUserPoolClient.
// Cognito has no registration endpoint, and Glean's MCP host only speaks DCR, so we
// mint one app client per (client_name, redirect_uris, auth method) tuple. The
// tuple hashes into the Cognito ClientName, which is how a repeat registration finds
// and returns the existing client instead of minting another. Every minted client is
// confined to the authorization-code flow with PKCE, the Google IdP, and this
// resource server's scopes, so an attacker who can reach /register gains nothing a
// browser visit to the hosted UI would not already give them.
//
// Unknown request fields (Glean sends a non-standard `resource`) are ignored, per
// RFC 7591 §2; rejecting them is what broke another vendor's connector.
import { createHash } from 'node:crypto';
import { resourceScopeIdentifiers, type OAuthConfig } from './config';

export type TokenEndpointAuthMethod = 'client_secret_basic' | 'client_secret_post' | 'none';

const AUTH_METHODS: readonly TokenEndpointAuthMethod[] = ['client_secret_basic', 'client_secret_post', 'none'];
const GRANT_TYPES = ['authorization_code', 'refresh_token'] as const;
const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(['localhost', '127.0.0.1', '[::1]']);
const MAX_REDIRECT_URIS = 10;

export interface RegistrationRequest {
  client_name?: unknown;
  redirect_uris?: unknown;
  grant_types?: unknown;
  response_types?: unknown;
  token_endpoint_auth_method?: unknown;
  scope?: unknown;
}

export interface RegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  client_secret_expires_at?: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: TokenEndpointAuthMethod;
  scope: string;
}

export interface PoolClientSummary {
  clientId: string;
  clientName: string;
}

export interface PoolClient extends PoolClientSummary {
  clientSecret: string | null;
  callbackUrls: string[];
  createdAt: Date | null;
}

export interface CreatePoolClientInput {
  clientName: string;
  callbackUrls: string[];
  generateSecret: boolean;
  scopes: string[];
}

/** The slice of Cognito the shim needs; the container binds it to the SDK. */
export interface UserPoolClients {
  list(): Promise<PoolClientSummary[]>;
  describe(clientId: string): Promise<PoolClient | null>;
  create(input: CreatePoolClientInput): Promise<PoolClient>;
}

export class RegistrationError extends Error {
  constructor(
    readonly code: 'invalid_redirect_uri' | 'invalid_client_metadata',
    readonly description: string,
  ) {
    super(description);
    this.name = 'RegistrationError';
  }
}

interface Deps {
  cfg: OAuthConfig;
  clients: UserPoolClients;
  now?: () => number;
}

export interface RegistrationResult {
  response: RegistrationResponse;
  /** True when the registration tuple matched an existing app client and no client was minted. */
  reused: boolean;
}

export async function registerClient(body: unknown, deps: Deps): Promise<RegistrationResult> {
  const req = parseRequest(body, deps.cfg);
  const clientName = cognitoClientName(req);
  const scopes = ['openid', 'email', ...resourceScopeIdentifiers(deps.cfg)];

  const existing = (await deps.clients.list()).find((c) => c.clientName === clientName);
  const described = existing ? await deps.clients.describe(existing.clientId) : null;
  const client =
    described ??
    (await deps.clients.create({
      clientName,
      callbackUrls: req.redirectUris,
      generateSecret: req.authMethod !== 'none',
      scopes,
    }));

  const issuedAt = Math.floor((client.createdAt?.getTime() ?? (deps.now ?? Date.now)()) / 1000);
  return {
    reused: described !== null,
    response: {
      client_id: client.clientId,
      ...(client.clientSecret ? { client_secret: client.clientSecret, client_secret_expires_at: 0 } : {}),
      client_id_issued_at: issuedAt,
      client_name: req.clientName,
      redirect_uris: req.redirectUris,
      grant_types: [...GRANT_TYPES],
      response_types: ['code'],
      token_endpoint_auth_method: req.authMethod,
      scope: scopes.join(' '),
    },
  };
}

interface ParsedRequest {
  clientName: string;
  redirectUris: string[];
  authMethod: TokenEndpointAuthMethod;
}

function parseRequest(body: unknown, cfg: OAuthConfig): ParsedRequest {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new RegistrationError('invalid_client_metadata', 'request body must be a JSON object');
  }
  const req = body as RegistrationRequest;

  const redirectUris = parseRedirectUris(req.redirect_uris, cfg.redirectHosts);
  const clientName = typeof req.client_name === 'string' && req.client_name.trim() ? req.client_name.trim() : 'MCP client';

  if (req.grant_types !== undefined) {
    const grants = asStringArray(req.grant_types, 'grant_types');
    const unsupported = grants.filter((g) => !(GRANT_TYPES as readonly string[]).includes(g));
    if (unsupported.length || !grants.includes('authorization_code')) {
      throw new RegistrationError('invalid_client_metadata', `grant_types must be a subset of ${GRANT_TYPES.join(', ')} including authorization_code`);
    }
  }
  if (req.response_types !== undefined) {
    const types = asStringArray(req.response_types, 'response_types');
    if (types.length !== 1 || types[0] !== 'code') {
      throw new RegistrationError('invalid_client_metadata', 'response_types must be ["code"]');
    }
  }

  const authMethod = req.token_endpoint_auth_method ?? 'client_secret_basic';
  if (!(AUTH_METHODS as readonly unknown[]).includes(authMethod)) {
    throw new RegistrationError('invalid_client_metadata', `token_endpoint_auth_method must be one of ${AUTH_METHODS.join(', ')}`);
  }

  return { clientName, redirectUris, authMethod: authMethod as TokenEndpointAuthMethod };
}

function parseRedirectUris(raw: unknown, allowedHosts: string[]): string[] {
  const uris = asStringArray(raw, 'redirect_uris');
  if (uris.length === 0) throw new RegistrationError('invalid_redirect_uri', 'redirect_uris is required');
  if (uris.length > MAX_REDIRECT_URIS) {
    throw new RegistrationError('invalid_redirect_uri', `at most ${MAX_REDIRECT_URIS} redirect_uris`);
  }
  const bad = uris.find((u) => !redirectUriAllowed(u, allowedHosts));
  if (bad !== undefined) throw new RegistrationError('invalid_redirect_uri', `redirect_uri not permitted: ${bad}`);
  return [...new Set(uris)];
}

export function redirectUriAllowed(uri: string, allowedHosts: string[]): boolean {
  let url: URL;
  try {
    url = new URL(uri);
  } catch {
    return false;
  }
  if (url.hash || url.username || url.password) return false;
  const host = url.hostname.toLowerCase();
  if (url.protocol === 'http:') return LOOPBACK_HOSTS.has(host) || LOOPBACK_HOSTS.has(url.host);
  if (url.protocol !== 'https:') return false;
  return allowedHosts.some((pattern) => hostMatches(host, pattern));
}

function hostMatches(host: string, pattern: string): boolean {
  if (pattern.startsWith('*.')) {
    const suffix = pattern.slice(1);
    return host.endsWith(suffix) && host.length > suffix.length;
  }
  return host === pattern;
}

function asStringArray(raw: unknown, field: string): string[] {
  if (!Array.isArray(raw) || raw.some((v) => typeof v !== 'string')) {
    throw new RegistrationError(
      field === 'redirect_uris' ? 'invalid_redirect_uri' : 'invalid_client_metadata',
      `${field} must be an array of strings`,
    );
  }
  return raw as string[];
}

/** Cognito ClientName (≤128 chars of [\w\s+=,.@-]) that is stable for a registration
 *  tuple, so the same host re-registering finds its existing client. */
export function cognitoClientName(req: ParsedRequest): string {
  const slug = req.clientName
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'client';
  const digest = createHash('sha256')
    .update(JSON.stringify([req.clientName, [...req.redirectUris].sort(), req.authMethod]))
    .digest('hex')
    .slice(0, 16);
  return `dcr-${slug}-${digest}`;
}
