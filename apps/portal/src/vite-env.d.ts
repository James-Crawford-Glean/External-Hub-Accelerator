/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_PORTAL_NAME?: string;
  readonly VITE_GRAPHQL_URL?: string;
  readonly VITE_COGNITO_AUTHORITY?: string;
  readonly VITE_COGNITO_CLIENT_ID?: string;
  readonly VITE_COGNITO_HOSTED_DOMAIN?: string;
  readonly VITE_COGNITO_IDP?: string;
  readonly VITE_REDIRECT_URI?: string;
  readonly VITE_APP_PATH?: string;
  readonly VITE_GLEAN_PROXY_TARGET?: string;
  readonly VITE_ENV?: string;
  readonly VITE_AWS_ACCOUNT_ID?: string;
  readonly VITE_AWS_REGION?: string;
  readonly VITE_AWS_DASHBOARD_NAME?: string;
  readonly VITE_AWS_BILLING_DASHBOARD_NAME?: string;
  readonly VITE_APP_VERSION?: string;
  readonly VITE_GIT_SHA?: string;
  readonly VITE_RUM_APP_MONITOR_ID?: string;
  readonly VITE_RUM_IDENTITY_POOL_ID?: string;
  readonly VITE_RUM_REGION?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
