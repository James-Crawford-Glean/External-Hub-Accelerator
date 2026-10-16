// API + auth configuration, read once from the Vite env.

const env = import.meta.env;

export const PORTAL_NAME = (env.VITE_PORTAL_NAME ?? '').trim() || 'Portal';

export const GRAPHQL_URL = (env.VITE_GRAPHQL_URL ?? '').trim();

// Cognito (OIDC). The SPA is a public PKCE client; tokens are minted by
// Cognito and verified by the unified authorizer against Cognito's JWKS.
export const COGNITO_AUTHORITY = (env.VITE_COGNITO_AUTHORITY ?? '').trim();
export const COGNITO_CLIENT_ID = (env.VITE_COGNITO_CLIENT_ID ?? '').trim();
/** Hosted-UI host, e.g. auth.<env>.<domain_root>, for the authorize/logout URLs. */
export const COGNITO_HOSTED_DOMAIN = (env.VITE_COGNITO_HOSTED_DOMAIN ?? '').trim();
/** Identity provider to send users straight to (skips the hosted-UI chooser). Empty shows the chooser. */
export const COGNITO_IDP = (env.VITE_COGNITO_IDP ?? 'Google').trim();
/** OAuth redirect/login-return target. Defaults to the app's deployed base. */
export const REDIRECT_URI = (env.VITE_REDIRECT_URI ?? `${globalThis.location?.origin ?? ''}${import.meta.env.BASE_URL}`).trim();

/** Both a GraphQL endpoint and a Cognito pool are required to run; there is no demo mode. */
export const CONFIGURED = GRAPHQL_URL.length > 0 && COGNITO_AUTHORITY.length > 0 && COGNITO_CLIENT_ID.length > 0;

// ---- Release tagging + CloudWatch RUM --------------------------------------
export const APP_VERSION = ((env.VITE_APP_VERSION ?? env.VITE_GIT_SHA ?? '').trim() || 'dev').slice(0, 7);
export const APP_ENV = (env.VITE_ENV ?? '').trim() || 'local';

export const RUM_APP_MONITOR_ID = (env.VITE_RUM_APP_MONITOR_ID ?? '').trim();
export const RUM_IDENTITY_POOL_ID = (env.VITE_RUM_IDENTITY_POOL_ID ?? '').trim();
export const RUM_REGION = (env.VITE_RUM_REGION ?? env.VITE_AWS_REGION ?? 'us-east-2').trim();
export const RUM_ENABLED = CONFIGURED && RUM_APP_MONITOR_ID.length > 0;

// ---- Admin > AWS deep links ------------------------------------------------
export const AWS_ACCOUNT_ID = (env.VITE_AWS_ACCOUNT_ID ?? '').trim();
export const AWS_REGION = (env.VITE_AWS_REGION ?? 'us-east-2').trim();
export const AWS_DASHBOARD_NAME = (env.VITE_AWS_DASHBOARD_NAME ?? '').trim();
export const AWS_BILLING_DASHBOARD_NAME = (env.VITE_AWS_BILLING_DASHBOARD_NAME ?? '').trim();
