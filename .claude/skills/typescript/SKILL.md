---
name: typescript
description: Apply this repository's TypeScript patterns when writing or editing the backend (Node Lambda monorepo), the portal (Vite + React), or the developer portal (Docusaurus). Backend - once() dependency injection in a container.ts per app, resolver classes shared by GraphQL and MCP, bound-parameter SQL through @libs/sql, closed JSON Schemas enforced by the MCP argument gate, discriminated unions, readonly value types, as-const codes, Result-shaped outcomes; portal - hooks only, typed env, capability gates. Plus strict tsconfig, latest language features, and core SE principles. Auto-loads on TypeScript edits. Pairs with the code-style skill.
---

# TypeScript patterns

Architectural defaults for the three TypeScript projects in this repository.
Pair with `code-style` (syntax and functional idioms). `AGENTS.md` wins on any
conflict. Match the surrounding module when editing; land a pattern change on a
refactor pass with tests, not mid-file.

## The three projects and their contracts

| Project | Toolchain | Module system | Checks before commit |
|---|---|---|---|
| `backend/` | `npm`, `tsc`, jest (ts-jest), esbuild | CommonJS bundles; `@libs/<name>` path aliases; no file extensions on imports | `npm run lint && npm run typecheck && npm test && npm run build`; `node apps/workers/migrate/gen-migrations.mjs` after a migration |
| `apps/portal/` | `pnpm`, Vite, vitest, eslint | ESM, `moduleResolution: bundler`, `verbatimModuleSyntax` | `pnpm exec tsc -b && pnpm exec eslint . && pnpm exec vitest run && pnpm build` |
| `apps/dev/` | `pnpm`, Docusaurus | ESM | `pnpm typecheck && pnpm build` (broken links warn; read the output) |

All three run `strict`, `noUnusedLocals`, `noUnusedParameters`. The backend
does not set `noUncheckedIndexedAccess`; treat indexed access as possibly
undefined anyway (`xs[0]?.name`, `props[key]!` only where the key was checked).

- Never `any`. `unknown`, then narrow.
- `// @ts-expect-error: <reason>` over `// @ts-ignore`; delete it when it stops
  erroring.
- `node:` prefix for built-ins in the backend (`node:crypto`, `node:fs`).

## Backend: how the pieces fit

**Composition root.** Each app has one `container.ts`. Every service and
resolver is a factory wrapped in `once()` from `@libs/di`: lazy, memoized across
warm invokes, order-independent. There is no framework and no decorator.

```typescript
export const roster = once(() => new RosterService(aurora()));
export const authz = once(() => new AuthzService(roster()));
export const resolvers = {
  items: once(() => new ItemsResolver(new ItemsService(aurora()), authz(), identityService(), aurora())),
} as const;
```

Add a dependency by adding a constructor parameter and a `once()` line. Test
seams are explicit functions (`setAuroraForLocal`) that swap a factory's input
before first resolve; do not reach into a module's internals from a spec.

**Shared resolver classes.** The GraphQL dispatcher (`apps/api`) and the MCP
server (`apps/mcp`) call the same resolver classes. A tool handler is a thin
adapter: parse arguments, call the resolver, shape `content` and
`structuredContent`. Visibility, `requireWrite`, and validation live in the
resolver once. If you find yourself writing a permission check in a tool, move
it down.

**SQL with bound parameters.** Column names are code constants; every value is
a `:named` parameter bound through `@libs/sql` (`placeholders`, `inClause`,
`paginate`, `bind`). No interpolation of user input, ever. The only `.sql`
files are migrations under `backend/migrations/`, each statement
`IF NOT EXISTS` / `ON CONFLICT`.

```typescript
const params: Params = {};
const where = [visibilitySql(visibility, 'visibility_role'), inClause('status', statuses, params, 'st')];
paginate(args, params, { def: 25, maxLimit: 100 });
return this.aurora.query<Row>(`SELECT ${COLS} FROM example.items WHERE ${where.join(' AND ')} LIMIT :lim OFFSET :off`, params);
```

**Closed schemas at the protocol boundary.** An MCP tool's `inputSchema` is the
supported `JsonSchema` subset (`type`, `properties`, `required`,
`additionalProperties: false`, `enum`, `items`, bounds). The server validates
arguments against it before the handler runs, drops host-injected names
(`HOST_INJECTED_ARGUMENTS`), and returns `-32602` with a `violations` list. A
handler can therefore trust the shape it declared; keep any residual clamp as
defence in depth, not as the control. Shared field definitions
(`CURRENT_USER_EMAIL`) are one constant spread into each schema so the wording
cannot drift.

