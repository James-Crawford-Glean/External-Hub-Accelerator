// Swizzled Docusaurus Root: wraps the entire app (persists across route
// changes). Two jobs:
//   1. Copy build-time auth/API config out of siteConfig.customFields into the
//      module store (src/lib/auth/config) that the non-React userManager reads.
//   2. When Cognito is configured, gate the app behind a signed-in session —
//      any signed-in user of the pool, no roster check (unlike apps/portal).
//
// The gate is an ADDITIVE, client-only overlay — it does NOT wrap or replace
// `children`. That matters: `children` is Docusaurus's whole layout (navbar,
// content, footer), and rendering it unconditionally keeps server-side rendering
// intact. Wrapping the layout in <BrowserOnly> (an earlier approach) rendered an
// empty shell at SSR and remounted the entire layout client-side after hydration,
// which produced a glitchy empty band above the navbar. Here the layout SSRs and
// hydrates in place; the AuthGate mounts on top as a fixed overlay.
//
// Client-only auth: oidc-client-ts touches window/localStorage, absent during
// SSR. setAuthConfig is safe on the server (it only mutates a module var); the
// OIDC provider + overlay mount inside <BrowserOnly> so they never load at SSR.
// The gating is a UX layer, not a security boundary — the static assets are
// public behind CloudFront regardless — so SSR-ing the content leaks nothing.
// When Cognito vars are absent (local docs-only browsing), no overlay renders.

import React, { type ReactNode } from 'react';
import BrowserOnly from '@docusaurus/BrowserOnly';
import useDocusaurusContext from '@docusaurus/useDocusaurusContext';
import { setAuthConfig, isAuthEnabled } from '@site/src/lib/auth/config';

interface CustomFields {
  graphqlUrl?: string;
  cognito?: {
    authority?: string;
    clientId?: string;
    hostedDomain?: string;
    idp?: string;
    redirectUri?: string;
  };
}

export default function Root({ children }: { children: ReactNode }): ReactNode {
  const { siteConfig } = useDocusaurusContext();
  const cf = (siteConfig.customFields ?? {}) as CustomFields;
  const cognito = cf.cognito ?? {};

  setAuthConfig({
    authority: cognito.authority ?? '',
    clientId: cognito.clientId ?? '',
    hostedDomain: cognito.hostedDomain ?? '',
    idp: cognito.idp ?? 'Google',
    redirectUri: cognito.redirectUri ?? '',
    graphqlUrl: cf.graphqlUrl ?? '',
    baseUrl: siteConfig.baseUrl,
  });

  // Render the layout unconditionally (SSR + hydrate in place). When auth is
  // enabled, mount the gate as a client-only overlay on top — it covers the
  // content with a splash and redirects to sign-in until a session exists, then
  // renders nothing so the content underneath shows through.
  return (
    <>
      {children}
      {isAuthEnabled() && (
        <BrowserOnly>
          {() => {
            // Required inside the render prop so the OIDC stack is never imported
            // during SSR (webpack keeps it out of the server bundle).
            const AuthGate = require('@site/src/components/AuthGate').default;
            return <AuthGate />;
          }}
        </BrowserOnly>
      )}
    </>
  );
}
