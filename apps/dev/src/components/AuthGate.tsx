// Client-only auth gate for the dev portal. Mounts the react-oidc-context
// provider over the shared UserManager and requires a valid Cognito session.
// Unlike apps/ps there is NO LiveAccessGate/me() roster check — access is any
// signed-in employee.
//
// This renders as a fixed, full-screen OVERLAY, not a wrapper around the app's
// content: src/theme/Root.tsx renders the Docusaurus layout unconditionally
// (so SSR stays intact — see the note there) and mounts this on top. While the
// session is loading or absent, the overlay covers the page and redirects to
// sign-in; once authenticated it renders nothing, revealing the content beneath.
// Imported lazily from Root inside <BrowserOnly>, so nothing here runs at SSR.

import React, { useEffect, type ReactNode } from 'react';
import { AuthProvider as OidcProvider, useAuth } from 'react-oidc-context';
import { getUserManager } from '@site/src/lib/auth/userManager';

// Where to send the user back to after the OAuth round-trip. Same-origin,
// absolute-path only (defends against open-redirect via a crafted return value).
const RETURN_KEY = 'psdev.postLoginReturn';

function onSigninCallback(): void {
  let target = window.location.pathname + window.location.search + window.location.hash;
  try {
    const saved = window.localStorage.getItem(RETURN_KEY);
    window.localStorage.removeItem(RETURN_KEY);
    if (saved && saved.startsWith('/') && !saved.startsWith('//')) target = saved;
  } catch {
    /* localStorage unavailable — fall back to current URL */
  }
  // Strip the ?code=&state= from the URL without a reload.
  window.history.replaceState({}, document.title, target);
}

// Full-viewport opaque cover shown until a session exists. Fixed + high z-index
// so it sits above the (already-rendered) Docusaurus layout, including the
// sticky navbar.
function SplashOverlay({ message }: { message: string }): ReactNode {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 'calc(var(--ifm-z-index-fixed, 200) + 100)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--ifm-background-color)',
        color: 'var(--ifm-color-emphasis-600)',
        font: 'var(--ifm-font-size-base) var(--ifm-font-family-base)',
      }}
    >
      {message}
    </div>
  );
}

function Gate(): ReactNode {
  const auth = useAuth();

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated && !auth.activeNavigator && !auth.error) {
      try {
        window.localStorage.setItem(
          RETURN_KEY,
          window.location.pathname + window.location.search + window.location.hash,
        );
      } catch {
        /* ignore — the callback just lands on the current URL */
      }
      void auth.signinRedirect();
    }
  }, [auth.isLoading, auth.isAuthenticated, auth.activeNavigator, auth.error, auth]);

  // Authenticated: render nothing so the content underneath is visible.
  if (auth.isAuthenticated) return null;
  if (auth.error) return <SplashOverlay message={`Sign-in failed: ${auth.error.message}`} />;
  if (auth.isLoading || auth.activeNavigator) return <SplashOverlay message="Checking your session…" />;
  return <SplashOverlay message="Redirecting to sign-in…" />;
}

export default function AuthGate(): ReactNode {
  return (
    <OidcProvider userManager={getUserManager()} onSigninCallback={onSigninCallback}>
      <Gate />
    </OidcProvider>
  );
}
