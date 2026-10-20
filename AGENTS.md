# AGENTS.md

Coding and documentation rules for AI-assisted edits in this repository. Keep it
short. If a rule is not here and you are guessing, ask.

This repository was extracted from an internal portal (the source project) and
sanitized for publication. Its name does not appear outside `README.md`; the
sanitization guard (`scripts/check-sanitized.sh`) enforces that along with the
rest of the list under *Mock and example data*.

## Repo layout

- `backend/`: Node Lambda monorepo (`npm`). One `tsc` project, many bundles:
  `apps/api` (GraphQL dispatcher behind AppSync), `apps/authorizer` (Cognito
  tokens + opaque API keys), `apps/mcp` (MCP server, OAuth 2.1 resource server,
  tool registry), `apps/stream` (Glean chat SSE), `apps/workers/*` (`migrate`,
  `warmer`, `item-sync`, `glean-index`). Shared code in `libs/*`, imported as
  `@libs/<name>`. `schema.graphql` is the API contract. `migrations/*.sql` is the
  schema.
- `apps/portal/`: the web app (Vite + React, `pnpm`). Cognito PKCE sign-in,
  capability-gated shell, example-domain views, admin screens, Glean connect
  and chat. Served at `/portal/`.
- `apps/dev/`: the developer portal (Docusaurus, `pnpm`). GraphQL reference is
  generated from `backend/schema.graphql`; MCP, Indexing, auth, skill-authoring,
  and host-test-matrix pages are hand-written under `docs/`. Served at `/dev/`.
- `modules/<group>/<name>/`: Terraform modules, grouped `infra` / `app` /
  `data-pipeline`. No Terragrunt logic inside a module.
- `live/<env>/<group>/<stack>/terragrunt.hcl`: one stack per module per
  environment. `live/example/` is the shipped environment; copy it to add one.
  `live/_shared/` is account-scoped, `live/_envcommon/` holds shared inputs.
- `docs/`: repository-level documents (white paper, extraction plan, the
  example Glean skill under `docs/mcp/skills/example/`).
- `scripts/`: `check-sanitized.sh` (publication guard) and
  `validate-modules.sh` (`terraform validate` per module).
- `bootstrap/`: one-time state-bucket bootstrap.
- `.github/workflows/`: `ci.yml` on pull requests; `infra-deploy.yml` and
  `spa-deploy.yml` on manual dispatch.

The example domain is one entity, `items` (`backend/libs/items`,
`backend/apps/api/src/items`, `backend/apps/workers/item-sync`, the three MCP
tools, `apps/portal/src/views/Item*`). Everything else is platform. An adopter
replaces `items`; the README section *Replacing the example domain* is the
checklist.

## Adding things: convention, not registration

**GraphQL field.** Declare it in `backend/schema.graphql`, write the method on
a resolver class under `backend/apps/api/src/<area>/`, construct the resolver in
`apps/api/src/container.ts`, bind the field in `apps/api/src/registry.ts`.
`schema-registry.spec.ts` fails until schema and registry agree; the `appsync`
module creates the AppSync resolver from the schema on the next apply.

**MCP tool.** Write `backend/apps/mcp/src/tools/<name>.ts` exporting a
`ToolDefinition` (JSON Schema input with `additionalProperties: false`,
`READ_ONLY` / `CREATES_RECORDS` / `UPDATES_IN_PLACE` annotations, a handler that
calls a resolver class through `apps/mcp/src/container.ts`), then list it in
`apps/mcp/src/mcp/tools.ts`. Return `content` text that carries the rows a
follow-up needs plus `structuredContent`. The server adds the argument gate,
the provenance envelope, and the catalog filter; do not re-implement them in a
tool. A tool change is not done until the skill matches it (see *MCP changes*).

**Scheduled worker.** Copy `backend/apps/workers/item-sync`, keep `externalId`
stable, add one `scheduled-worker` stack under `live/<env>/data-pipeline/`, and
add the function name to `infra/observability`.

