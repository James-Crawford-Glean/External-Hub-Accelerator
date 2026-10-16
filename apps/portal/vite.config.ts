import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

// The production build is served under /<app>/ in the multi-app bucket (the
// edge redirects the root here), so `base` must match the deploy prefix for
// asset URLs and the OIDC redirect_uri (location.origin + BASE_URL). Dev and
// test stay at '/'.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const appPath = (process.env.VITE_APP_PATH ?? env.VITE_APP_PATH ?? 'portal').replace(/^\/|\/$/g, '');
  // /glean-api/* is the SPA's only same-origin call. In production CloudFront
  // routes it to the streaming API; locally Vite proxies it to a deployed env.
  const gleanProxyTarget = env.VITE_GLEAN_PROXY_TARGET || '';

  return {
    base: mode === 'production' ? `/${appPath}/` : '/',
    plugins: [react()],
    server: gleanProxyTarget
      ? {
          proxy: {
            '/glean-api': {
              target: gleanProxyTarget,
              changeOrigin: true,
              // SSE: strip gzip so deltas flush through instead of being buffered.
              configure: (proxy) => {
                proxy.on('proxyReq', (proxyReq) => proxyReq.setHeader('accept-encoding', 'identity'));
              },
            },
          },
        }
      : undefined,
  };
});
