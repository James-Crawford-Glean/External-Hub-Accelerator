# Portal agent (Glean Agent Builder) — spec

Companion to [`SKILL.md`](SKILL.md) for a Glean Agent Builder agent that uses
the Portal MCP server. The skill owns routing and the per-job workflows; this
file holds only what a skill cannot: the server connection, the attached tool
set, output and confirmation settings, and the operational checklist. When the
two could say the same thing, this file points at the skill instead. Configure
the builder from this file; when behaviour changes, update the skill first, then
this file, then the builder.

Replace `Portal` with your `PORTAL_NAME` and the item vocabulary with your
domain's before publishing either file.

## Server connection

The agent references the MCP server by its **connection id** (Builder → MCP
server connection), not by URL. The endpoint
(`https://mcp.<env>.<domain_root>/mcp`) and the credential live on that
connection, never in this file or the skill.

- OAuth connection (default): Glean registers itself with the server through
  Dynamic Client Registration and signs the user in; the acting user comes from
  the token. Nothing to configure beyond adding the URL.
- API-key connection: `Authorization: Bearer <key>` from the portal's Admin →
  API keys. A key is not a person, so write tools ask for `currentUserEmail`
  once per conversation (see **Acting user** in the skill).

After any deploy that changes a tool name, description, or schema: connection →
**Edit settings** → **Save**. Saving re-imports `tools/list`. Without it the
agent keeps the old catalog.

## Attached tools

**Portal MCP tools (5)**, by exact catalog name: `whoAmI`, `listUsers`,
`searchItems` (reads); `createItem`, `updateItem` (writes). Do not add a
generic search or help tool; the skill names the tool for every job.

**Glean-native (optional):** `Employee Search` for people the portal does not
know; `Glean Search` for supplementary context only. Both appear in an answer
under a **Supplementary context** heading and never replace a Portal record.

## Attached skills

Attach the **Portal** skill (`SKILL.md`) and nothing that overlaps it. Do not
attach a skill that wraps one tool one-to-one; it adds routing cost with no
orchestration benefit. If a workflow moves from the skill into these
instructions, detach the skill section it replaced, so a stale skill cannot
contradict a gate.

## Output and confirmation

- Read tools carry `readOnlyHint: true` and run without a confirmation panel.
  Write tools (`createItem`, `updateItem`) do not, so the host asks the user
  before each call. Keep that default. Enable **Run without user confirmation**
  only for a scheduled agent that performs no writes.
- Answers are text and tables. Render an item list as one row per item with
  name, category, status, owner, and the portal link, as the skill's **Find
  items** section says.

## Guardrails (summary; the skill has the steps)

- Portal tools are the source of truth for items and portal users. Never answer
  those from search results, indexed exports, or prior chats.
- Every write starts with `searchItems` and shows a preview table; the user
  approves before the call (skill: **Create an item**, **Edit an item**).
- `createItem` lands as a `DRAFT`; a writer approves it in the portal. Say so
  every time. `updateItem` applies immediately and only to live items.
- Never guess an `itm_` id. Never ask for an email on a signed-in connection.
- If a Portal tool errors, stop; do not fall back to search.

## Operational notes

- **Every MCP change updates the skill, then the catalog.** A change to a tool,
  argument, description, or returned field updates `SKILL.md` in the same pull
  request (router row, Capabilities bullet, that tool's section), then this
  file if the attached set or a setting changed. Deploy, re-sync the connection,
  re-publish the skill. A field the skill does not mention does not reach the
  answer.
- **Proving prompts** after each change, in Chat and in this agent: one plain
  question per router row; the same question naming the portal; "what can the
  Portal MCP do?" answered without a tool call; one write with the confirmation
  panel appearing for the write only; one refused prompt (policy, documentation,
  general knowledge).
- The authoring rules behind both files are in the developer portal under
  Glean integration → **Skill authoring**.
