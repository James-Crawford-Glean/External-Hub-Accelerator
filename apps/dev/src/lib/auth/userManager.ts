// Single oidc-client-ts UserManager for the dev portal, shared by the React
// layer (react-oidc-context, via AuthGate) and the Sandbox's Bearer injection
// (getIdToken). Lazy so it's only constructed client-side, after Root has
// populated the config store from Docusaurus customFields — never during SSR.
//
// Mirrors apps/ps/src/lib/auth/userManager.ts; the only difference is config
// source (the module store in ./config, not Vite's import.meta.env).

import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { authConfig, redirectUri } from './config';

let manager: UserManager | null = null;

export function getUserManager(): UserManager {
  if (!manager) {
    const c = authConfig();
    const redirect = redirectUri();
    manager = new UserManager({
      authority: c.authority,
      client_id: c.clientId,
      redirect_uri: redirect,
      post_logout_redirect_uri: redirect,
      response_type: 'code', // Authorization Code + PKCE (public client, no secret)
      scope: 'openid email profile',
      userStore: new WebStorageStateStore({ store: window.localStorage }),
      automaticSilentRenew: true,
      // Pin the hosted-UI endpoints to the hosted domain instead of trusting
      // Cognito's discovery doc, which always advertises the prefix domain even
      // when a white-label custom domain is active. issuer + jwks stay on
      // cognito-idp (the token issuer never changes), so validation is
      // unaffected — this only brands the browser-visible URLs.
      ...(c.hostedDomain
        ? {
            metadata: {
              issuer: c.authority,
              authorization_endpoint: `https://${c.hostedDomain}/oauth2/authorize`,
              token_endpoint: `https://${c.hostedDomain}/oauth2/token`,
              userinfo_endpoint: `https://${c.hostedDomain}/oauth2/userInfo`,
              end_session_endpoint: `https://${c.hostedDomain}/logout`,
              jwks_uri: `${c.authority}/.well-known/jwks.json`,
            },
          }
        : {}),
      // Skip the Cognito chooser — straight to the configured IdP. Empty string
      // omits the param so the hosted-UI chooser shows instead.
      ...(c.idp ? { extraQueryParams: { identity_provider: c.idp } } : {}),
    });
    // A background token refresh can fail transiently (network blip, momentary
    // token-endpoint error) — bouncing straight to a full sign-in on the first
    // failure logs the user out needlessly (and repeatedly, if it's flaky).
    // Retry silently once; only redirect if that also fails, i.e. the refresh
    // token is genuinely expired/revoked. Guarded so overlapping renew errors
    // don't stack retries.
    let renewRetrying = false;
    manager.events.addSilentRenewError(async () => {
      if (renewRetrying) return;
      renewRetrying = true;
      try {
        await manager!.signinSilent();
      } catch {
        void login();
      } finally {
        renewRetrying = false;
      }
    });
  }
  return manager;
}

/** Current ID token, refreshing via the refresh token if expired. Null if not signed in. */
export async function getIdToken(): Promise<string | null> {
  const um = getUserManager();
  let user: User | null = await um.getUser();
  if (!user || user.expired) {
    try {
      user = await um.signinSilent();
    } catch {
      return null;
    }
  }
  return user?.id_token ?? null;
}

export function login(): Promise<void> {
  return getUserManager().signinRedirect();
}

/**
 * Sign out locally and end the Cognito hosted-UI session. Cognito doesn't
 * implement OIDC RP-initiated logout, so we hit its /logout endpoint directly.
 */
export async function logout(): Promise<void> {
  const c = authConfig();
  const redirect = redirectUri();
  await getUserManager().removeUser();
  if (c.hostedDomain) {
    const url = new URL(`https://${c.hostedDomain}/logout`);
    url.searchParams.set('client_id', c.clientId);
    url.searchParams.set('logout_uri', redirect);
    window.location.href = url.toString();
  } else {
    window.location.href = redirect;
  }
}
