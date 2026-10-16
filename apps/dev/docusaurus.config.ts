import type { Config } from '@docusaurus/types';
import type * as Preset from '@docusaurus/preset-classic';
import dotenv from 'dotenv';

// Docusaurus (unlike Vite) does not auto-load .env files. Load .env.local then
// .env so local `pnpm start` picks up VITE_* the same way apps/ps does; in CI the
// deploy workflow exports these into the environment before `pnpm build`.
dotenv.config({ path: '.env.local' });
dotenv.config();

const env = process.env;
const trimmed = (v: string | undefined) => (v ?? '').trim();

// Auth + API config, surfaced to the browser bundle via customFields (read in
// src/lib/auth/config.ts). Mirrors apps/portal's VITE_* contract so the deploy
// workflow injects identical values per env.
const graphqlUrl = trimmed(env.VITE_GRAPHQL_URL);
const cognito = {
  authority: trimmed(env.VITE_COGNITO_AUTHORITY),
  clientId: trimmed(env.VITE_COGNITO_CLIENT_ID),
  hostedDomain: trimmed(env.VITE_COGNITO_HOSTED_DOMAIN),
  idp: trimmed(env.VITE_COGNITO_IDP) || 'Google',
  redirectUri: trimmed(env.VITE_REDIRECT_URI),
};

// Dark code-block palette lifted from the Glean developer site so fenced code
// reads as one family with the rest of the Glean-branded theme.
const gleanDarkCodeTheme = {
  plain: { color: '#e6e7ea', backgroundColor: '#121418' },
  styles: [
    { types: ['comment', 'prolog', 'doctype', 'cdata'], style: { color: '#8b8f98', fontStyle: 'italic' as const } },
    { types: ['punctuation'], style: { color: '#c3c6cc' } },
    { types: ['string', 'char', 'attr-value', 'template-string', 'inserted'], style: { color: '#d0e26f' } },
    { types: ['keyword', 'tag', 'operator', 'selector', 'atrule'], style: { color: '#8f94fd' } },
    { types: ['number', 'boolean', 'constant', 'symbol', 'deleted'], style: { color: '#ffd4bf' } },
    { types: ['function', 'class-name', 'builtin', 'attr-name'], style: { color: '#a9e0ff' } },
    { types: ['variable', 'property', 'regex'], style: { color: '#e6e7ea' } },
  ],
};

const config: Config = {
  title: `${trimmed(env.VITE_PORTAL_NAME) || 'Portal'} Developer Portal`,
  tagline: 'MCP + GraphQL reference and an interactive GraphQL client',
  favicon: 'img/favicon.png',

  // Served behind the shared CloudFront at /dev/. url is cosmetic (canonical
  // links); baseUrl is what actually matters for asset + route prefixing.
  url: trimmed(env.VITE_SITE_URL) || 'https://example.com',
  baseUrl: '/dev/',
  baseUrlIssueBanner: false,
  trailingSlash: true,

  organizationName: trimmed(env.VITE_GITHUB_ORG) || 'your-github-org',
  projectName: trimmed(env.VITE_GITHUB_REPO) || 'your-portal-repo',

  // Generated GraphQL reference can lag hand-authored cross-links; warn instead
  // of failing the build so a schema change never blocks a docs deploy.
  onBrokenLinks: 'warn',
  onBrokenMarkdownLinks: 'warn',

  i18n: { defaultLocale: 'en', locales: ['en'] },

  clientModules: ['./src/clientModules/mermaid.ts', './src/clientModules/lightbox.ts'],

  customFields: { graphqlUrl, cognito },

  presets: [
    [
      'classic',
      {
        docs: {
          routeBasePath: '/', // docs are the portal itself
          sidebarPath: './sidebars.ts',
        },
        blog: false,
        theme: { customCss: './src/css/custom.css' },
      } satisfies Preset.Options,
    ],
  ],

  plugins: [
    [
      '@graphql-markdown/docusaurus',
      {
        // Auto-generate the GraphQL reference from the backend SDL. `pnpm
        // gen:graphql` (run before start/build) writes markdown under
        // docs/graphql/reference; that folder is gitignored (build artifact).
        // The AppSync prelude is loaded first so its @aws_* directives and AWS*
        // scalars are declared before the real schema references them (see
        // graphql/aws-appsync-prelude.graphql) — otherwise the loader rejects
        // the SDL as invalid.
        schema: ['./graphql/aws-appsync-prelude.graphql', '../../backend/schema.graphql'],
        rootPath: './docs',
        baseURL: 'graphql/reference',
        // Homepage source lives OUTSIDE ./docs so it isn't also picked up as a
        // standalone doc route — the plugin copies it into the generated
        // docs/graphql/reference/ tree and forces its slug to the baseURL root
        // (/dev/graphql/reference/). Keeping the source in ./docs made that same
        // route resolve twice (duplicate-route warning).
        homepage: './graphql/reference-home.md',
        loaders: {
          GraphQLFileLoader: '@graphql-tools/graphql-file-loader',
        },
        docOptions: { index: true },
      },
    ],
  ],

  themeConfig: {
    colorMode: { defaultMode: 'light', respectPrefersColorScheme: true },
    navbar: {
      title: `${trimmed(env.VITE_PORTAL_NAME) || 'Portal'} Developers`,
      logo: {
        alt: 'Glean',
        src: 'img/glean-logo.svg',
        srcDark: 'img/glean-logo-white.svg',
      },
      items: [
        { type: 'docSidebar', sidebarId: 'docsSidebar', position: 'left', label: 'Docs' },
        { to: '/graphql-sandbox', label: 'GraphQL Sandbox', position: 'left' },
      ],
    },
    footer: { style: 'dark', links: [] },
    prism: {
      // Glean's developer-site code palette for both light and dark, so fenced
      // code matches the branded look in either mode.
      theme: gleanDarkCodeTheme,
      darkTheme: gleanDarkCodeTheme,
      additionalLanguages: ['bash', 'json', 'graphql', 'go', 'java'],
    },
  } satisfies Preset.ThemeConfig,
};

export default config;