**Portal view.** A view under `apps/portal/src/views/`, a route in `App.tsx` and
`lib/routes.ts`, a nav entry in `components/layout`.

**Migration.** A new file under `backend/migrations/`, every statement
`IF NOT EXISTS` / `ON CONFLICT`, then
`node apps/workers/migrate/gen-migrations.mjs`. The runner re-applies every
migration on every apply; there is no ledger.

## Opaque IDs

Every native primary key is a prefixed random id minted in TypeScript: `usr_`
users, `itm_` items, `apk_` API keys (the key secret itself is `psk_live_…`).
Upstream system ids are stored as `external_id` satellite columns with
indexes, never as keys, so swapping an upstream system never rewrites a URL or
a tool argument. GraphQL `id: ID!` and MCP tool arguments always carry our ids.
A new entity gets a new three-letter prefix and a mint function beside its
service, as `genUserId` in `@libs/identity` does.

## Storage

- **Aurora Serverless v2** over the RDS Data API, no VPC. Schemas: `app.*`
  (users, roster, access requests, login events, Glean OAuth, notifications,
  warmer config, sync runs, export jobs) and `example.*` (the example domain).
  SQL lives in service and resolver classes with bound parameters built through
  `@libs/sql`; the only `.sql` files are migrations.
- **DynamoDB** for key-value tables: `api_keys`, `enrichment_cache`.
- **Secrets Manager** for external credentials (Google OAuth client, API-key
  pepper, Glean indexing token). Read at runtime in the Lambda, never at apply
  time; the CI role is denied `secretsmanager:GetSecretValue` except for the one
  secret Cognito needs.
- **S3** for SPA assets and the logo cache (`logos/dom_<sha>.<ext>` keys in the
  SPA bucket; the key reveals nothing about the domain).

## Comments

- Default to none. Trust naming and structure.
- One line max when the WHY is not obvious: a non-obvious rationale, an
  invariant, a hazard a reader would miss.
- Never write migration history, rot-prone TODOs, or "used by X" / "added for
  Y".
- Bug context goes in the commit body. Operational caveats go in the developer
  portal or the PR.
- Same bar for README, Terraform, and workflow files: factual deltas only, not
  tutorial noise beside a self-explanatory setting.

## TypeScript

Backend and both SPAs. See `.claude/skills/typescript` and
`.claude/skills/code-style` for the longer form.

- `const` by default; `let` only when reassigned. ES2023+: `?.`, `??`,
  async/await, `toSorted` / `toReversed` / spread over mutation.
- No `any`, `Function`, `object`, `{}`. `unknown`, then narrow.
- Discriminated unions with a literal `kind:` for closed sets; `switch` with a
  `never` default. `as const` objects over `enum`.
- `interface` for object shapes, `type` for unions, intersections, literals,
  mapped types. Do not dual-declare.
- Function types written out: `(x: T) => U`. Generics where the input drives
  the output.
- Functional: `map` / `filter` / `reduce` over `for`; pure functions over class
  methods; React is hooks only.
- **Backend specifics.** CommonJS output via esbuild, `strict`, `noUnusedLocals`,
  `noUnusedParameters`; imports by `@libs/<name>` alias without file extensions.
  Dependency injection is `once()` from `@libs/di` in a `container.ts` per
  app: lazy, memoized, order-independent. Resolver classes are shared by the
  GraphQL dispatcher and the MCP server so the two surfaces cannot disagree
  about a record or who may see it. Column names are code constants; every
  value is a bound parameter. Tests are `*.spec.ts` beside the code (jest);
  integration specs boot embedded Postgres through `@libs/testkit` and run the
  real migrations.
- **Portal specifics.** `pnpm exec tsc -b`, `pnpm exec eslint .`,
  `pnpm exec vitest run` before committing. Env vars are declared in
  `src/vite-env.d.ts` and read as `import.meta.env.VITE_X`, no redundant casts.
