---
name: code-style
description: Apply functional programming style, modern language features, and core software-engineering principles when writing or editing code. Pure functions, immutable data, comprehensions, early returns, latest syntax, plus DRY, SoC, encapsulation, abstraction, composition over inheritance, generics, and config separation. Auto-loads on any code-editing task in TypeScript, JavaScript, or Python. Skip for prose, configuration files, and generated code.
---

# Code Style

Prefer functional programming style, the newest language constructs the
toolchain supports, and the engineering principles below. This skill is the
language-agnostic layer; the `typescript` and `python` skills carry the
repository-specific patterns, and `AGENTS.md` holds the rules that override
anything here.

## TypeScript / JavaScript

- `const` over `let`. Never `var`.
- Arrow functions for callbacks and small helpers; a named `function` is fine
  for a top-level unit that reads better with a name.
- `.map()` / `.filter()` / `.reduce()` / `.flatMap()` over `for` loops.
- Optional chaining (`?.`) and nullish coalescing (`??`, `??=`).
- `satisfies` for type-checked literals; `as const` for narrow literal types.
- Template literals over string concatenation.
- Destructuring at function signatures; default and rest parameters.
- Generics with constraints and defaults: `<T extends X = Y>`; `const` type
  parameters where a literal must survive.
- Discriminated unions and an exhaustive `switch` with a `never` default for
  closed sets.
- Utility types (`Pick`, `Omit`, `Partial`, `Record`, `ReturnType`, template
  literal types) over hand-written shapes.
- `interface` for object shapes, `type` for everything else; program to the
  type, not the implementation.
- `Array.from` / `Object.entries` / iterator helpers over index loops.
- `structuredClone`, `toSorted`, `toReversed`, and spread over in-place
  mutation.

## Python

- `from __future__ import annotations` at the top of every module.
- Union syntax: `str | None`, not `Optional[str]`; `dict[str, Any]`, not
  `Dict`.
- `match` / `case` (including structural patterns and guards) over chained
  `if` / `elif` on type or value.
- The walrus operator (`:=`) when it tightens a loop or a test-and-bind.
- `next(g for g in ...)` over loop-with-break.
- List, set, and dict comprehensions over imperative append loops.
- `frozenset` for immutable sets; `tuple` over `list` for fixed sequences.
- Compile regex patterns once at module level.
- `pathlib.Path`, never `os.path` strings.
- `@dataclass(frozen=True, slots=True)` or `TypedDict` over plain dicts for
  structured data.
- `typing.Protocol` for structural interfaces; `enum.StrEnum` for closed value
  sets; `Final` for constants; `Literal` for narrow values.
- `functools` (`cache`, `partial`, `reduce`, `singledispatch`) and `itertools`
  over hand-rolled loops; `contextlib` for cleanup.

## Functional core

- Pure functions over mutation; isolate side effects at the edges (the Lambda
  handler, the resolver that touches the database, the React component that
  calls the API).
- Expressions over statements.
- Comprehensions, generators, and higher-order functions over manual loops.
- Pass behaviour as callables rather than branching on flags.
- Early returns over deep nesting.
- Immutable data structures where practical.

## Software-engineering principles

- **Abstraction**: expose intent, hide mechanism. Name the *what*; bury the
  *how*.
- **Encapsulation**: keep state private; mutate through functions, not by
  reaching in. No public mutable internals.
- **Interfaces and contracts**: depend on `Protocol` / `interface` / abstract
  types, not concrete classes. The accelerator's resolver classes are the
  contract the GraphQL dispatcher and the MCP server both program to.
- **Composition over inheritance**: assemble behaviour from small parts;
  strategies, delegation, injected callables. Inherit only for a genuine is-a
  (a domain `Error` subclass).
- **Separation of concerns**: one module or function, one responsibility. I/O,
  business logic, and presentation in separate layers.
- **DRY**: a rule lives in exactly one place. Collapse duplication even when
  the two copies are written differently.
- **Single responsibility and small units**: split a function when its name
  needs "and".
- **Config separation**: no magic values or environment specifics inline.
  Constants at module top; tunables and secrets in env vars or Secrets
  Manager, read once at the entry point.
- **Generics**: write it once over a type parameter instead of once per type.
- **Cross-cutting concerns**: logging, caching, retries, auth, validation, and
  timing belong in wrappers, middleware, or one shared gate (the MCP argument
  gate, the `requireWrite` check), not inline at every call site.
- **Open/Closed**: extend by adding an implementation, a dispatch entry, or a
  union member; do not edit stable code to add a branch.
- **Cohesion and coupling**: inject dependencies; avoid hidden globals.
- **Least surprise**: predictable names, consistent return shapes, no side
  effects behind an innocent getter.

## Anti-patterns

- Mutating function parameters or shared global state.
- Loops that build a list with `.push` / `.append` when `.map` or a
  comprehension works.
- `if` / `else` pyramids without early returns.
- `let` that never reassigns.
- Type-asserted-then-checked code (`x as Foo` followed by manual validation).
  Validate first; trust the type after.
- Bare `except:` or `catch (e) {}` that swallows errors.
- String-concatenated SQL or HTML. Values are bound parameters; HTML goes
  through a renderer.
- Duplicated logic across files, including the same rule re-expressed
  differently.
- Magic numbers and strings; hard-coded paths, URLs, account ids, hostnames,
  credentials. The sanitization guard rejects several of these outright.
- Cross-cutting concerns copy-pasted at call sites.
- Deep inheritance where composition would do.
- God objects or functions that mix unrelated concerns.
- Leaky abstractions that expose internal representation to callers.

## Apply judgment

These are defaults, not laws. Break them when the alternative is clearer or
when matching the surrounding code. Prefer the simplest design that satisfies
the principles; do not over-abstract for a single use. The goal is readable,
maintainable code, not a checklist.
