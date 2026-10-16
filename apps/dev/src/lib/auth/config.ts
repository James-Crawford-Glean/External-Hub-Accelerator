// Auth + API config for the dev portal, populated once at startup from Docusaurus
// siteConfig.customFields (see src/theme/Root.tsx). Docusaurus is webpack, not
// Vite, so there is no import.meta.env — the values are baked into customFields
// at build from the same VITE_* env the deploy workflow injects, and surfaced to
// the non-React auth module through this small store.

export interface DevAuthConfig {
  authority: string;
  clientId: string;
  hostedDomain: string;
  idp: string;
  redirectUri: string;
  graphqlUrl: string;
  baseUrl: string;
}

let cfg: DevAuthConfig = {
  authority: '',
  clientId: '',
  hostedDomain: '',
  idp: 'Google',
  redirectUri: '',
  graphqlUrl: '',
  baseUrl: '/dev/',
};

export function setAuthConfig(next: Partial<DevAuthConfig>): void {
  cfg = { ...cfg, ...next };
  if (!cfg.idp) cfg.idp = 'Google';
  if (!cfg.baseUrl) cfg.baseUrl = '/dev/';
}

export function authConfig(): DevAuthConfig {
  return cfg;
}

/** Auth is enforced once a Cognito pool is configured; otherwise docs browse open
 *  and the Sandbox falls back to a pasted psk_live_* key. Mirrors apps/ps AUTH_ENABLED. */
export function isAuthEnabled(): boolean {
  return cfg.authority.length > 0 && cfg.clientId.length > 0;
}

/** OAuth redirect/return target. Defaults to origin + baseUrl (e.g. https://<env>.<domain_root>/dev/),
 *  which must be registered in the Cognito app client's callback + logout URLs. */
export function redirectUri(): string {
  if (cfg.redirectUri) return cfg.redirectUri;
  const origin = globalThis.location?.origin ?? '';
  return `${origin}${cfg.baseUrl}`;
}
