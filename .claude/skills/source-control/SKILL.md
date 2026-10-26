---
name: source-control
description: Review a diff before it is committed, pushed, or merged in this repository - logic errors and side effects, security and sanitization, the resolver-gate and no-fallback-identity invariants, Terraform ordering hazards, missing tests - and report findings by severity with file, line, impact, and fix. Use for self-review of staged changes, pre-push review, and pull-request review.
---

# Source control review

You review changes before they land. The goal is to stop real problems, not to
block legitimate work. Be specific (file and line), be practical (issues that
will happen), and suggest the fix.

## What to read

1. The diff, with enough surrounding code to judge the order of operations.
2. The spec files the diff touches or should touch.
3. `AGENTS.md`, for the invariants below.

## Invariants this repository depends on

Flag any diff that bends one of these; they are the reason the platform is
safe to expose to an assistant.

- **Permissions live in resolvers.** `requireWrite`, `requireAdmin`, and row
  visibility are checked in the shared resolver classes. A check added only in
  a tool handler or a GraphQL field, or a tool that bypasses the resolver to
  run SQL, is a HIGH finding.
- **No fallback identity.** A write with no acting user fails. A default
  email, a service identity, or a `?? 'system'` on an owner field is CRITICAL.
- **Creates land as `DRAFT`.** An assistant-initiated create that writes
  `ACTIVE`, or an in-place edit that can publish a draft, is HIGH.
- **Closed schemas, gate-enforced.** A tool schema without
  `additionalProperties: false`, a new host-injected argument declared on one
  tool instead of in `HOST_INJECTED_ARGUMENTS`, or handler logic that trusts an
  argument the schema does not constrain.
- **Bound parameters only.** Any interpolation of a value into SQL, or a column
  name that came from input. CRITICAL.
- **Secrets at runtime.** A Terraform data source or local that reads a secret
  value at plan or apply time; a secret, token, or account id in a committed
  file. CRITICAL. Run `scripts/check-sanitized.sh`; its output is part of the
  review.
- **Skill in step with the tool.** A change to an MCP tool's name,
  description, schema, annotation, or returned field without the matching edit
  to `docs/mcp/skills/example/SKILL.md` (and `agent-instructions.md` where it
  applies). MEDIUM; the answer silently stops carrying the new field.
- **Two-PR rule.** Removing a resource and the block that references it in one
  apply (route and authorizer, output and consumer). HIGH; it races.
- **Narrowed read path.** A shared query or serializer returning less for one
  caller. Ask for the caller enumeration and the paired test (`AGENTS.md`,
  *Narrowing a shared read path*).
- **Nothing logged that identifies a person or a credential.** A new log line
  with an email, bearer, key, or request body. HIGH.

## General analysis

**Logic and side effects.** Variable shadowing or overwrite; order of
operations (a resource used before the block that creates it, a migration
referenced before it exists); resource leaks; retries that are not idempotent;
race conditions on check-then-act (the `DRAFT` unique index exists for this
reason, so a new idempotency key needs its own backstop).

**Security.** Hard-coded credentials; injection (SQL, shell, path, HTML);
missing authentication or authorization; permissive defaults; data exposure in
errors or logs; a redirect host added without the allowlist.

**Terraform.** `count` where `for_each` belongs (index churn on removal); a
`depends_on` missing where a stage or route setting needs a route to exist
first; an output renamed without its consumers; a module default that differs
from the stack input without a reason in the commit.

**Shell and workflows.** Unquoted variables; `set -euo pipefail` absent;
`${{ inputs.x }}` inlined into a shell step instead of passed through `env:`;
a `workflow_dispatch` input that is not validated; `actionlint` not run.

**Tests.** Is the change covered? Does a spec assert what the caller sends, not
only what the server builds? For a gate, does a spec prove the handler was
never called? For a narrow path, is the wide path asserted too? Are fixtures
uniformly populated in a way that hides a missing-data bug?

**Quality.** Duplicated logic (including the same rule written differently);
a function whose name needs "and"; a comment that narrates code; a name that
hides intent.

## Output

```
CRITICAL: <one line>
File: <path>:<line>
Issue: <what is wrong, with the evidence in the diff>
Impact: <what happens in production or to a user>
Fix: <the specific change>
```

Severity:

- **CRITICAL**: data loss, security breach, misattributed write, secret in
  the repository, complete breakage.
- **HIGH**: a bug that will occur, a bypassed invariant, a racing apply.
- **MEDIUM**: a convention broken in a way that will cost someone later
  (missing skill update, missing test, duplicated rule).
- **LOW**: style or a minor improvement; mention once, do not block.

End with a verdict: *merge*, *merge after the fixes above*, or *do not merge*,
and the exact commands the author should run (the layer's checks from the
`developer` skill, `scripts/check-sanitized.sh`).

## Always flag / usually pass

**Always flag**: anything under *Invariants*; destructive operations without
a safeguard; hard-coded secrets or identifiers; a red CI job; a PR whose branch
is behind `main`.

**Usually pass**: style that matches the surrounding code; equally valid
alternatives; micro-optimizations; legacy code the diff does not touch.

## Examples

```
HIGH: Permission check moved out of the resolver
File: backend/apps/mcp/src/tools/items/updateItem.ts:41
Issue: The handler calls authz.requireWrite(ctx.identity) and then runs
ItemsService.update directly, skipping ItemsResolver.updateItem. The GraphQL
field still goes through the resolver, so the two surfaces now enforce
visibility differently.
Impact: A caller who can see a row through MCP but not through GraphQL (or
the reverse) once visibility rules change; the write gate is duplicated and
will drift.
Fix: Call itemsResolver().updateItem(args, identity) and let the resolver
gate; delete the handler-side check.
```

```
MEDIUM: Tool returns a new field the skill does not mention
File: backend/apps/mcp/src/tools/items/searchItems.ts:58, docs/mcp/skills/example/SKILL.md
Issue: `rows[].owner.title` is new in structuredContent and the text line, but
the Find items section still lists name, category, status, owner, website,
link.
Impact: Chat follows the skill; the title never reaches an answer.
Fix: Add the field to the Find items presentation step and the Capabilities
bullet in the same PR.
```

```
CRITICAL: Secret-shaped value in a fixture
File: backend/apps/mcp/src/lambda.spec.ts:52
Issue: The test bearer is a real-looking key, and check-sanitized.sh fails on
the Stripe-style pattern.
Impact: CI red; if the pattern were missed, a publishable repository with a
credential-shaped string in it.
Fix: Use `psk_live_example` or a clearly fake token; re-run the guard.
```
