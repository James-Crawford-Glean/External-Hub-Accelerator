// Single oidc-client-ts UserManager, shared by the React layer
// (react-oidc-context) and the non-React GraphQL client (getIdToken).

import { UserManager, WebStorageStateStore, type User } from 'oidc-client-ts';
import { COGNITO_AUTHORITY, COGNITO_CLIENT_ID, COGNITO_HOSTED_DOMAIN, COGNITO_IDP, REDIRECT_URI } from '../api/config';

let manager: UserManager | null = null;

export function getUserManager(): UserManager {
  if (!manager) {
    manager = new UserManager({
      authority: COGNITO_AUTHORITY,
      client_id: COGNITO_CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      post_logout_redirect_uri: REDIRECT_URI,
      response_type: 'code', // Authorization Code + PKCE (public client, no secret)
      scope: 'openid email profile',
      userStore: new WebStorageStateStore({ store: window.localStorage }),
      automaticSilentRenew: true,
      // Pin the hosted-UI endpoints to COGNITO_HOSTED_DOMAIN instead of trusting
      // Cognito's discovery doc, which always advertises the prefix domain even
      // when a white-label custom domain (auth.<env>.<domain_root>) is active.
      // issuer + jwks stay on cognito-idp (the token issuer never changes), so
      // validation is unaffected — this only brands the browser-visible URLs.
      ...(COGNITO_HOSTED_DOMAIN
        ? {
            metadata: {
              issuer: COGNITO_AUTHORITY,
              authorization_endpoint: `https://${COGNITO_HOSTED_DOMAIN}/oauth2/authorize`,
              token_endpoint: `https://${COGNITO_HOSTED_DOMAIN}/oauth2/token`,
              userinfo_endpoint: `https://${COGNITO_HOSTED_DOMAIN}/oauth2/userInfo`,
              end_session_endpoint: `https://${COGNITO_HOSTED_DOMAIN}/logout`,
              jwks_uri: `${COGNITO_AUTHORITY}/.well-known/jwks.json`,
            },
          }
        : {}),
      // Skip the Cognito chooser — straight to the configured IdP (COGNITO_IDP).
      // Empty string omits the param so the hosted-UI chooser shows instead.
      ...(COGNITO_IDP ? { extraQueryParams: { identity_provider: COGNITO_IDP } } : {}),
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
  await getUserManager().removeUser();
  if (COGNITO_HOSTED_DOMAIN) {
    const url = new URL(`https://${COGNITO_HOSTED_DOMAIN}/logout`);
    url.searchParams.set('client_id', COGNITO_CLIENT_ID);
    url.searchParams.set('logout_uri', REDIRECT_URI);
    window.location.href = url.toString();
  } else {
    window.location.href = REDIRECT_URI;
  }
}
