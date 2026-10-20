---
name: developer
description: Implement a change in this repository end to end - understand the layer it touches (backend, portal, developer portal, Terraform, workflows), make the change to the repository's conventions, run exactly the checks CI runs for that layer, and hand off a PR a reviewer can merge. Use when implementing features or fixes, writing tests, debugging, or refactoring.
---

# Developer

You implement changes in this repository: a Node Lambda backend, two Vite /
Docusaurus front ends, Terraform modules with Terragrunt stacks, and GitHub
Actions workflows. The rules live in `AGENTS.md`; the language patterns in
`code-style`, `typescript`, and `python`. This skill is the working procedure.

## Before writing code

1. **Find the layer.** Backend (`backend/`), portal (`apps/portal/`),
   developer portal (`apps/dev/`), infrastructure (`modules/`, `live/`),
   workflows (`.github/`), documents (`docs/`). A feature often touches two:
   a GraphQL field and a view, a tool and its skill, a module and its stack.
2. **Read the neighbours.** The resolver, module, or view next to the one you
   are changing is the style guide. The `backend/README.md` sections *Adding a
   GraphQL field* and *Adding an MCP tool*, and the root README's *Replacing
   the example domain*, are the checklists for new surfaces.
3. **Branch.** `git fetch origin main && git checkout -b <name>/<short-desc> origin/main`.
   Never on `main`.
4. **Decide the test first.** Which spec proves the change: a unit spec beside
   the code, an integration spec on embedded Postgres, a routing or protocol
   pin, a Python test, a Terraform validate. Write or extend it as you go, not
   after.

## Making the change

- **Shared paths stay shared.** A permission check belongs in the resolver,
  not the tool or the field. A tool is an adapter over a resolver. If the
  GraphQL API and the MCP server could disagree after your change, the change
  is in the wrong place.
- **Schema first.** A new field starts in `backend/schema.graphql`; a new
  column starts as a migration under `backend/migrations/` (idempotent, then
  `gen-migrations.mjs`); a new tool starts as a `ToolDefinition` with a closed
  schema.
- **Identity is a parameter.** No ambient user. Writes without a person fail.
- **Opaque ids.** A new entity gets a prefixed id minted in TypeScript and an
  `external_id` satellite for its upstream key.
- **MCP tool changed?** The skill changes in the same commit:
  `docs/mcp/skills/example/SKILL.md` and, if the attached set or a Builder
  setting changed, `agent-instructions.md`. Rules in
  `apps/dev/docs/mcp/skill-authoring.md`.
- **Narrowing a read path?** Enumerate every caller first; test both sides.
  `AGENTS.md`, *Narrowing a shared read path*.
- **Terraform.** `for_each` over `count`, explicit `object({...})` types with
  `optional()`, `validation` blocks, outputs for anything another stack
  reads, nothing hard-coded that `env.hcl` can supply.
- **Comments.** Default none. One line for a WHY a reader would miss. Bug
  context in the commit body.
- **No secrets, no real identifiers.** `example.com`, the all-zero account id,
  placeholder tokens. The guard will stop you otherwise.

## Checks, per layer (run what you touched; CI runs all four jobs)

| Layer | Commands |
|---|---|
| `backend/` | `npm run lint && npm run typecheck && npm test && npm run build`; after a migration also `node apps/workers/migrate/gen-migrations.mjs && git diff --exit-code -- apps/workers/migrate/src/migrations.generated.ts` |
| `apps/portal/` | `pnpm exec tsc -b && pnpm exec eslint . && pnpm exec vitest run && pnpm exec vite build` |
| `apps/dev/` | `pnpm typecheck && pnpm build` (then read the build log for `[WARNING]` broken-link lines) |
| `modules/`, `live/` | `terraform fmt -recursive -check && terragrunt hcl fmt --check && scripts/validate-modules.sh && terragrunt hcl validate --inputs --working-dir live` |
| Python helpers | `python3 -m pytest -q modules/app/s3-cloudfront-spa/edge modules/app/appsync` |
| `.github/workflows/` | `actionlint .github/workflows/*.yml` |
| Everything | `scripts/check-sanitized.sh` |

A failing check is a stop, including a failure you believe you did not cause.
Fix it or explain it in the PR; do not merge around it.

## Debugging

1. Reproduce it with a spec or a `curl` against a deployed environment, not by
   reading code until it looks right.
2. For an MCP problem, read the two log groups first (`apps/dev/docs/mcp/design.md`,
   *What is logged*): the access log says whether the request reached the
   Lambda; `mcp.denied`, `mcp.register`, and `mcp.tools_call` say what it did.
   The host test matrix (`apps/dev/docs/mcp/host-test-matrix.md`) lists what
   each stage should show.
3. For a GraphQL problem, `schema-registry.spec.ts` and the AppSync resolver
   list from the module tell you whether the field is wired at all.
4. For an auth problem, `whoAmI` from the host and the roster row in
   `app.access_roster` settle "no identity" versus "no permission".
5. Fix the cause. Add the spec that would have caught it. Put the story in the
   commit body.

## Hand-off

The PR says: the problem, the cause, the change, how it was tested, and
anything a reviewer must decide. One shippable change per PR. Small. If the
change has a deployable artifact, say which stack or app and leave the target
environment for a human to confirm (`ship`).
