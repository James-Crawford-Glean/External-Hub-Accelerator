// Cognito sign-in (Authorization Code + PKCE through react-oidc-context) and the
// access gate: once authenticated, `me` is fetched and published through
// CurrentUserContext. An off-roster caller sees NoAccessView; their sign-in has
// already been recorded as an access request for an administrator to grant.
import { useEffect, useState, type ReactNode } from 'react';
import { AuthProvider as OidcProvider, useAuth } from 'react-oidc-context';
import { getUserManager } from './userManager';
import { fetchMe, recordLogin, type Me } from '../api/identity';
import { setTelemetryUser } from '../telemetry';
import { CurrentUserContext } from '../../data/useCurrentUser';
import { NoAccessView } from '../../views/NoAccessView';
import { Spinner } from '../../components/ui/Spinner';
import { Button } from '../../components/ui/Button';

// A cold-started Aurora can exceed the resolver ceiling and error before the
// resume finishes; retry the gating fetch with backoff so a waking database
// self-heals instead of locking the user out.
const ACCESS_ATTEMPTS = 4;
const ACCESS_BACKOFF_MS = [0, 2000, 4000, 8000];
const RETURN_KEY = 'portal.postLoginReturn';

// After a successful sign-in redirect: restore the originally requested URL and
// strip Cognito's ?code/&state. The Router mounts only after this runs.
function onSigninCallback() {
  let target = window.location.pathname + window.location.hash;
  try {
    const saved = window.localStorage.getItem(RETURN_KEY);
    window.localStorage.removeItem(RETURN_KEY);
    // Same-origin relative path only, never an attacker-supplied absolute URL.
    if (saved && saved.startsWith('/') && !saved.startsWith('//')) target = saved;
  } catch {
    /* localStorage unavailable */
  }
  window.history.replaceState({}, document.title, target);
  void recordLogin();
}

export function AppAuthProvider({ children }: { children: ReactNode }) {
  // The Glean OAuth return (/glean/callback) also carries ?code/&state, but
  // it's Glean's; GleanCallbackView consumes it.
  const skipSigninCallback = window.location.pathname.endsWith('/glean/callback');
  return (
    <OidcProvider userManager={getUserManager()} onSigninCallback={onSigninCallback} skipSigninCallback={skipSigninCallback}>
      {children}
    </OidcProvider>
  );
}

export function AuthGate({ children }: { children: ReactNode }) {
  const auth = useAuth();

  useEffect(() => {
    if (!auth.isLoading && !auth.isAuthenticated && !auth.activeNavigator && !auth.error) {
      try {
        window.localStorage.setItem(RETURN_KEY, window.location.pathname + window.location.search + window.location.hash);
      } catch {
        /* localStorage unavailable */
      }
      void auth.signinRedirect();
    }
  }, [auth.isLoading, auth.isAuthenticated, auth.activeNavigator, auth.error, auth]);

  if (auth.isLoading || auth.activeNavigator) return <Splash message="Checking your session…" busy />;
  if (auth.error) return <Splash message={`Sign-in failed: ${auth.error.message}`} />;
  if (!auth.isAuthenticated) return <Splash message="Redirecting to sign-in…" busy />;
  return <AccessGate>{children}</AccessGate>;
}

function AccessGate({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null | undefined>(undefined);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    let active = true;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const attempt = (n: number) => {
      void fetchMe()
        .then((result) => {
          if (!active) return;
          setLoadError(null);
          setMe(result);
          if (result) setTelemetryUser({ userId: result.id, email: result.email, name: result.name });
        })
        .catch((e: unknown) => {
          if (!active) return;
          if (n + 1 < ACCESS_ATTEMPTS) {
            timer = setTimeout(() => attempt(n + 1), ACCESS_BACKOFF_MS[n + 1]);
            return;
          }
          setMe(null);
          setLoadError(e instanceof Error ? e.message : 'Could not load your profile.');
        });
    };
    attempt(0);
    return () => {
      active = false;
      if (timer) clearTimeout(timer);
    };
  }, [retryKey]);

  if (me === undefined && !loadError) return <Splash message="Loading your profile…" busy />;
  if (loadError) {
    return (
      <Splash message={loadError}>
        <Button
          onClick={() => {
            setLoadError(null);
            setMe(undefined);
            setRetryKey((k) => k + 1);
          }}
        >
          Try again
        </Button>
      </Splash>
    );
  }
  if (!me || !me.role) return <NoAccessView email={me?.email ?? null} />;
  return <CurrentUserContext.Provider value={me}>{children}</CurrentUserContext.Provider>;
}

function Splash({ message, busy = false, children }: { message: string; busy?: boolean; children?: ReactNode }) {
  return (
    <div
      style={{
        minHeight: '100vh',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 16,
        color: 'var(--color-ink-muted)',
        fontSize: 14,
        textAlign: 'center',
        padding: 24,
      }}
    >
      {busy && <Spinner />}
      <div>{message}</div>
      {children}
    </div>
  );
}
