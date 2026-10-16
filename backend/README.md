# backend

Node Lambda backend: one monorepo compiled to many Lambda bundles over shared
libs. Plain constructor DI (`@libs/di` `once()`); no framework.

```
apps/
  api/              GraphQL dispatcher behind AppSync (schema-driven; registry.ts maps fields to resolvers)
  authorizer/       Unified authorizer: Cognito ID tokens, Cognito access tokens (MCP), opaque API keys
  mcp/              MCP server: JSON-RPC over HTTP, OAuth 2.1 resource server + DCR, tool registry
  stream/           Glean chat streaming (SSE) using the caller's own Glean OAuth token
  workers/
    migrate/        Applies migrations/*.sql on every infra apply (idempotent)
    warmer/         Scheduled keep-alive pings
libs/               Shared services: aurora, authz, roster, identity, credentials, glean, avatar, logo, ...
migrations/         Platform schema (app.*). Every statement is IF NOT EXISTS / ON CONFLICT.
schema.graphql      The AppSync schema; also drives resolver wiring in the appsync Terraform module.
```

Each app exposes `src/lambda.ts`. `esbuild.mjs` emits one CJS bundle per app
under `dist/<app>/index.js` (AWS SDK left external; the runtime provides it).
The Terraform modules zip those directories at apply time.

## Develop

```bash
npm ci
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
npm test            # jest; integration specs run the real migrations in embedded Postgres (pglite)
npm run build       # esbuild -> dist/<app>/index.js
node apps/workers/migrate/gen-migrations.mjs   # after adding a migration
```

## Adding a GraphQL field

1. Declare it in `schema.graphql` under `Query` or `Mutation`.
2. Write the method on a resolver class under `apps/api/src/<area>/`.
3. Construct the resolver in `apps/api/src/container.ts` and bind the field in
   `apps/api/src/registry.ts`.

`apps/api/src/schema-registry.spec.ts` fails if the schema and the registry
disagree, and the appsync Terraform module creates the AppSync resolver from the
schema on the next plan.

## Adding an MCP tool

Write `apps/mcp/src/tools/<name>.ts` exporting a `ToolDefinition` (JSON Schema
input, `READ_ONLY` or `CREATES_RECORDS` annotations, a handler that reuses the
API's resolver classes through `apps/mcp/src/container.ts`), then list it in
`apps/mcp/src/mcp/tools.ts`. Tools return `content` (text) plus
`structuredContent`; the server attaches a provenance envelope under
`_meta.portal` so a host can distinguish an empty result from a failure.

Write tools must resolve the acting user from the identity (OAuth connection)
or from an explicit argument; there is no fallback identity.

## Authorization

`@libs/roster` reads `app.access_roster` (email -> role, admin flag) and
`@libs/authz` turns that into gates: `requireUser`, `requireRead`,
`requireWrite` (admin or `EDITOR`), `requireAdmin`. API keys are authorized by
scope alone; OAuth user tokens carry scopes that cap what the person's role
allows. `visibilitySql` / `canAccess` give row-level gating on a
`visibility_role` column.

The roster ships empty. Seed the first administrator once:

```sql
INSERT INTO app.access_roster (email, role, is_admin) VALUES ('you@example.com', 'ADMINISTRATOR', true);
```

## Identity

`@libs/identity` owns `app.users`: every caller resolves to a `usr_*` id keyed
by email on first sight. Upstream systems' user ids never become keys; add a
nullable satellite column when you connect one.

## Environment

Set by the Terraform modules; listed here so local runs can mirror them.

| Variable | Read by | Meaning |
|---|---|---|
| `AURORA_CLUSTER_ARN`, `AURORA_SECRET_ARN`, `AURORA_DATABASE` | all | RDS Data API target |
| `DDB_TABLE_PREFIX` | api, authorizer | `<project>-<env>` table name prefix |
| `API_KEY_PEPPER_SECRET` | api | Secrets Manager ARN of the HMAC pepper |
| `COGNITO_ISSUER`, `COGNITO_CLIENT_ID`, `COGNITO_MCP_RESOURCE` | authorizer | token verification |
| `ALLOWED_EMAIL_DOMAINS` | authorizer, mcp | comma-separated; unset = any domain the pool admitted |
| `OAUTH_PUBLIC_URL`, `OAUTH_HOSTED_UI_URL`, `OAUTH_RESOURCE_IDENTIFIER`, `OAUTH_REDIRECT_HOSTS`, `COGNITO_USER_POOL_ID` | mcp | OAuth 2.1 resource server + DCR |
| `GLEAN_BASE_URL`, `GLEAN_SCOPES`, `GLEAN_REDIRECT_URIS`, `GLEAN_CLIENT_NAME` | api, stream | per-user Glean OAuth |
| `LOGO_BUCKET_NAME`, `LOGO_CDN_URL_PREFIX`, `LOGO_CDN_ORIGIN` | api, mcp | logo cache storage and public prefix |
| `PORTAL_NAME`, `MCP_SERVER_DESCRIPTION` | mcp | names shown to MCP hosts |
| `PERF_METRICS_NAMESPACE`, `APP_ENV`, `APP_VERSION` | all | EMF metrics namespace and dimensions |
