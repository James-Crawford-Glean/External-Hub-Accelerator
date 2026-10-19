# Portal Accelerator: extraction plan and inventory

> Record of the extraction of this repository from the source project (Glean's internal partner account-planning portal, named in the README), as planned and tracked on its branch `cursor/portal-accelerator-deploy-fb3e` (last updated at `1c26b71`). Kept as written; paths under `accelerator/` in the source branch are this repository's root.

## Goal

Turn the source project into a reusable, sanitized reference implementation that a
customer or developer can clone to build their own Glean-integrated data portal
on AWS, paired with a technical white paper. Deliverables: a standalone GitHub
repository (Terraform/Terragrunt, backend, UI apps, README) and the paper.
Internal review first, then publication together.

## Decisions (recorded)

| Question | Decision |
|---|---|
| Scope | Domain-neutral platform plus one small example domain (option B). The source project's partner/account/opportunity model becomes the example, not the core. |
| Glean surfaces | All four: MCP server with read/write guardrails, Glean chat streaming, per-user Glean OAuth, Indexing API. Email/calendar sync documented as the worked example of Glean → hub data flow. |
| Environments | Keep the multi-env promotion pattern (`live/<env>/`, GitHub Environment-pinned OIDC trust). |
| Aurora | Stays. Aurora Serverless v2 + Data API is the primary store; DynamoDB for identity, keys, caches, run logs. |
| Partner sandbox | Deferred. `live/partners` and `modules/partner-sandbox` are not copied. The Indexing API client inside `apps/api/src/sandbox-access` is extracted into a standalone lib regardless. |
| Fork vs copy | Clean copy. A GitHub fork carries all history (deleted partner data, screenshots, rotated secrets) and cannot change visibility independently of the private parent. The new repo receives the sanitized tree as its first commit. |
| Visibility | Internal (private) first; publish after review with Alex. License to be chosen before publication (`apps/ps/LICENSE` is MIT, Glean Technologies Inc; the repo root has none). |
| Wait for OAuth / email sync? | No. MCP OAuth is implemented and enabled in `js-dev`; the accelerator ships it as the default path. Email/calendar sync has no design yet; the accelerator ships the extension point and the paper marks it planned. |
| Verification account | A new, empty member account in the AWS org (requested from the org admin; the requester's management-account role is billing-only). Until it exists, verification is static: `terraform validate`, Terragrunt input checks, unit tests, sanitization guard. |

## Verified source inventory

Taken from `main` at `0193970` (552 commits). Where the repo's own docs
disagree with the tree, the tree wins.

### Components

| Area | What's there | Notes |
|---|---|---|
| Infra modules | 96 `.tf` files in `modules/{infra,app,data-pipeline,migration,partner-sandbox}` | 43 contain the project name as a literal. |
| Live envs | `dev`, `uat`, `js-dev`, `experimental`, `next` (production apex), `partners`, `_shared` | Account id via `get_env("AWS_ACCOUNT")`; domain, zone id, allowlist literal in each `env.hcl`. |
| Backend | `lambda-backend/`: TypeScript, apps `api`, `authorizer`, `mcp`, `stream`, `tools`, `workers`; 28 libs; 81 Aurora migrations; 150 spec files | The only backend. `AGENTS.md` and `lambda-backend/README.md` still describe a Python `lambdas/` workspace that no longer exists. |
| SPA | `apps/ps` (Vite + React, 45 unit tests, Playwright e2e) | `apps/administrative` referenced in docs does not exist. |
| Developer portal | `apps/dev` (Docusaurus; GraphQL + MCP guides, generated schema reference) | |
| CI | `infra-deploy`, `spa-deploy`, `lambda-backend`, `partner-sandbox-infra`, `promotion-ledger`; all `workflow_dispatch` | Terraform 1.15.4, Terragrunt 1.0.6. |
| Side artifact | `apps/ps/infra`: CDK app for a Glean-OAuth-gated static mockup | Not part of the Terragrunt tree. Dropped. |

### Glean integration surfaces (implemented vs planned)

| Direction | Surface | State in source | Accelerator plan |
|---|---|---|---|
| Hub → Glean | MCP server: 16 tools, AE scoping, writes land as `DRAFT` for review in the notification center (`apps/mcp`) | Implemented | Core. Tools split into platform scaffolding + example-domain tools. The draft shape is carried into the example domain: `createItem` writes `DRAFT`, `approveItem` / `rejectItem` publish or discard it, the owner is notified (increment 4 follow-up). |
| Hub → Glean | MCP as OAuth 2.1 resource server + DCR, Cognito as AS (`apps/mcp/src/auth`) | Implemented; enabled only in `js-dev` (`OAUTH_PUBLIC_URL`) | Core, default-on. |
| Hub → Glean | Indexing API push of portal records | Not implemented in the source project. Only `sandbox-access` uses `/api/index/v1/{adddatasource,indexemployee,bulkindexemployees,deleteemployee}` for sandbox employees | **Implemented in the accelerator (increment 4)**: `backend/libs/glean-index` (datasource registration, single and bulk document index, delete, token redaction) and the `glean-index` worker pushing the example domain with permissions derived from row visibility; incremental on a schedule, full re-index from the admin screen. Not yet exercised against a real tenant. |
| Glean → Hub | Per-user Glean OAuth connect, token custody in Aurora `app.glean_tokens` (`libs/glean` GleanService) | Implemented | Core. |
| Glean → Hub | Chat streamed into the SPA (`apps/stream`, SSE) | Implemented | Core. |
| Glean → Hub | Glean-hosted people photos (`libs/avatar`) | Implemented | Core (small). |
| Glean → Hub | Email / calendar sync | Not implemented. Related: outreach drafting via Glean's `GMAIL_CREATE_EMAIL_DRAFT` action (draft only); activity calendar UI (portal data); PE digest to Slack | Planned. Ship the extension point (scheduled worker + Glean token custody); paper marks it planned with a one-page design. |
| Edge | Glean as authorization server gating a static site (CDK mockup) | Implemented, separate stack | Dropped. |

## Core vs example domain

**Core (platform).** Keeps its code, loses its names.

- Infra: `network`, `aurora-postgres`, `aurora-schedule`, `dynamodb-tables`, `cognito`, `secrets-store`, `github-oidc`, `billing`, `observability` (function list becomes an input), `logo-cache` (optional enrichment).
- App: `s3-cloudfront-spa`, `appsync` (minus Salesforce secret, Slack token, sandbox approver role, indexing-token writer, upload bucket; those move to example or are dropped), `authorizer`, `mcp`, `glean-stream`, `lambda-warmer`, `rum`.
- Pipeline: `aurora-migrate`.
- Backend libs: `aurora`, `authz`, `cache`, `credentials`, `di`, `glean`, `identity`, `log`, `login-events`, `metrics`, `sql`, `testkit`, `urls`, `validation`, `worker`, `avatar`, `logo`, plus a new `glean-index` extracted from `sandbox-access`.
- Backend apps: `api` (dispatcher + platform resolvers: me, users, api keys, Glean connect), `authorizer`, `mcp` (server + auth + platform tools), `stream`, `workers/{migrate,warmer}`.
- SPA shell: auth (Cognito PKCE), layout, Glean connect + chat panel, settings/admin for users and API keys, design system.
- DynamoDB platform tables: `api_keys`, `enrichment_cache` (users, roster, and run logs live in Aurora).

**Example domain.** Reduced to the smallest set that exercises every path: one entity with a list and detail view, one scheduled sync worker from a stub upstream, one MCP read tool, one in-place write tool, one create tool that lands as a reviewable draft, one Indexing API push. The source project's full partner/account/opportunity/PE model, Salesforce sync workers, mapping uploads, exports, data-quality flags, and the Slack digest are **not** carried.

**Dropped.** `modules/migration/backfill` (V1 Supabase), `modules/partner-sandbox` and `live/partners`, `scripts/admin`, `scripts/supabase-backfill`, `integration/` probes, `plans/`, `docs/` (rewritten, not copied), `apps/ps/infra` CDK mockup, `pe-digest`, `avatar-sync`, `mapping-retention`, `account-sync`, `opportunity-sync`, `user-sync`, `logo-enrich` (the generic logo cache stays; the Salesforce-driven enrichment job does not).

## Sanitization

Counts in the source (files, excluding lockfiles): the production hostname 65, `glean.com` 175, the demo tenant's hostname 25, the GitHub organization name 5, the source account id ~10 (including `.github/workflows/spa-deploy.yml`, `apps/ps/.env.example`, `apps/ps/infra/bin/app.ts`), partner-sandbox account id 11, Route53 zone id 7, the project name as a literal in 43 `.tf`, 62 backend source files, 28 SPA source files.

Rules applied in the accelerator:

- `project` is a single literal in `root.hcl`; every resource name is `${project}-<thing>-<env>`; modules take `var.project` where they build names or tags. The state bucket is `<project>-tf-state-<account>`.
- Account id, region, domain root, zone id, email allowlist, and Glean base URL are read from environment variables in `env.hcl` (`.env.example` lists them). No defaults for the identifying ones.
- No personal emails in infra (`SLACK_ALERT_MATT_EMAIL` in `live/dev/app/appsync` is an example of what gets dropped).
- `scripts/check-sanitized.sh` fails CI on: non-mock 12-digit account ids, Route53 zone ids, AWS access keys, private keys, JWTs, Slack tokens, Salesforce record ids, email addresses outside `example.com`, the source project's hostnames, concrete Glean tenant backends (`<x>-be.glean.com`), and the source project's name outside the README's provenance line.

Content that must not ship regardless of naming: `docs/pe-owner-salesforce-entry.csv` (real partners + Salesforce ids), `docs/env-promotion.md` (pipeline dollars, partner names), `docs/partner-sandbox.md` (role ARNs), `apps/ps/shot_*.png` (partner names, pipeline figures, employee names), `plans/`, `docs/agents/`, `scripts/admin/`, git history.

## Increments

Each lands as its own PR against the source repository under a top-level `accelerator/` directory; that directory became this repository's first commit.

1. **Foundation (this PR).** `root.hcl`, `bootstrap/`, `live/_shared`, `live/_envcommon`, `live/example` (13 stacks), 14 modules (`network`, `aurora-postgres`, `aurora-schedule`, `dynamodb-tables`, `cognito`, `secrets-store`, `github-oidc`, `billing`, `s3-cloudfront-spa`, `authorizer`, `lambda-warmer`, `glean-stream`, `rum`, `aurora-migrate`), `.env.example`, `README.md`, `scripts/check-sanitized.sh`, `scripts/validate-modules.sh`, `.github/workflows/ci.yml`. Verified: `terraform validate` on all 14 modules, `terragrunt hcl validate --inputs` on all 14 stacks (13 in `example` plus `_shared/github-oidc`; required inputs satisfied), `terraform fmt` and `terragrunt hcl fmt` clean, edge handler tests (16) pass, sanitization guard clean.
2. **API layer (done).** `appsync` reduced to platform scope: Node-only dispatcher, schema-driven resolvers, optional CSV exports (`exports_worker_dir`), a generic `invoke_function_arns` hook in place of the five partner-specific worker grants; Salesforce secret, Slack token, sandbox approver, sandbox auto-approve Lambda, indexing-token writer, uploads bucket + mapping worker, and the validate worker are dropped. `mcp` with `oauth` required (default-on), `custom_domain` required (the OAuth resource identifier needs a stable host), uploads path removed, `invoke_function_arns` hook added. `observability` takes `lambda_function_names`, `scheduled_function_names`, `aurora_cluster_identifier`, `perf_metrics_namespace`, `rum_app_monitor_name` as inputs. Cognito's `mcp` resource server is enabled in `live/example`; the authorizer accepts MCP access tokens. `parse-schema_test.py` rewritten against an inline fixture. Verified: `terraform validate` on 17 modules, `terragrunt hcl validate --inputs` on 17 stacks, DAG acyclic, parse-schema tests (7) and edge tests (16) pass, guard clean. `terragrunt run --all plan` still waits on the verification account. Review fix: the `users` and `sync_runs` DynamoDB tables from increment 1 are removed from `live/example/infra/dynamodb`; the backend keeps both in Aurora (`app.users`, `app.sync_runs`) and reads only `api_keys` and `enrichment_cache` from DynamoDB. Also folded in: the DynamoDB lock table left over from increment 1 is gone everywhere (bootstrap resource and output, the bootstrap's own backend config, the github-oidc `lock_table_arn` input and `StateLock` grant); locking is the S3-native lockfile only, and the Terraform floor is 1.10 accordingly.
3. **Backend (done, platform scope).** `backend/` holds 19 libs (`di`, `log`, `metrics`, `aurora`, `credentials`, `worker`, `cache`, `urls`, `logo`, `glean`, `avatar`, `access-requests`, `login-events`, `sync-runs`, `roster`, `authz`, `identity`, `sql`, `testkit`), six apps (`api`, `authorizer`, `mcp`, `stream`, `workers/migrate`, `workers/warmer`), four consolidated migrations (`app.users` + view prefs; roster + access requests + login events; Glean OAuth tables + avatars; warmer config, sync runs, export jobs, notifications), and a platform `schema.graphql` (24 fields: 11 Query, 13 Mutation). Rewritten rather than copied: `roster` (roles `ADMINISTRATOR` / `EDITOR` / `VIEWER`, no seed rows, no Salesforce-title derivation), `authz` (`requireWrite` replaces `requirePartnerSide`; generic `visibilitySql`), `identity` (registry only; no Salesforce id mapping), `users` resolver, `roster` resolver, the MCP tool set (`whoAmI`, `listUsers`), a shared `tools/call` argument gate (`apps/mcp/src/mcp/validate.ts`: type, required, closed properties, enum, range, length, with unambiguous scalar coercion; violations are a JSON-RPC `-32602` that never reaches a handler), the MCP `/logos` route (keyed by domain through `LogoService`). The email-domain allowlist and DCR redirect hosts are configuration (`ALLOWED_EMAIL_DOMAINS`, `oauth.redirect_hosts`) instead of `glean.com` defaults; the EMF namespace, portal name, and Glean DCR client name are env vars. Not carried: Salesforce sync, uploads/mapping, exports worker, validation, PE, Slack, sandbox-access, title-role, directory, every partner-domain resolver and tool. Verified: `tsc`, `eslint` (0 warnings), 37 jest suites / 274 tests including two pglite integration specs that run the real migrations (users + roster + authz flow; MCP initialize / tools/list / tools/call with the provenance envelope), `esbuild` produces the six bundles the Terraform stacks reference. Deferred to the example-domain increment: the `glean-index` lib (Indexing API client) and a CSV export worker; `exports_worker_dir` is empty in `live/example` until then.
4. **UI + example domain + Indexing API (done; PR stacked on #580).**
   - **Example domain** (`backend/libs/items`, `apps/api/src/items`, migration `100_example_items.sql`, 10 schema fields): one entity with visibility-scoped reads, write-gated mutations, an `item-sync` worker upserting by `external_id` from a fixture upstream (`UPSTREAM_URL` swaps in a real one) and resolving owners into the registry, and three MCP tools (`searchItems`; `updateItem`, whose in-place write is gated by the MCP annotation that makes the host confirm with the user plus server-side `requireWrite`, with the acting-user rule; `createItem`, below). Schema is now 34 fields (15 Query, 19 Mutation).
   - **Review guardrail** (follow-up on #582, mirroring the source project's activity drafts): `items.status` gains `DRAFT` and `REJECTED` next to the live `ACTIVE` / `ARCHIVED`, plus `reviewed_at` / `reviewed_by_*`. The MCP `createItem` tool (`CREATES_RECORDS`) writes a `DRAFT` owned by the acting user and inserts an `app.notifications` row (`item_draft`) linking to it; SPA and GraphQL `createItem` still write `ACTIVE`. Default reads, `searchItems`, and the Glean indexer see live rows only (`draftsOnly` or an explicit status opens the review queue; the incremental indexer deletes a row that left the live set). `approveItem` (→ `ACTIVE`) and `rejectItem` (→ `REJECTED`, kept for audit) require write access and update only `WHERE status = 'DRAFT'`, so a repeat or a cross transition is a no-op that returns the row unchanged. `createItem` is idempotent the way the source project's `createActivity` is: acting user + normalized name among pending drafts is the key, a retried call returns the first draft with `idempotent: true` and writes no second row or notification, approval releases the key, and a partial unique index (`items_pending_draft_uidx`) is the backstop for two retries racing past the lookup. SPA: writers get *Drafts awaiting review* / *Rejected* in the items status filter, the detail view shows a review banner with Approve / Reject, the bell links to the draft. Spec: `items-review.integration.spec.ts` (14 cases over the real migrations: create via MCP with and without an acting user, idempotent retry, per-user key, concurrent race, hidden-by-default including a `status: ['DRAFT']` probe stopped at the argument gate and the handler clamp beneath it, viewer denied, in-place edits cannot enter or leave the review states, both transitions, key released by approval, both no-ops, indexer live-only + delete).
   - **Indexing API**: `backend/libs/glean-index` + `apps/workers/glean-index`; see the surfaces table.
   - **Infra**: one generic `modules/data-pipeline/scheduled-worker` (Lambda + EventBridge + Aurora IAM + named secret reads + invoke-on-apply) in place of the source project's per-entity sync modules; `live/example` gains `data-pipeline/item-sync` and `data-pipeline/glean-index`, the `glean-indexing-token` secret slot, the appsync invoke hook for `triggerGleanIndex`, and both workers on the dashboards. 19 stacks, 18 modules.
   - **SPA** (`apps/portal`): the shell, capability gates, and every view rewritten over the copied UI kit, styles (pruned from 7.4k to 2.4k CSS lines by removing rules no component uses), OIDC user manager, telemetry, and GraphQL client. Views: home (metrics, recent items, "Ask Glean" streaming chat), items list/detail/edit, people, roles & access (grant/change/remove + pending requests), API keys, Glean (endpoint, connection, indexing runs + re-index), login activity, AWS links. No demo/seed mode: an unconfigured build shows a configuration notice.
   - Verified: backend `tsc`, `eslint`, 40 jest suites / 300 tests (two new pglite integration specs: sync → read/write → visibility → Indexing push against a fake Glean; the DRAFT → review state machine); 8 bundles; SPA `tsc`, `eslint` 0 errors, 17 vitest cases including a jsdom suite rendering every route against mocked API modules, production build; all 18 modules `terraform validate`, all 19 stacks `hcl validate --inputs`, DAG acyclic; guard clean.
   - Dropped from scope: the developer portal (`apps/dev`) moves to increment 5 with the deploy workflows; its GraphQL reference should be generated from the final schema.
5. **Deploy workflows + developer portal (done; PR stacked on #582).** `infra-deploy.yml` (env + stack inputs, OIDC via the GitHub Environment claim, every `env.hcl` input from GitHub Environment variables with an early check, backend bundles built first, `run --all` or one stack with the `aurora-migrate` preflight, public URLs in the step summary) and `spa-deploy.yml` (builds `apps/portal` or `apps/dev` against Terraform outputs, refuses a build with any live value missing, single-page vs multi-page cache policy). There is no separate backend-deploy: code deploys are `infra-deploy` with a stack path. `apps/dev`: Docusaurus at `/dev/` (`live/example/env.hcl` lists `dev` in `spa_apps` and `spa_static_apps`, so the edge resolves per-route objects for deep links and Cognito registers the `/dev/` callback) with the Cognito-gated GraphiQL sandbox and the GraphQL reference generated from `backend/schema.graphql` (71 pages); docs rewritten for the platform (overview of three surfaces and both directions, GraphQL conventions and four auth paths, Node client, MCP transport/auth/acting-user/tool catalog/review gates/result contract, Indexing push). README gains *What the first real deploy needs* (AWS, DNS, identity provider, Glean tenant inputs), the CI-based deploy steps, and *Deploying changes*. Verified: `actionlint` clean on three workflows; `apps/dev` `tsc` and `docusaurus build` clean; guard clean. **Open:** the from-scratch apply in an empty account, the only step that needs AWS. The README lists its inputs exactly.
6. **End-to-end.** From-scratch apply in the verification account; README steps re-walked and corrected to what was actually run; first run of the Indexing push against a real tenant.
7. **White paper.** Markdown in the repo plus a shareable document. Sections: problem, architecture, the two integration directions with the implemented/planned line drawn from the table above, guardrails, how to adapt, what the source project runs in production.

## Open items

- Empty AWS member account and Glean tenant settings (OAuth AS, DCR allowlist, indexing token) for increment 5.
- Target repo: https://github.com/James-Crawford-Glean/External-Hub-Accelerator (created 2026-10-15). Currently **public** and under a personal account; the agreed sequence is private until Alex has reviewed, and organization ownership so the repo outlives the internship. Both are settable before the first import.
- License choice before publication.
- Email/calendar sync: a one-page design so the paper's planned section describes an intended architecture, and so the source project's implementation lands in a domain-neutral lib the accelerator can take unchanged.
- Promote MCP OAuth beyond `js-dev` in the source project so the paper can cite it as the production path.
- Rewrite `AGENTS.md` for the Node backend (both here and in the accelerator); the Python sections are stale.
- Indexing API: the client and worker exist (increment 4) but have not been run against a real Glean tenant; the datasource registration body (`objectDefinitions`, `urlRegex`) follows the public Indexing API docs and should be confirmed on first use.
