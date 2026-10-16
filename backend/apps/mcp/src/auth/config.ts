// OAuth resource-server settings for the MCP Lambda, read once from the environment.
// `null` when OAUTH_PUBLIC_URL is unset, which the Terraform module never does; the
// branch exists for local runs without OAuth.

export interface OAuthConfig {
  /** Canonical https origin MCP hosts reach us at; also the RFC 9728 resource URI. */
  publicUrl: string;
  /** Cognito pool issuer (`https://cognito-idp.<region>.amazonaws.com/<pool>`). */
  issuer: string;
  /** Cognito hosted-UI origin that serves /oauth2/authorize, /oauth2/token, /oauth2/revoke. */
  hostedUiUrl: string;
  userPoolId: string;
  /** Cognito resource-server identifier; scopes are `<resourceIdentifier>/read|write`. */
  resourceIdentifier: string;
  allowedEmailDomain: string | undefined; // comma-separated; undefined = any domain the pool admitted
  /** Hostnames (exact, or `*.suffix`) a DCR client may register https redirect URIs on.
   *  From OAUTH_REDIRECT_HOSTS; an MCP host such as Glean needs its callback host listed. */
  redirectHosts: string[];
}

export function oauthConfigFromEnv(env: NodeJS.ProcessEnv = process.env): OAuthConfig | null {
  const publicUrl = trimSlash(env.OAUTH_PUBLIC_URL ?? '');
  if (!publicUrl) return null;
  return {
    publicUrl,
    issuer: trimSlash(env.COGNITO_ISSUER ?? ''),
    hostedUiUrl: trimSlash(env.OAUTH_HOSTED_UI_URL ?? ''),
    userPoolId: env.COGNITO_USER_POOL_ID ?? '',
    resourceIdentifier: trimSlash(env.OAUTH_RESOURCE_IDENTIFIER ?? '') || publicUrl,
    allowedEmailDomain: env.ALLOWED_EMAIL_DOMAINS || undefined,
    redirectHosts: (env.OAUTH_REDIRECT_HOSTS ?? '')
      .split(',')
      .map((h) => h.trim().toLowerCase())
      .filter(Boolean),
  };
}

export function resourceScopeIdentifiers(cfg: Pick<OAuthConfig, 'resourceIdentifier'>): string[] {
  return ['read', 'write'].map((s) => `${cfg.resourceIdentifier}/${s}`);
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}