- **Developer portal.** `pnpm typecheck && pnpm build`; the build warns rather
  than fails on broken links, so check the output.

## Python

Only small helpers: the Lambda@Edge handler
(`modules/app/s3-cloudfront-spa/edge/edge.py`), the schema parser the appsync
module runs at plan time (`modules/app/appsync/parse-schema.py`), and the
Cognito triggers (`modules/infra/cognito/triggers/*.py`). Rules for those files:

- 3.12. `from __future__ import annotations` at the top. `dict[str, Any]`,
  `str | None`; never `Dict`, never `Optional`.
- Standard library only; the Lambda runtime provides nothing else and the
  Terraform `archive_file` zips the source as-is.
- Single quotes, line length 120, `pathlib.Path`, comprehensions, `match` over
  `isinstance` chains, early returns.
- Tests are `test_*.py` / `*_test.py` beside the module and run with
  `python3 -m pytest -q modules/app/s3-cloudfront-spa/edge modules/app/appsync`
  (CI runs exactly that).

## Terraform / Terragrunt

- `terraform fmt -recursive` and `terragrunt hcl fmt` before committing; CI
  checks both. `scripts/validate-modules.sh` and
  `terragrunt hcl validate --inputs --working-dir live` must pass.
- snake_case names. `for_each` over `count` for collections; `count` only for a
  boolean toggle. `dynamic` blocks for conditional sub-blocks. `locals` for
  derived values that are reused.
- Variable types are explicit `object({...})` with `optional(field, default)`;
  `map(object({...}))` for collections; `validation` blocks for enum and format
  constraints. Avoid `any`.
- `data "aws_*"` and Terragrunt `dependency` outputs for cross-stack lookups;
  never hard-code an ARN, account id, zone id, or hostname. Environment
  specifics come from `live/<env>/env.hcl`, which reads them from environment
  variables listed in `.env.example`.
- AWS managed policies by their published ARN; do not re-author them inline.
- A module's file-head comment captures the architectural WHY. No change log.
- `mock_outputs` use the all-zero account id and `example.com` hostnames;
  nothing else is allowed by the sanitization guard.

## Mock and example data

The guard rejects, anywhere but `README.md` for the last item: real-looking
12-digit account ids, Route 53 zone ids, AWS access keys, private keys, JWTs,
Slack and Stripe-style tokens, Salesforce record ids, email addresses outside
RFC 2606 example domains, concrete Glean tenant hostnames, the source project's
hostnames and name. Use `example.com`, `ada@example.com`,
`https://mcp.example.portal.example.com`, `itm_7Kf3Qb9RtX2mLp`-shaped ids, and
the all-zero account id. Run `scripts/check-sanitized.sh` before every push.

## Auth and perimeter

- One origin per environment: `<env>.<domain_root>` serves the portal and the
  developer portal through CloudFront; GraphQL and MCP get white-label
  hostnames in the same zone (`gql.<env>.<root>`, `mcp.<env>.<root>`). The edge
  does routing only; authorization happens where the data lives.
- Cognito Hosted UI with PKCE for the SPAs; the pre-sign-up trigger enforces the
  email-domain allowlist and the token verifiers check it again.
- The MCP server is an OAuth 2.1 resource server with Dynamic Client
  Registration over Cognito; access tokens are scoped `<mcp-url>/read` and
  `/write`. Opaque API keys ride the same unified authorizer AppSync uses.
- Writes need a person. OAuth connections carry one in the token; key
  connections pass `x-user-email` or `currentUserEmail`. There is no fallback
  identity, on purpose. Do not add one.
- Assistant-initiated creates land as `DRAFT` and are hidden from reads, search,
  and the Glean index until a writer approves them in the portal. Keep that
  state machine when you port the pattern to a new domain;
  `items-review.integration.spec.ts` is the spec to copy.
- Anything that keys off the origin (Cognito callback URLs, the RUM domain
  list, Glean redirect URIs, CSP) is derived from `env.hcl`; change it there.