**Identity flows in, never from a global.** Handlers receive `{ identity }`;
resolvers take `Identity` as a parameter. No module reads the current user from
ambient state, and there is no fallback identity for writes.

**Results.** Every tool returns `content[]` (text that carries the rows a
follow-up needs) and `structuredContent`. Status is derived by the server into
`_meta.portal` from the result shape; do not hand-set it. Tool-level problems
(unknown id, not authorized, nothing to change) are `isError: true` results;
protocol problems are JSON-RPC errors.

## Patterns that recur

**Discriminated unions for outcomes.** Mutually exclusive shapes get a literal
`kind` (or `ok`) and an exhaustive `switch`. `validateArguments` returns
`{ ok: true; value } | { ok: false; violations }`; the catalog filter, the
protocol check, and the provenance envelope follow the same shape.

```typescript
type Validation =
  | { readonly ok: true; readonly value: Record<string, unknown> }
  | { readonly ok: false; readonly violations: readonly string[] };
```

**`as const` objects for stable codes.** Codes that cross the wire or appear in
logs (`status`, `outcome`, `reason`) are `as const` objects or string-literal
unions, never TypeScript `enum`.

**Readonly value types.** `readonly` fields, `ReadonlyArray<T>`,
`ReadonlySet<T>` for "this is just data". Return a copy or a readonly view, not
a mutable internal array. `Object.freeze` only where a runtime guard matters.

**Pure helpers at two uses.** A three-line idiom that appears twice becomes a
named function in the nearest `libs/` module (`bareDomainSql`, `inClause`).

**Config read once.** `process.env` is read at the top of a module into a
named constant with a default (`PORTAL_NAME`, `CATALOG_FILTERED_BY_CAPABILITY`,
`SERVER_DESCRIPTION`), never scattered through call sites. Required values
throw at module load with the variable's name in the message.

**Iterables in, arrays out.** Accept `Iterable<T>` where a caller might hold a
generator; return concrete `T[]` or `ReadonlyArray<T>`.

**One JSON line per log event.** Structured logs are `console.log(JSON.stringify({ msg: 'mcp.<event>', ... }))`
with a stable `msg`; never a token, secret, or email (see the `mcp.denied`
and `mcp.register` lines for the shape). Prose logging goes through
`@libs/log`.

## Portal and developer portal

- Hooks only; no class components. Data fetching through the typed helpers in
  `src/lib/api/`; the GraphQL client adds the Cognito token.
- Capability gates come from `src/lib/capabilities.ts`; a view checks the
  capability, not the role name.
- Routes are declared in `src/lib/routes.ts` with `:id` placeholders so
  telemetry never records a concrete id.
- Env vars are declared in `src/vite-env.d.ts` and read as
  `import.meta.env.VITE_X` without casts. Nothing secret lives in the bundle.
- Docusaurus pages are Markdown with frontmatter (`id`, `title`,
  `sidebar_label`, `sidebar_position`); the sidebar is auto-generated from the
  `docs/` tree, so a new page needs a position, not a sidebar entry.

## Testing shape

- Unit specs beside the code as `*.spec.ts`. Integration specs boot embedded
  Postgres through `@libs/testkit` and run every migration; use them for
  anything that touches SQL or the review state machine.
- Spy on a tool's `handler` to prove a gate stopped a call; assert on the
  arguments the handler received, not only on the response.
- Pin routing-relevant text (`routing.spec.ts`) and protocol constants
  (`protocol.spec.ts`) so a reworded description or a changed version list
  fails CI rather than a user.

## Latest language features

Target ES2023 (backend) / ESNext (portal). Reach for `satisfies`, `const` type
parameters, `using` where a disposable exists, `Object.groupBy` / `Map.groupBy`,
`Promise.allSettled`, `Array.prototype.toSorted`, iterator helpers, template
literal types, `NoInfer<T>`, and key-remapped mapped types over older
equivalents.

## Anti-patterns

- `any`; a cast followed by validation; `obj[key as keyof typeof obj]` loops
  (move the fields into a `Record`).
- A permission check in a tool handler or a GraphQL field instead of the
  resolver.
- SQL with an interpolated value, or a column name that came from input.
- A second `container.ts`-style wiring inside a tool or a lib.
- `process.env.X` inside a function body.
- TypeScript `enum`; boolean-flag-plus-nullable-field state that a union
  expresses better.
- A log line with a bearer, a key, or an address in it.
- Reading the acting user from anywhere but the `identity` passed in.
- Public methods that return a mutable internal array.
- A new optional field on a shared read path without enumerating every caller
  (see *Narrowing a shared read path* in `AGENTS.md`).
