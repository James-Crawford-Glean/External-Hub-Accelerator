import { oauthConfigFromEnv } from './config';
import { authorizationServerMetadata, metadataKind, protectedResourceMetadata } from './metadata';

const env = {
  OAUTH_PUBLIC_URL: 'https://mcp.example.portal.example.com/',
  COGNITO_ISSUER: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_TEST',
  OAUTH_HOSTED_UI_URL: 'https://auth.example.portal.example.com',
  COGNITO_USER_POOL_ID: 'us-east-2_TEST',
  OAUTH_REDIRECT_HOSTS: 'debug.example.com, *.example.net',
  ALLOWED_EMAIL_DOMAINS: 'example.com,example.org',
};

describe('oauthConfigFromEnv', () => {
  it('is null without OAUTH_PUBLIC_URL so stacks without OAuth keep the authorizer-only path', () => {
    expect(oauthConfigFromEnv({})).toBeNull();
  });

  it('trims trailing slashes, defaults the resource to the public url, and reads the allowlists from env', () => {
    const cfg = oauthConfigFromEnv(env);
    expect(cfg).toMatchObject({
      publicUrl: 'https://mcp.example.portal.example.com',
      resourceIdentifier: 'https://mcp.example.portal.example.com',
      allowedEmailDomain: 'example.com,example.org',
      redirectHosts: ['debug.example.com', '*.example.net'],
    });
  });
});

describe('authorization server metadata (RFC 8414)', () => {
  const doc = authorizationServerMetadata(oauthConfigFromEnv(env)!);

  it('names us as issuer, Cognito for authorize/token/jwks, and our /register for DCR', () => {
    expect(doc).toMatchObject({
      issuer: 'https://mcp.example.portal.example.com',
      authorization_endpoint: 'https://auth.example.portal.example.com/oauth2/authorize',
      token_endpoint: 'https://auth.example.portal.example.com/oauth2/token',
      jwks_uri: 'https://cognito-idp.us-east-2.amazonaws.com/us-east-2_TEST/.well-known/jwks.json',
      registration_endpoint: 'https://mcp.example.portal.example.com/register',
      code_challenge_methods_supported: ['S256'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
    });
  });

  it('advertises client_secret_post (what Glean pins) and the scopes an admin enters', () => {
    expect(doc.token_endpoint_auth_methods_supported).toContain('client_secret_post');
    expect(doc.scopes_supported).toEqual([
      'openid',
      'email',
      'https://mcp.example.portal.example.com/read',
      'https://mcp.example.portal.example.com/write',
    ]);
  });
});

describe('protected resource metadata (RFC 9728)', () => {
  it('points at the MCP endpoint and lists us as the authorization server', () => {
    expect(protectedResourceMetadata(oauthConfigFromEnv(env)!)).toEqual({
      resource: 'https://mcp.example.portal.example.com/mcp',
      authorization_servers: ['https://mcp.example.portal.example.com'],
      scopes_supported: ['https://mcp.example.portal.example.com/read', 'https://mcp.example.portal.example.com/write'],
      bearer_methods_supported: ['header'],
      resource_name: 'Portal MCP',
    });
  });
});

describe('metadataKind', () => {
  it('recognises both well-known documents, path-suffixed forms, and a stage prefix', () => {
    expect(metadataKind('/.well-known/oauth-authorization-server')).toBe('as');
    expect(metadataKind('/.well-known/oauth-authorization-server/mcp')).toBe('as');
    expect(metadataKind('/live/.well-known/oauth-protected-resource')).toBe('prm');
    expect(metadataKind('/.well-known/oauth-protected-resource/mcp')).toBe('prm');
    expect(metadataKind('/.well-known/openid-configuration')).toBeNull();
    expect(metadataKind('/mcp')).toBeNull();
  });
});
