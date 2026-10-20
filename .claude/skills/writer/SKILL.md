---
name: writer
description: Write and review documentation for this repository - developer-portal pages under apps/dev/docs, READMEs, tool and API reference, module file-head comments, commit bodies, PR descriptions. Structure, accuracy, and factual tone; the prose rules themselves are the writing-style skill. Use when creating or improving documentation, or reviewing a PR for documentation quality.
---

# Writer

You write the documentation a developer reads to adopt, operate, or change this
repository. `writing-style` is the sentence-level rule set and applies to
everything here; this skill is about what each document is for and how it is
shaped. `AGENTS.md` (sections *Comments* and *File creation*) decides when a
document should exist at all: edit an existing one, do not create a README or
planning file unless asked, no emojis.

## Where things go

| Content | Home |
|---|---|
| How a surface works, its contract, how to operate it | `apps/dev/docs/<area>/<page>.md` (Docusaurus; frontmatter `id`, `title`, `sidebar_label`, `sidebar_position`) |
| How to set up, deploy, adapt the repository | root `README.md` |
| How to work in one package | that package's `README.md` (`backend/README.md`) |
| A tool's contract for an MCP host | `apps/dev/docs/mcp/tools.md`, and the tool's `description` string |
| How Glean should use the tools | `docs/mcp/skills/example/SKILL.md` (rules in `apps/dev/docs/mcp/skill-authoring.md`) |
| Why a module is shaped the way it is | the module's file-head comment, once |
| Why a change was made | the commit body |
| What a reviewer must decide | the PR description |
| A document someone outside the repository reads | `docs/` |

Operational caveats belong in the developer portal, not in code comments.
Migration history belongs nowhere.

## Principles

- **Factual, not promotional.** No "seamless", "robust", "powerful",
  "production-ready", "best-in-class". State what the thing does and what it
  does not.
- **Concrete.** File paths, command lines, status codes, field names, the
  exact error string. "Returns `-32602` with a `violations` list" beats
  "returns a helpful error".
- **Show the shape.** A request and its response, a log line, a row. One
  tested example is worth three paragraphs.
- **Say what it is not for.** Every surface page names its neighbour and the
  boundary (the MCP server answers "what is the current value"; the index
  answers "find things like this").
- **Overview, then detail.** Lead with the one-paragraph purpose, descend to
  the contract, end with the operational notes.
- **One term per concept.** Host, client, model; tool catalog; acting user;
  draft. Do not alternate synonyms.
- **No history in the present tense.** A page describes the current
  behaviour; the change log is `git log`.

## Document shapes

**Developer-portal page.** Purpose paragraph; the contract (endpoint, method,
fields, statuses) as tables; one worked example; errors; cross-links to the
neighbouring pages. Use `:::note` admonitions for an evidence or inference
caveat, not for emphasis.

**Tool reference entry.** Name and kind (read/write) in the heading; one
sentence of purpose; argument table (name, type, notes, required); result shape
and the text line; server-side rules; what the host should expect to confirm.

**README section.** What the reader needs before starting, in a table with
"where it goes"; then numbered steps with the exact command and the expected
outcome; then the deltas (what to change to adapt). The README is not a
tutorial on the technologies it uses.

**Module file-head comment.** The architectural WHY in a few lines: what this
module is, the one or two non-obvious constraints that shaped it. Not a list
of resources (the file is the list).

**Commit body.** The symptom as a user saw it, the cause, the change, the
evidence (which spec, which run). Cite sources when a decision rests on
observed behaviour elsewhere. No bullet soup when a paragraph says it.

**PR description.** Summary of the change; what a reviewer must look at or
decide; checks run, with counts. Links to the pages changed.

## Review checklist

- [ ] Every command and example was run; the output shown is the real output.
- [ ] Paths, names, flags, and statuses match the code at this commit.
- [ ] The page says what the surface is not for and links the alternative.
- [ ] Terms are consistent across the page and its neighbours.
- [ ] No marketing words, no intensifiers, no em dashes (`writing-style`).
- [ ] No real identifiers: hostnames end in `example.com`, ids are the
      placeholder shapes, the account id is all zeros. `scripts/check-sanitized.sh`
      passes.
- [ ] A new page has `sidebar_position` and builds without a broken-link
      warning (`cd apps/dev && pnpm build`, read the log).
- [ ] Anything that changed an MCP tool also changed the skill.

## Process

Draft fast for structure, then revise in passes: cut whole sections that do
not serve the reader, then weak sentences, then words. Read it aloud. Then
check every fact against the code.
