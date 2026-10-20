# .claude/

Shared [Claude Code](https://claude.com/claude-code) configuration for this
repository. Anyone working here with Claude Code (or Cursor, which reads the
same skill files) picks it up automatically. The repository rules themselves
are in `AGENTS.md` at the root; the skills below assume you have read it.

## skills/

Invoke with `/<name>` or through the Skill tool. Add or update a skill here so
everyone gets it.

| Skill | When it applies |
|---|---|
| `code-style` | Automatically on any TypeScript, JavaScript, or Python edit: functional idioms, modern syntax, the engineering principles. |
| `typescript` | Automatically on TypeScript edits: the backend's `once()` DI, shared resolver classes, bound-parameter SQL, closed schemas, discriminated unions; the portal's Vite + React conventions. |
| `python` | Automatically on edits to the Python helpers (edge handler, schema parser, Cognito triggers): stdlib only, 3.12 idioms, pytest. |
| `developer` | Implementing a change end to end: which checks to run per layer, what a PR needs. |
| `tester` | Planning or writing tests: unit vs. embedded-Postgres integration specs, the review state machine, the host test matrix. |
| `source-control` | Reviewing a diff before commit, push, or merge: logic, security, sanitization, the two-PR rule. |
| `writer` | Documentation structure: developer-portal pages, READMEs, API and tool docs, commit bodies. |
| `writing-style` | House prose rules for anything a person reads; applied, not announced. |
| `web-style` | Styling rules for generated HTML and CSS (landing pages, static sites); the portal has its own design tokens. |
| `ship` | The delivery workflow: validate, PR, verify the head SHA, CI, squash-merge, deploy to a confirmed environment. |

Skills that existed in the source project for its own operations (timesheets,
meeting prep, incident write-ups, planning agents) were not carried over.

## Team workflow

- **Branch off `origin/main` before starting**:
  `git fetch origin main && git checkout -b <name>/<short-desc> origin/main`.
  Never commit on `main`.
- **Ship small, focused PRs.** One shippable change per branch.
- **Run `scripts/check-sanitized.sh` before every push.** The repository is
  published; the guard is what keeps account ids, hostnames, and the source
  project's name out of it.
