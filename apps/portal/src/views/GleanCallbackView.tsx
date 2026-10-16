// Glean OAuth return target (/glean/callback). The Cognito provider is told to
// skip its signin-callback on this path (skipSigninCallback in AuthProvider), so
// the ?code/&state here belong to Glean: exchange them server-side, then return
// the user to wherever they started the connect, falling back to the home page.

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { gleanCompleteConnect, takeGleanReturn } from '../lib/api/glean';
import { showToast } from '../state/toast';
import { Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { Button } from '../components/ui/Button';

function readParams() {
  const p = new URLSearchParams(window.location.search);
  const code = p.get('code');
  const state = p.get('state');
  const authError = p.get('error_description') || p.get('error');
  const initialError = authError ?? (!code || !state ? 'Missing authorization code or state.' : null);
  return { code, state, initialError };
}

export function GleanCallbackView() {
  const navigate = useNavigate();
  // Parse + validate at render so the synchronous error path seeds state via the
  // initializer (no setState-in-effect); the effect only runs the async exchange.
  const [{ code, state, initialError }] = useState(readParams);
  const [error, setError] = useState<string | null>(initialError);
  const ran = useRef(false);

  useEffect(() => {
    // Guard StrictMode's double-invoke — the state row is single-use.
    if (ran.current || error || !code || !state) return;
    ran.current = true;
    void gleanCompleteConnect(code, state)
      .then(() => {
        showToast('Glean connected', 'success');
        navigate(takeGleanReturn()?.path || '/', { replace: true });
      })
      .catch((e) => setError(e instanceof Error ? e.message : 'Could not finish the Glean connection.'));
  }, [navigate, code, state, error]);

  if (error) {
    return (
      <EmptyState
        title="Couldn't connect Glean"
        body={error}
        action={<Button variant="secondary" onClick={() => navigate('/', { replace: true })}>Back home</Button>}
      />
    );
  }
  return (
    <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
      <Spinner label="Finishing Glean connection…" />
    </div>
  );
}
