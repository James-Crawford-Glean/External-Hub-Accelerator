// RFC 8414 authorization-server metadata and RFC 9728 protected-resource metadata.
// We publish the AS document ourselves (issuer = our host) because Cognito has no
// registration endpoint: authorize/token/jwks point at Cognito, `registration_endpoint`
// points back at our /register shim. MCP hosts discover the AS document at our origin
// before they ever send a bearer, so this is the first thing Glean reads.
import { resourceScopeIdentifiers, type OAuthConfig } from './config';

export const AS_METADATA_PATH = '/.well-known/oauth-authorization-server';
export const PRM_PATH = '/.well-known/oauth-protected-resource';
export const REGISTRATION_PATH = '/register';
export const MCP_PATH = '/mcp';

export function authorizationServerMetadata(cfg: OAuthConfig): Record<string, unknown> {
  return {
    issuer: cfg.publicUrl,
    authorization_endpoint: `${cfg.hostedUiUrl}/oauth2/authorize`,
    token_endpoint: `${cfg.hostedUiUrl}/oauth2/token`,
    revocation_endpoint: `${cfg.hostedUiUrl}/oauth2/revoke`,
    jwks_uri: `${cfg.issuer}/.well-known/jwks.json`,
    registration_endpoint: `${cfg.publicUrl}${REGISTRATION_PATH}`,
    scopes_supported: ['openid', 'email', ...resourceScopeIdentifiers(cfg)],
    response_types_supported: ['code'],
    response_modes_supported: ['query'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    code_challenge_methods_supported: ['S256'],
    token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
    revocation_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic', 'none'],
  };
}

export function protectedResourceMetadata(cfg: OAuthConfig): Record<string, unknown> {
  return {
    resource: resourceUri(cfg),
    authorization_servers: [cfg.publicUrl],
    scopes_supported: resourceScopeIdentifiers(cfg),
    bearer_methods_supported: ['header'],
    resource_name: `${process.env.PORTAL_NAME || 'Portal'} MCP`,
  };
}

export function resourceUri(cfg: Pick<OAuthConfig, 'publicUrl'>): string {
  return `${cfg.publicUrl}${MCP_PATH}`;
}

export function protectedResourceMetadataUrl(cfg: Pick<OAuthConfig, 'publicUrl'>): string {
  return `${cfg.publicUrl}${PRM_PATH}`;
}

/** RFC 9728 lets the PRM live at `/.well-known/oauth-protected-resource/<path>`, and
 *  RFC 8414 likewise for the AS document; both spellings resolve to the same body.
 *  A stage prefix ahead of `/.well-known/` (raw execute-api URL) is tolerated. */
export function metadataKind(rawPath: string): 'as' | 'prm' | null {
  const at = rawPath.indexOf('/.well-known/');
  if (at < 0) return null;
  const path = rawPath.slice(at);
  if (path === AS_METADATA_PATH || path.startsWith(`${AS_METADATA_PATH}/`)) return 'as';
  if (path === PRM_PATH || path.startsWith(`${PRM_PATH}/`)) return 'prm';
  return null;
}
