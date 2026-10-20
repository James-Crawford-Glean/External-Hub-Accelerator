---
name: python
description: Apply this repository's Python conventions when editing its helper scripts - the Lambda@Edge viewer-request handler, the schema parser the appsync Terraform module runs at plan time, and the Cognito trigger Lambdas. Standard library only, 3.12 idioms, frozen value types, config read once at import, unittest or pytest beside the module, zipped as-is by Terraform. Auto-loads on Python edits. Pairs with the code-style skill.
---

# Python patterns

Python here is a handful of small, dependency-free helpers that Terraform zips
and deploys as-is. There is no package, no `pyproject`, no virtualenv, and no
third-party import. Keep it that way: a dependency means a build step the
modules do not have.

| File | Runs as | Config arrives as |
|---|---|---|
| `modules/app/s3-cloudfront-spa/edge/edge.py` | Lambda@Edge viewer-request (no environment variables allowed) | `config.json` rendered by Terraform next to the source and read at import |
| `modules/infra/cognito/triggers/presignup.py`, `pretoken.py` | Cognito trigger Lambdas | environment variables (`ALLOWED_EMAIL_DOMAINS`) |
| `modules/app/appsync/parse-schema.py` | `data "external"` at plan time, stdin/stdout JSON | argv and stdin |

`code-style` covers the language idioms; `AGENTS.md` wins on conflicts.

## The contract

- Python 3.12 (`runtime = "python3.12"` in the modules). Use what it offers:
  `match`, PEP 604 unions, PEP 695 generics where a generic appears, `Self`,
  `StrEnum`, `tomllib`.
- `from __future__ import annotations` first in every module.
- Built-in generics and unions: `dict[str, Any]`, `list[str]`, `str | None`.
  Never `Dict`, `List`, `Optional`.
- Single quotes. Line length 120. Imports ordered stdlib, then local; there is
  no third-party group.
- `pathlib.Path` for paths you construct; `os.path` only where a Lambda
  convention already uses it in that file.
- Standard library only. Logging through `logging` with a module logger.

## Patterns these files use

**Config once, at import, into frozen constants.** The edge handler reads
`config.json` at module load into `Final`-style upper-case names
(`APPS`, `DEFAULT_APP`, `STATIC_APPS` as a `frozenset`). The Cognito trigger
reads `ALLOWED_EMAIL_DOMAINS` once into a `frozenset`. Handlers never touch
`os.environ` or open files per request.

```python
ALLOWED = frozenset(d.strip().lower() for d in os.environ.get('ALLOWED_EMAIL_DOMAINS', '').split(',') if d.strip())
STATIC_EXTENSIONS = frozenset({'.js', '.css', '.map', '.png', '.svg', '.woff2', '.json'})
```

**Handler as a chain of early returns.** `handler(event, context)` reads the
request, then walks a list of guarded `return` statements (vanity host,
`/env.json`, root redirect, trailing slash, static asset, app fallback). Each
branch is a short private helper (`_redirect`, `_json_response`, `_host_of`).
No nested conditionals.

**Private helpers, leading underscore.** Anything not called by the runtime is
`_named`. Public surface is `handler` (Lambdas) or `main` (the parser).

**Rejecting by raising.** A Cognito trigger rejects a sign-up by raising; the
message is what the user sees as an auth failure, so it names the domain and
nothing else. Do not print or log the email.

**Frozen value types.** `@dataclass(frozen=True, slots=True)` for any "this is
just data" shape that is passed between helpers. `TypedDict` for the shape of a
JSON document you read but do not own (the CloudFront event).

**Closed sets as `StrEnum` or `frozenset`.** Status codes, kinds, and
extensions that appear in output or are compared repeatedly.

**Plan-time scripts speak JSON on stdout only.** `parse-schema.py` emits one
JSON object and nothing else to stdout; diagnostics go to stderr so Terraform's
`external` data source can parse the result.

## Tests

- Beside the module: `test_edge.py`, `parse-schema_test.py`. CI runs
  `python3 -m pytest -q modules/app/s3-cloudfront-spa/edge modules/app/appsync`;
  the edge tests also run under plain `python3 -m unittest`.
- A module that reads a file at import (the edge handler) is loaded fresh from
  a temporary copy with a fixture `config.json`, so the real source and config
  stay untouched.
- Test the guarantees, named: an extensionless deep link under an SPA app falls
  back to that app's `index.html`; a static-app route resolves to its own
  `index.html` and never clobbers; a vanity host 301s to the canonical host.
  One assertion per behaviour, data-driven where the inputs are a table.
- No network, no AWS, no fixtures that look real: hostnames end in
  `example.com`, the account id is all zeros.

## Anti-patterns

- A third-party import. There is no install step; it will fail at runtime.
- Reading `os.environ` or a file inside the handler.
- `print` in a Lambda (use `logging`); `print` to stdout in `parse-schema.py`
  for anything but the result JSON.
- Logging or echoing an email address, a token, or a full request.
- `isinstance` ladders where `match` reads better; mutable default arguments;
  bare `except:`.
- A new Python file for something the Node backend already does. Python here
  exists only where the runtime demands it (edge, Cognito triggers, plan-time
  parsing).
