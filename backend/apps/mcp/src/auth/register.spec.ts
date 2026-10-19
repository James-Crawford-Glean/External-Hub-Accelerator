import type { OAuthConfig } from './config';
import {
  cognitoClientName,
  redirectUriAllowed,
  registerClient,
  RegistrationError,
  type CreatePoolClientInput,
  type PoolClient,
  type UserPoolClients,
} from './register';

const cfg: OAuthConfig = {
  publicUrl: 'https://mcp.example.portal.example.com',
  issuer: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_TEST',
  hostedUiUrl: 'https://auth.example.portal.example.com',
  userPoolId: 'us-east-2_TEST',
  resourceIdentifier: 'https://mcp.example.portal.example.com',
  allowedEmailDomain: 'example.com',
  redirectHosts: ['*.example.net', 'debugger.example.org'],
};

const GLEAN_CALLBACK = 'https://host-be.example.net/tools/oauth/verify_code';

/** What Glean's MCP host actually POSTs, including the non-standard `resource`. */
function gleanRequest(): Record<string, unknown> {
  return {
    client_name: 'Glean MCP Host',
    redirect_uris: [GLEAN_CALLBACK],
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    token_endpoint_auth_method: 'client_secret_post',
    resource: 'https://mcp.example.portal.example.com/mcp',
  };
}

