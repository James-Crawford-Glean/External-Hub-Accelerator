// The auth path's audit lines: one JSON line per /register outcome and per 401 / 403
// the Lambda issues, with a reason a reader can act on and no token material.
import { route, type RouteDeps } from './lambda';
import { classifyDenial } from './auth/audit';
import type { OAuthConfig } from './auth/config';
import type { CredentialService } from '@libs/credentials';
import type { CreatePoolClientInput, PoolClient, UserPoolClients } from './auth/register';

const cfg: OAuthConfig = {
  publicUrl: 'https://mcp.example.portal.example.com',
  issuer: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_TEST',
  hostedUiUrl: 'https://auth.example.portal.example.com',
  userPoolId: 'us-east-2_TEST',
  resourceIdentifier: 'https://mcp.example.portal.example.com',
  allowedEmailDomain: 'example.com',
  redirectHosts: ['*.example.net'],
};

const b64url = (v: unknown): string => Buffer.from(JSON.stringify(v)).toString('base64url');
const unsignedJwt = (claims: Record<string, unknown>): string => `${b64url({ alg: 'RS256', kid: 'k' })}.${b64url(claims)}.sig`;
const nowS = Math.floor(Date.now() / 1000);

function fakePool(): UserPoolClients {
  const clients: PoolClient[] = [];
  let seq = 0;
  return {
    list: async () => clients.map(({ clientId, clientName }) => ({ clientId, clientName })),
    describe: async (id) => clients.find((c) => c.clientId === id) ?? null,
    create: async (input: CreatePoolClientInput) => {
      const client: PoolClient = {
        clientId: `client-${++seq}`,
        clientName: input.clientName,
        clientSecret: input.generateSecret ? `secret-${seq}` : null,
        callbackUrls: input.callbackUrls,
        createdAt: new Date('2026-10-07T00:00:00Z'),
      };
      clients.push(client);
      return client;
    },
  };
}

const VALID_TOKEN = unsignedJwt({ token_use: 'access', exp: nowS + 600, iss: cfg.issuer, aud: cfg.resourceIdentifier });

function deps(): RouteDeps {
  const pool = fakePool();
  const credentials = {
    verify: async (token: string) =>
      token === VALID_TOKEN ? { kind: 'user' as const, email: 'ops@example.com', sub: 'sub-ops', name: null, scopes: ['read'] } : null,
  } as unknown as CredentialService;
  return { oauth: cfg, credentials: () => credentials, poolClients: () => pool };
}

const post = (path: string, body: unknown, headers: Record<string, string> = {}) => ({
  rawPath: path,
  requestContext: { http: { method: 'POST' } },
  headers: { 'content-type': 'application/json', ...headers },
  body: typeof body === 'string' ? body : JSON.stringify(body),
});

const registration = () => ({
  client_name: 'Glean MCP Host',
  redirect_uris: ['https://host-be.example.net/tools/oauth/verify_code', 'https://host-be.example.net/tools/oauth/other'],
  token_endpoint_auth_method: 'client_secret_post',
});

