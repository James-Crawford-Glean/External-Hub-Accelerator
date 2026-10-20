---
name: tester
description: Plan and write tests for this repository - jest unit specs and embedded-Postgres integration specs in the backend, vitest route-render tests in the portal, Python tests for the edge and schema helpers, Terraform validation, and the end-to-end host test matrix for a deployed environment. Use when planning testing for a change, writing or extending specs, verifying a fix, or reporting a defect with reproduction steps.
---

# Tester

You decide what proves a change works and you write that proof. The repository
already has a test shape per layer; extend it rather than inventing a parallel
one.

## Where tests live and how they run

| Layer | Shape | Run |
|---|---|---|
| `backend/` unit | `*.spec.ts` beside the module (jest, ts-jest, `isolatedModules`) | `npm test` or `npx jest <path>` |
| `backend/` integration | `*.integration.spec.ts` or any spec that calls `pgAurora()` from `@libs/testkit`: boots embedded Postgres, runs every migration, exercises real SQL | same; `maxWorkers: 50%` and a 30 s timeout are set for this |
| `backend/` contract pins | `routing.spec.ts` (tool descriptions), `protocol.spec.ts` (version set), `validate.spec.ts` (argument gate), `schema-registry.spec.ts` (GraphQL schema vs. registry) | same |
| `apps/portal/` | vitest; `views.dom.test.tsx` renders each route, `routes.test.ts` pins route normalisation | `pnpm exec vitest run` |
| Python helpers | `test_edge.py` (unittest, loads the module from a temp copy with a fixture `config.json`), `parse-schema_test.py` | `python3 -m pytest -q modules/app/s3-cloudfront-spa/edge modules/app/appsync` |
| Terraform | `terraform validate` per module, `terragrunt hcl validate --inputs` per env | `scripts/validate-modules.sh`, `terragrunt hcl validate --inputs --working-dir live` |
| Deployed environment | the host test matrix: Discover → Register → Authorize → Token → List tools → Call read → Call write → Approve, per host type, with the log line and row that proves each stage | `apps/dev/docs/mcp/host-test-matrix.md` |

CI runs the first six on every pull request as four jobs (`infra`, `backend`,
`portal`, `dev-portal`). The matrix is run by a person against a deployed
environment and recorded.

## Planning a test

1. **Name the guarantee.** Not "test updateItem" but "a viewer's updateItem
   call never reaches the resolver and returns authorization_error". The
   guarantee is the test name.
2. **Pick the lowest layer that can prove it.** A pure function: unit. SQL or
   the review state machine: integration on embedded Postgres. Advertised text
   or constants a host reads: a contract pin. Wiring between AppSync and the
   dispatcher: the schema-registry spec. The real edge, Cognito, and a host:
   the matrix.
3. **Decide what the oracle is.** The handler spy's arguments; the row after
   the call; the `_meta.portal.status`; the JSON-RPC error code; the log line.
   Assert on that, not on prose.
4. **Cover both sides of any split.** Reads vs. writes in the catalog; viewer
   vs. editor; one record vs. many; a header present vs. absent; the narrow
   path vs. the wide path. One-sided tests go green on the regression.

## Patterns worth copying

- **Gate proof.** `jest.spyOn(tool, 'handler')`, call through `handleRpc` or
  `route`, assert `not.toHaveBeenCalled()` and the exact error, `finally`
  restore. (`validate.spec.ts`.)
- **State machine on real migrations.** Insert through the resolver, read the
  row back, assert `status`, `reviewed_at`, and the notification row; repeat
  the decision and assert it is a no-op. (`items-review.integration.spec.ts`.)
- **Audit lines.** Spy on `console.log`, parse lines that start with `{`,
  filter by `msg`, assert the whole object with `toEqual` so an extra field is
  caught; assert the token payload is absent from the captured log.
  (`lambda.spec.ts`.)
- **Audience matrix.** Seed roster rows for each role, run the same request as
  each identity, assert the sorted result set per identity. (`local-demo.spec.ts`.)
- **Contract pin.** Assert the exact constant (`SUPPORTED_PROTOCOL_VERSIONS`,
  `HOST_INJECTED_ARGUMENTS`) and the phrases in each advertised description
  that make a prompt route to it, so a reword fails CI. (`routing.spec.ts`.)
- **Isolated module under test.** Copy the module and a fixture config to a
  temp dir and import from there when the module reads a file at import.
  (`test_edge.py`.)

## Writing a good spec

- Describe block names the surface; `it` names the guarantee in plain words.
- Arrange, act, assert; one guarantee per `it`, data-driven (`it.each`) when
  the inputs are a table.
- No network, no AWS, no real-looking data: `example.com`, `ada@example.com`,
  `itm_7Kf3Qb9RtX2mLp`, the all-zero account id. The sanitization guard runs
  on spec files too.
- Deterministic: fixed timestamps, seeded ids, no sleeps.
- A test that only re-states the implementation (asserting a mock was called
  with what you passed it) proves nothing; assert an observable.

## Verifying a fix

1. Write the failing spec first from the bug report's reproduction; confirm it
   fails for the reported reason.
2. Apply the fix; confirm the spec passes and the rest of the layer's suite is
   unchanged.
3. For anything on the auth or MCP path, add the stage to the host test matrix
   if the matrix would not already have caught it.

## Reporting a defect

```
Summary: <one line>
Where: <layer, file, or deployed stage>
Steps: <numbered; exact request, identity, and data>
Expected: <guarantee>
Actual: <what happened; quote the status, error, row, or log line>
Evidence: <spec name, log line, row>
Severity: CRITICAL | HIGH | MEDIUM | LOW
```

Severity follows `source-control`: data loss, security, or a misattributed
write is CRITICAL; a bypassed invariant is HIGH; a convention gap is MEDIUM.

## Done means

- The guarantee has a spec at the lowest layer that can prove it, and the
  paired side is asserted.
- The layer's full check set passes locally (`developer` skill table).
- `scripts/check-sanitized.sh` passes.
- If the change touched the auth or MCP path, the matrix row that would catch
  a regression exists.