function fakePool(existing: PoolClient[] = []): UserPoolClients & { created: CreatePoolClientInput[] } {
  const clients = [...existing];
  const created: CreatePoolClientInput[] = [];
  let seq = 0;
  return {
    created,
    list: async () => clients.map(({ clientId, clientName }) => ({ clientId, clientName })),
    describe: async (id) => clients.find((c) => c.clientId === id) ?? null,
    create: async (input) => {
      created.push(input);
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

describe('registerClient', () => {
  it('mints a confidential client for Glean and echoes RFC 7591 metadata', async () => {
    const pool = fakePool();
    const { response: resp, reused } = await registerClient(gleanRequest(), { cfg, clients: pool });

    expect(reused).toBe(false);
    expect(resp).toMatchObject({
      client_id: 'client-1',
      client_secret: 'secret-1',
      client_secret_expires_at: 0,
      client_id_issued_at: Date.parse('2026-10-07T00:00:00Z') / 1000,
      client_name: 'Glean MCP Host',
      redirect_uris: [GLEAN_CALLBACK],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'client_secret_post',
      scope: 'openid email https://mcp.example.portal.example.com/read https://mcp.example.portal.example.com/write',
    });
    expect(pool.created).toHaveLength(1);
    expect(pool.created[0]).toMatchObject({ generateSecret: true, callbackUrls: [GLEAN_CALLBACK] });
    expect(pool.created[0]?.scopes).toContain('https://mcp.example.portal.example.com/read');
  });

  it('returns the existing client (same id + secret) on a repeat registration', async () => {
    const pool = fakePool();
    const first = await registerClient(gleanRequest(), { cfg, clients: pool });
    const second = await registerClient(gleanRequest(), { cfg, clients: pool });
    expect(second.response.client_id).toBe(first.response.client_id);
    expect(second.response.client_secret).toBe(first.response.client_secret);
    expect(first.reused).toBe(false);
    expect(second.reused).toBe(true);
    expect(pool.created).toHaveLength(1);
  });

  it('mints a distinct client when the redirect set differs', async () => {
    const pool = fakePool();
    await registerClient(gleanRequest(), { cfg, clients: pool });
    await registerClient({ ...gleanRequest(), redirect_uris: ['https://debugger.example.org/oauth/callback'] }, { cfg, clients: pool });
    expect(pool.created).toHaveLength(2);
  });

  it('issues a public client (no secret) for token_endpoint_auth_method none', async () => {
    const pool = fakePool();
    const { response: resp } = await registerClient(
      { client_name: 'debugger', redirect_uris: ['http://localhost:8080/callback'], token_endpoint_auth_method: 'none' },
      { cfg, clients: pool },
    );
    expect(resp.client_secret).toBeUndefined();
    expect(pool.created[0]?.generateSecret).toBe(false);
  });

  it('defaults to client_secret_basic and a generic name when the request omits them', async () => {
    const { response: resp } = await registerClient({ redirect_uris: [GLEAN_CALLBACK] }, { cfg, clients: fakePool() });
    expect(resp.token_endpoint_auth_method).toBe('client_secret_basic');
    expect(resp.client_name).toBe('MCP client');
  });

  it('rejects redirect URIs outside the allowlist', async () => {
    const pool = fakePool();
    await expect(
      registerClient({ ...gleanRequest(), redirect_uris: [GLEAN_CALLBACK, 'https://attacker.example/cb'] }, { cfg, clients: pool }),
    ).rejects.toMatchObject<Partial<RegistrationError>>({ code: 'invalid_redirect_uri' });
    await expect(registerClient({ ...gleanRequest(), redirect_uris: [] }, { cfg, clients: pool })).rejects.toMatchObject({
      code: 'invalid_redirect_uri',
    });
    expect(pool.created).toHaveLength(0);
  });

  it('rejects unsupported grant/response types and auth methods', async () => {
    const pool = fakePool();
    await expect(registerClient({ ...gleanRequest(), grant_types: ['implicit'] }, { cfg, clients: pool })).rejects.toMatchObject(
      { code: 'invalid_client_metadata' },
    );
    await expect(registerClient({ ...gleanRequest(), response_types: ['token'] }, { cfg, clients: pool })).rejects.toMatchObject(
      { code: 'invalid_client_metadata' },
    );
    await expect(
      registerClient({ ...gleanRequest(), token_endpoint_auth_method: 'private_key_jwt' }, { cfg, clients: pool }),
    ).rejects.toMatchObject({ code: 'invalid_client_metadata' });
    await expect(registerClient('nope', { cfg, clients: pool })).rejects.toBeInstanceOf(RegistrationError);
  });
});

describe('redirectUriAllowed', () => {
  const hosts = ['*.example.net', 'debugger.example.org'];
  it('allows https on allowlisted hosts and http on loopback only', () => {
    expect(redirectUriAllowed(GLEAN_CALLBACK, hosts)).toBe(true);
    expect(redirectUriAllowed('https://debugger.example.org/oauth/callback', hosts)).toBe(true);
    expect(redirectUriAllowed('http://localhost:8080/callback', hosts)).toBe(true);
    expect(redirectUriAllowed('http://127.0.0.1:3000/cb', hosts)).toBe(true);
  });
  it('rejects plain http off-loopback, foreign hosts, suffix spoofs, and fragments', () => {
    expect(redirectUriAllowed('http://host-be.example.net/cb', hosts)).toBe(false);
    expect(redirectUriAllowed('https://example.com.evil.tld/cb', hosts)).toBe(false);
    expect(redirectUriAllowed('https://example.com/cb', hosts)).toBe(false);
    expect(redirectUriAllowed('https://xdebugger.example.org/cb', hosts)).toBe(false);
    expect(redirectUriAllowed('https://debugger.example.org/cb#frag', hosts)).toBe(false);
    expect(redirectUriAllowed('not a url', hosts)).toBe(false);
  });
});

describe('cognitoClientName', () => {
  it('is stable for the same tuple regardless of redirect order and fits Cognito limits', () => {
    const a = cognitoClientName({ clientName: 'Glean MCP Host', redirectUris: ['https://a/cb', 'https://b/cb'], authMethod: 'client_secret_post' });
    const b = cognitoClientName({ clientName: 'Glean MCP Host', redirectUris: ['https://b/cb', 'https://a/cb'], authMethod: 'client_secret_post' });
    expect(a).toBe(b);
    expect(a).toMatch(/^dcr-glean-mcp-host-[0-9a-f]{16}$/);
    expect(a.length).toBeLessThanOrEqual(128);
  });
});