## MCP changes

A change to an MCP tool, argument, description, annotation, or returned field
includes the Glean skill in the same change: `docs/mcp/skills/example/SKILL.md`
(the router row if the job changed, the Capabilities bullet, and that tool's
section) and `docs/mcp/skills/example/agent-instructions.md` if the attached
set or a Builder setting changed. Chat follows the skill, so a field the skill
does not mention does not reach the answer. The rules for descriptions, schema
field text, and skill sections are in
`apps/dev/docs/mcp/skill-authoring.md`; read it before editing either.

After deploying `app/mcp`, re-sync the catalog in the Glean admin console
(the server connection → Edit settings → Save) whenever a tool name,
description, or schema changed. Output-only changes still need the skill
update; they do not need the re-sync.

Host-injected arguments (`_user_goal`) are dropped by the argument gate's
`HOST_INJECTED_ARGUMENTS`; add a new one there, not to every tool. Keep
`routing.spec.ts` honest when you reword a description.

## Narrowing a shared read path

Making a shared query, resolver, or serializer return **less** (dropping
fields, skipping joins, adding a `lean` or `summary` mode) fails silently: less
data arrives as `0` / `[]` / `null`, which is type-valid and plausible. Types
do not catch it, nothing throws, the UI renders defaults.

- Enumerate every caller of the flag before changing what it returns. Grep the
  whole repository. Right for one caller and wrong for another means two paths,
  not one flag with two meanings.
- New parameter over repurposing an old one. Delete parameters that stopped
  doing anything; never leave them parsed.
- Test both sides: the narrow path returns less **and** the wide path does not.
- Assert what the caller sends, not only what the server builds.
- Uniformly populated fixtures cannot reveal a missing-data bug.

## Two-PR rule

Removing a resource **and** the block that references it (a route and its
authorizer, an output and its consumer) ships as two PRs and two applies. A
single-apply removal races.

## Branching and shipping

- Start every change on a fresh branch off `origin/main`; never commit on
  `main`: `git fetch origin main && git checkout -b <name>/<short-desc> origin/main`.
- One shippable change per branch. Keep PRs small and focused.
- Keep committing to the current branch while iterating on the same unmerged
  change. Start a new branch when the topic is new or the current one has
  merged.
- Sync with `main` before every PR:
  `git fetch origin main && git merge --ff-only origin/main` (or rebase). Do not
  open or merge a PR whose branch is behind `main`.
- "Ship it" = validate → commit → push → PR → verify the PR head SHA matches
  the push → wait for the four CI jobs → squash-merge → deploy to a **confirmed**
  environment. The deploy environment is always confirmed with a human first,
  never assumed. Steps and commands are in `.claude/skills/ship`.

## Commits

- Do not auto-commit or auto-push. Wait for an explicit instruction.
- Subject ≤ ~70 characters, present tense, scoped prefix: `api:`, `mcp:`,
  `authorizer:`, `stream:`, `workers:`, `portal:`, `dev:`, `infra:`, `edge:`,
  `docs:`, `ci:`, `chore:`.
- Body for the non-obvious WHY. Bug context goes here, not in a comment.
- No `Co-authored-by`, no AI attribution. Author is the contributor running the
  agent, from `git config user.{name,email}`; if that is unset, ask.

## File creation

- Prefer editing existing files.
- No README, docs, or planning files unless asked. The developer portal
  (`apps/dev/docs/`) is where operational documentation lives.
- No emojis unless asked.
- Anything written only to verify a change lives outside the repository
  (`/tmp`) or is removed before the PR.

## Skills

`.claude/skills/<name>/SKILL.md`; invoke with `/<name>` or the Skill tool.
`code-style`, `typescript`, and `python` apply automatically on edits in their
languages. `developer`, `tester`, `source-control`, `writer`, `writing-style`,
`web-style`, and `ship` are invoked for a job. `.claude/README.md` lists them.
