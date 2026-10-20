---
name: ship
description: Delivery workflow for this repository - validate the layer you changed, sync with main, commit, push, open the PR, verify the PR head SHA matches your push, wait for the four CI jobs, squash-merge, then dispatch infra-deploy or spa-deploy to an environment a human has confirmed. Invoke when asked to "ship it".
---

# ship

The path from a validated change to running in a deployed environment. It
ends at a green deploy (or at merge, for changes with no deployable artifact),
not at "PR opened". Commit, push, PR, and merge are automatic once shipping is
requested. **The deploy environment is never assumed; a human confirms it.**

## 0. Validate (stop if anything fails)

Run the checks for every layer you touched; CI runs all of them as four jobs.

| Layer | Commands |
|---|---|
| `backend/` | `cd backend && npm run lint && npm run typecheck && npm test && npm run build`; after a migration also `node apps/workers/migrate/gen-migrations.mjs && git diff --exit-code -- apps/workers/migrate/src/migrations.generated.ts` |
| `apps/portal/` | `cd apps/portal && pnpm exec tsc -b && pnpm exec eslint . && pnpm exec vitest run && pnpm exec vite build` |
| `apps/dev/` | `cd apps/dev && pnpm typecheck && pnpm build` |
| `modules/`, `live/` | `terraform fmt -recursive -check && terragrunt hcl fmt --check && scripts/validate-modules.sh && terragrunt hcl validate --inputs --working-dir live` |
| Python helpers | `python3 -m pytest -q modules/app/s3-cloudfront-spa/edge modules/app/appsync` |
| `.github/workflows/` | `actionlint .github/workflows/*.yml` |
| always | `scripts/check-sanitized.sh` |

Also:

- You are on a feature branch, not `main`:
  `git fetch origin main && git checkout -b <name>/<short-desc> origin/main`.
- Author is the human's identity from `git config user.{name,email}`. No
  `Co-authored-by`, no AI attribution.
- An MCP tool change has its skill change in the same diff
  (`docs/mcp/skills/example/`).

## 0.5. Sync with main (stop if it cannot fast-forward)

```bash
git fetch origin main
git merge --ff-only origin/main   # or: git rebase origin/main
```

If that fails the branch is behind: merge or rebase, resolve, then re-run §0.
Never open or merge a PR whose branch is behind `main`.

## 1. Commit and push

Stage only this change's files. Scoped subject prefix (`api:`, `mcp:`,
`authorizer:`, `stream:`, `workers:`, `portal:`, `dev:`, `infra:`, `edge:`,
`docs:`, `ci:`, `chore:`), ≤ ~70 characters, present tense; body for the
non-obvious WHY. Make the edits, then stage, then commit, as separate steps;
an amend issued in the same batch as an edit can capture the file before the
edit lands.

```bash
SHA=$(git rev-parse HEAD)
git push -u origin <branch>
```

## 2. PR

```bash
gh pr create --base main --head <branch> --draft --title "<prefix>: ..." --body "..."
```

Body: problem, cause, change, tests run (with counts), anything a reviewer
must decide.

## 3. Verify the head SHA before anything else

GitHub's PR head can lag a fresh push; merging a stale head ships the wrong
commit.

```bash
HEAD=$(gh pr view <n> --json headRefOid -q .headRefOid)
[ "$HEAD" = "$SHA" ] && echo ok || echo "MISMATCH: wait, re-check, do not merge"
```

## 4. CI

`ci.yml` runs four jobs on every PR: `infra`, `backend`, `portal`,
`dev-portal`. Wait for all four green:

```bash
gh run list --branch <branch> --json databaseId,status,headSha
gh run watch <run-id> --exit-status
```

Never merge red. Never bypass a check. A failure you believe you did not
cause is still a stop: fix it or explain it in the PR.

## 5. Squash-merge

```bash
gh pr ready <n>
gh pr merge <n> --squash --delete-branch --match-head-commit "$SHA"
git checkout main && git pull
```

`--match-head-commit` refuses the merge if the head moved since you checked.
Record the merge commit from `gh pr view <n> --json mergeCommit`.

## 6. Deploy

**Ask which environment and wait for the answer, even when there is only one
or the choice seems obvious.** Shared environments are disrupted by a deploy
to the wrong one. Deploy only the confirmed environment.

Both workflows are `workflow_dispatch` only and read the environment's inputs
from the GitHub Environment of the same name.

- **Backend or infrastructure** (`infra-deploy.yml` builds `backend/`, then
  `terragrunt apply`):

  ```bash
  gh workflow run infra-deploy.yml --ref main -f env=<confirmed> -f stack=<group/stack> -f ref=main
  ```

  One stack per changed component (`app/mcp`, `app/appsync`,
  `data-pipeline/item-sync`); `stack=all` only for a broad change. `app/*`
  stacks apply `data-pipeline/aurora-migrate` first, so a code deploy never
  outruns its schema.

- **Web app or developer portal** (`spa-deploy.yml`):

  ```bash
  gh workflow run spa-deploy.yml --ref main -f env=<confirmed> -f app=<portal|dev> -f ref=main
  ```

Watch with `gh run watch <id> --exit-status` and report the result.

Docs, skills, workflow, and `.claude/` changes have no deployable artifact;
they end at merge. Say so rather than asking about a deploy.

## 7. After an MCP deploy

If a tool name, description, or schema changed, re-sync the catalog in the
Glean admin console (the server connection → Edit settings → Save) and
re-publish the skill where the tenant manages skills; then run the proving
prompts in `apps/dev/docs/mcp/skill-authoring.md`. The host test matrix
(`apps/dev/docs/mcp/host-test-matrix.md`) is the full check for a new
environment.

## Which stack builds what

`live/<env>/<group>/<stack>/terragrunt.hcl` is one stack. The GraphQL
dispatcher is `app/appsync`; the MCP server is `app/mcp`; the authorizer,
stream, warmer, RUM, and SPA distribution are the other `app/*` stacks;
scheduled workers are `data-pipeline/*`. If unsure which stack bundles a
Lambda, grep `live/<env>/*/*/terragrunt.hcl` for its `source` module.
