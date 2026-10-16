// The interactive GraphQL client: an embedded GraphiQL IDE pointed at this env's
// AppSync endpoint. Every operation is authenticated by a custom fetch wrapper —
// preferring the signed-in Cognito ID token, falling back to a pasted psk_live_*
// key (useful locally, where the docs may be browsed unauthenticated and the
// AppSync Lambda authorizer also accepts a static key).
//
// Client-only: GraphiQL and its CSS touch the DOM, so this module is only ever
// required inside <BrowserOnly> (see src/pages/graphql-sandbox.tsx) — its body,
// including the imports below, never runs during Docusaurus's static build.

import React, { useMemo, useRef, useState } from 'react';
import { GraphiQL } from 'graphiql';
import { createGraphiQLFetcher, type Fetcher } from '@graphiql/toolkit';
import { authConfig, isAuthEnabled } from '@site/src/lib/auth/config';
import { getIdToken } from '@site/src/lib/auth/userManager';
import 'graphiql/graphiql.css';

export default function GraphqlSandbox(): React.ReactNode {
  // A pasted psk_live_* key for local/unauthenticated use. Held in a ref so the
  // long-lived fetch closure always reads the current value without rebuilding
  // the fetcher.
  const manualKeyRef = useRef('');
  const [manualKey, setManualKey] = useState('');

  const endpoint = authConfig().graphqlUrl;

  // One fetcher for the life of the component (endpoint is build-time constant).
  // The fetch override injects a Bearer token per request: the Cognito ID token
  // when signed in, else the pasted psk_live_* key.
  const fetcher = useMemo<Fetcher | null>(() => {
    if (!endpoint) return null;
    return createGraphiQLFetcher({
      url: endpoint,
      fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
        const headers: Record<string, string> = { ...((init?.headers as Record<string, string>) ?? {}) };
        let bearer = '';
        if (isAuthEnabled()) {
          const token = await getIdToken();
          if (token) bearer = token;
        }
        if (!bearer && manualKeyRef.current) bearer = manualKeyRef.current.trim();
        if (bearer) headers.Authorization = `Bearer ${bearer}`;
        return fetch(input, { ...init, headers });
      },
    });
  }, [endpoint]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: 'calc(100vh - var(--ifm-navbar-height))' }}>
      {!isAuthEnabled() && (
        <div style={{ padding: '0.75rem 1rem', borderBottom: '1px solid var(--ifm-color-emphasis-300)' }}>
          <label style={{ fontSize: '0.85rem', display: 'block', marginBottom: '0.25rem' }}>
            API key (psk_live_…) — sent as <code>Authorization: Bearer</code> when no Cognito session is present
          </label>
          <input
            type="password"
            value={manualKey}
            placeholder="psk_live_…"
            onChange={(e) => {
              setManualKey(e.target.value);
              manualKeyRef.current = e.target.value;
            }}
            style={{
              width: '100%',
              maxWidth: 480,
              padding: '0.4rem 0.6rem',
              fontFamily: 'var(--ifm-font-family-monospace)',
              border: '1px solid var(--ifm-color-emphasis-400)',
              borderRadius: 'var(--ifm-global-radius)',
              background: 'var(--ifm-background-surface-color)',
              color: 'var(--ifm-font-color-base)',
            }}
          />
        </div>
      )}
      {fetcher ? (
        <div style={{ flex: 1, minHeight: 0 }}>
          <GraphiQL fetcher={fetcher} />
        </div>
      ) : (
        <div style={{ padding: '1.5rem', color: 'var(--ifm-color-danger)' }}>
          GraphQL endpoint is not configured (VITE_GRAPHQL_URL). Set it in .env.local to use the Sandbox locally.
        </div>
      )}
    </div>
  );
}