describe('MCP auth-path audit lines', () => {
  let lines: Array<Record<string, unknown>>;
  let spy: jest.SpyInstance;
  beforeEach(() => {
    lines = [];
    spy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      const text = String(args[0]);
      if (text.startsWith('{')) lines.push(JSON.parse(text));
    });
  });
  afterEach(() => spy.mockRestore());

  const audit = (msg: string) => lines.filter((l) => l.msg === msg);

  it('logs a created registration with the client name and distinct redirect-host count', async () => {
    const d = deps();
    const res = await route(post('/register', registration()), d);
    expect(res.statusCode).toBe(201);
    expect(audit('mcp.register')).toEqual([
      { msg: 'mcp.register', status: 201, outcome: 'created', clientName: 'Glean MCP Host', redirectHosts: 1 },
    ]);
  });

  it('logs a repeat registration as reused', async () => {
    const d = deps();
    await route(post('/register', registration()), d);
    await route(post('/register', registration()), d);
    expect(audit('mcp.register').map((l) => l.outcome)).toEqual(['created', 'reused']);
  });

  it('logs a rejected registration with the RFC 7591 error code', async () => {
    const res = await route(post('/register', { ...registration(), redirect_uris: ['https://attacker.example/cb'] }), deps());
    expect(res.statusCode).toBe(400);
    expect(audit('mcp.register')).toEqual([
      { msg: 'mcp.register', status: 400, outcome: 'rejected', clientName: 'Glean MCP Host', redirectHosts: 1, error: 'invalid_redirect_uri' },
    ]);
  });

  it('logs a body that is not JSON', async () => {
    const res = await route(post('/register', '{not json'), deps());
    expect(res.statusCode).toBe(400);
    expect(audit('mcp.register')).toEqual([
      { msg: 'mcp.register', status: 400, outcome: 'invalid_json', redirectHosts: 0, error: 'invalid_client_metadata' },
    ]);
  });

  it('logs a 401 with no bearer and still answers WWW-Authenticate', async () => {
    const res = await route(post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }), deps());
    expect(res.statusCode).toBe(401);
    expect(res.headers['www-authenticate']).toContain('resource_metadata=');
    expect(audit('mcp.denied')).toEqual([
      { msg: 'mcp.denied', status: 401, method: 'POST', path: '/mcp', reason: 'no_bearer', authMethod: 'none' },
    ]);
  });

  it('classifies an expired access token without logging it', async () => {
    const token = unsignedJwt({ token_use: 'access', exp: nowS - 60, iss: cfg.issuer, aud: cfg.resourceIdentifier });
    const res = await route(post('/mcp', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, { authorization: `Bearer ${token}` }), deps());
    expect(res.statusCode).toBe(401);
    expect(audit('mcp.denied')).toEqual([
      { msg: 'mcp.denied', status: 401, method: 'POST', path: '/mcp', reason: 'token_expired', authMethod: 'oauth_access_token' },
    ]);
    expect(JSON.stringify(lines)).not.toContain(token.split('.')[1]);
  });

  it('classifies a key the Lambda cannot resolve and a token for another audience', async () => {
    const d = deps();
    await route(post('/mcp', {}, { authorization: 'Bearer psk_live_example' }), d);
    const other = unsignedJwt({ token_use: 'access', exp: nowS + 600, iss: cfg.issuer, aud: 'https://other.example.com' });
    await route(post('/mcp', {}, { authorization: `Bearer ${other}` }), d);
    expect(audit('mcp.denied').map((l) => [l.reason, l.authMethod])).toEqual([
      ['api_key_rejected', 'api_key'],
      ['audience_mismatch', 'oauth_access_token'],
    ]);
  });

  it('logs nothing on a verified bearer', async () => {
    const res = await route(post('/mcp', { jsonrpc: '2.0', id: 1, method: 'ping' }, { authorization: `Bearer ${VALID_TOKEN}` }), deps());
    expect(res.statusCode).toBe(200);
    expect(audit('mcp.denied')).toEqual([]);
    expect(audit('mcp.register')).toEqual([]);
  });

  it('logs a 403 on /logos for a key without read scope, naming the principal kind', async () => {
    const res = await route(
      {
        rawPath: '/logos',
        rawQueryString: 'domain=example.com',
        requestContext: { http: { method: 'GET' }, authorizer: { lambda: { kind: 'apiKey', keyId: 'apk_1', scopes: 'write' } } },
        headers: { authorization: 'Bearer psk_live_example' },
      },
      deps(),
    );
    expect(res.statusCode).toBe(403);
    expect(audit('mcp.denied')).toEqual([
      { msg: 'mcp.denied', status: 403, method: 'GET', path: '/logos', reason: 'read_scope_required', authMethod: 'api_key', principal: 'apiKey' },
    ]);
  });
});

describe('classifyDenial', () => {
  const expected = { issuer: cfg.issuer, resourceIdentifier: cfg.resourceIdentifier };
  const now = nowS * 1000;

  it('names the shape it saw: none, key, malformed, id token, access token', () => {
    expect(classifyDenial(null, expected, now)).toEqual({ reason: 'no_bearer', authMethod: 'none' });
    expect(classifyDenial('psk_live_x', expected, now)).toEqual({ reason: 'api_key_rejected', authMethod: 'api_key' });
    expect(classifyDenial('garbage', expected, now)).toEqual({ reason: 'token_malformed', authMethod: 'unknown' });
    expect(classifyDenial(unsignedJwt({ token_use: 'id', exp: nowS + 60, iss: cfg.issuer }), expected, now)).toEqual({
      reason: 'token_rejected',
      authMethod: 'id_token',
    });
  });

  it('orders the checks: expiry, then issuer, then audience, then the verifier verdict', () => {
    const base = { token_use: 'access', exp: nowS + 60, iss: cfg.issuer, aud: cfg.resourceIdentifier };
    expect(classifyDenial(unsignedJwt({ ...base, exp: nowS - 1, iss: 'https://wrong' }), expected, now).reason).toBe('token_expired');
    expect(classifyDenial(unsignedJwt({ ...base, iss: 'https://wrong' }), expected, now).reason).toBe('issuer_mismatch');
    expect(classifyDenial(unsignedJwt({ ...base, aud: ['https://wrong'] }), expected, now).reason).toBe('audience_mismatch');
    expect(classifyDenial(unsignedJwt(base), expected, now).reason).toBe('token_rejected');
  });
});
