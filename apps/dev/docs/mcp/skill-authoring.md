---
id: skill-authoring
title: Skill authoring
sidebar_label: Skill authoring
sidebar_position: 5
---

# Skill authoring

Glean reaches the MCP server through text you write: the server's scope
statement, each tool's `description` and `inputSchema`, and a Glean skill
(`SKILL.md`). When that text is ambiguous, Glean picks the wrong tool, loops a
single-record tool over a list, asks the user for a value the server already
has, or answers from an indexed copy of your data and never calls the server.
Nothing throws. The answer is well-formed and plausible, so the only signal is a
user noticing a wrong number.

This page is the authoring guide for those surfaces. The rules come from the
source project this accelerator was extracted from, where every failure mode
below was seen in production chat and fixed by changing what Glean reads
(descriptions, schemas, annotations, the skill) rather than the handlers.
The shipped example skill, written to these rules for the five tools in
[Tools](tools.md), is at `docs/mcp/skills/example/SKILL.md` in the repository,
with an Agent Builder companion at `docs/mcp/skills/example/agent-instructions.md`.

:::note Evidence and inference
Statements about what Glean reads and when come from the source project's
change history: commit messages that record a symptom in chat, the text change
that fixed it, and a re-test. Glean's routing internals are not documented
publicly, so treat "reads on every turn" and similar phrasing as observed
behaviour that held across several months of use, not as a contract. Where this
page infers a mechanism rather than quoting an observation, it says so.
:::

## How Glean picks a tool

Four layers of text are visible to Glean, at different moments. Everything else
(handler code, result shapes, tests) is invisible until the first call succeeds.

| Layer | Where it comes from | When Glean reads it | What it decides |
|---|---|---|---|
| Server scope | `instructions` in the `initialize` response (`SERVER_DESCRIPTION` in `apps/mcp/src/mcp/server.ts`; override with `MCP_SERVER_DESCRIPTION`) | At import, and (inferred) when weighing whether this server owns a prompt at all | Whether a prompt is in scope for the server |
| Tool catalog | `tools/list`: `name`, `description` plus the appended `LIVE_DATA_NOTE`, `inputSchema` with per-field descriptions and enums, `annotations` | Imported as a snapshot when the server is added or re-synced; not re-polled | Which tool, which arguments, whether to show a confirmation panel |
| Skill description | The `description` field in a skill's frontmatter | Every turn, for every attached skill | Which skill to load for this prompt |
| Skill body | The rest of `SKILL.md` | (inferred) Only after that skill is selected | How to use the tool: arguments, steps, what to show, what to refuse |
| Tool result | `content[].text`, then `structuredContent`, then `_meta` | After the call | What the answer says |

Three facts shape everything else on this page.

**Glean picks a tool from the catalog alone.** The source project's routing
guard spells this out: "Glean picks a tool from the advertised name +
description alone, so these assertions pin the routing-relevant copy." A tool
with a good handler and a vague description is a tool that does not get called.

**Glean Chat reaches MCP tools through skills.** When a server is added, Glean
generates a skill for it that bundles every tool, named after the server URL.
A hand-authored skill carries instructions but no tools of its own. The source
project found that natural-language prompts never ranked the URL-named bundle,
so Chat loaded the hand-authored playbook, had nothing to call, and reported the
actions as unavailable. The fix was a section in the skill that names the server
connection, the bundle skill, and the query that loads it (see
[Callable tools](#callable-tools) below).

**The model reliably reads `content[].text`.** The source project observed that
Glean "often feeds the model only `content[].text`" and that `structuredContent`
may not be passed. The result contract in [Design](design.md#result-contract)
puts the rows a follow-up needs in the text for that reason. Your skill should
tell the model which lines in the text are the record set and which are a
preview.

## Failure modes and fixes

Each of these was observed in chat against the source project's server, then
fixed by changing one of the four text layers. The symptom is what a user saw;
the rule is what to carry into your own descriptions and skill.

### Reads gated like writes, then never called

**Symptom.** Every read tool opened a write-confirmation panel. A question over a
17-partner list produced 17 approval prompts. The planner then learned to
answer the same questions from indexed spreadsheet exports of the portal's own
data: zero `tools/call` for a prompt the server owned.

**Cause.** `tools/list` carried no MCP `annotations`, so the host could not tell
reads from writes and treated every tool as a write.

**Fix.** `readOnlyHint: true` on every read (`READ_ONLY` in
`apps/mcp/src/mcp/annotations.ts`), and a fixed sentence appended to every
description asserting that live records supersede indexed copies
(`LIVE_DATA_NOTE` in `apps/mcp/src/mcp/tools.ts`). Read tools also append
`SUPPLEMENTARY_CONTEXT_NOTE`, which lets search results appear under a labelled
heading without replacing a tool figure.

**Rule.** Annotations are routing metadata. A content tool that composes but
does not persist (the source project's brief generator) is `READ_ONLY` too.
Keep the provenance suffix on the server side so no tool can drop it;
`routing.spec.ts` pins it.

### Trigger keyed on the product name

**Symptom.** "Use `<product>` MCP to show which accounts Deloitte has mapped"
made Chat claim the action was not connected. The same question asked plainly,
without naming the product, got a correct live answer. The action was enabled
the whole time.

**Cause.** The provenance suffix had just been changed to "Use this action
whenever the prompt says `<product>` or `<product> MCP`" in an attempt to
prioritise live tools. Naming the product in the trigger steered selection
toward finding a server by that name instead of answering the question.

**Fix.** Trigger on the subject matter: "Use this action for any question about
partners, partner-account mappings, partner activity, or partner-involved
pipeline, however the prompt is phrased and whether or not it names
`<product>`." That wording is what the accelerator's `LIVE_DATA_NOTE` inherits.

**Rule.** Describe the records and the questions people ask about them. Never
make the product name, the server name, or the word "MCP" the trigger. Users
who do name the product should still land on the tool; users who do not should
not be steered away from it.

### Sibling tools that share nouns

**Symptom.** Three tools all mentioned partners and accounts. Chat picked by
whichever name looked closest: a single-account tool called in a loop over a
pasted list, a partner-to-accounts question answered with the
account-to-partners tool, or a Salesforce search substituted for a
portal-owned fact.

**Cause.** The descriptions said what each tool returned but not how it differed
from its neighbours. Ambiguity in the catalog shows up as a wrong tool, not as
an error.

**Fix.** Each description states cardinality in capitals ("ONE Salesforce
customer account", "MANY customer accounts or a pasted list"), names the sibling
to use instead ("that is `getMappedPartnersForAccounts`"), and forbids the loop
("Never call this in a loop over many accounts"). The skill adds a **direction
check** paragraph under the router: record in hand and partners out is one
tool; partner in hand and records out is another; a sheet to look up is a read;
a sheet to record is a write.

**Rule.** When two tools could plausibly answer one prompt, both descriptions
must name the other and say which prompt shapes belong to each. Cardinality
(one vs. many) and direction (A-to-B vs. B-to-A) are the two axes that recur.

### The N+1 loop after a list

**Symptom.** The 17 approvals above were one profile call per partner after a
list call: the model fetched each partner's manager separately, when the list
tool had already returned it.

**Cause.** The list tool's description did not say that each row already carried
the manager, mapped-account count, and pipeline figures, so the model assumed it
had to fetch them.

**Fix.** The description now says "Each result already carries team, status,
region, partner manager, mapped-account count, open pipeline, and
sourced/influenced opportunity counts, so one call answers a list question. Do
NOT follow up with `getPartner` per result."

**Rule.** Say what comes back, field by field, when a follow-up call is the
likely mistake. A list tool's text output should include the columns a user
will ask about next.

### A value the description forgot

**Symptom.** Users asking about the EMERGING partner team were rarely answered
with the `team` filter, even though the server accepted it.

**Cause.** The `team` field's description listed five of the six team values.
The model treated the list as exhaustive.

**Fix.** Description-only change adding the missing value, later hardened by
putting the full list in a JSON Schema `enum` so a paraphrased value cannot
silently match nothing.

**Rule.** Every bounded value is an `enum` in the schema and is listed in the
field description. Generate the description from the same constant the handler
validates against, as `createActivity` in the source project does with
`TYPES.join(', ')`.

### A description too long to hydrate

**Symptom.** One tool was skipped entirely for a flow it was built for. The
agent runtime trace showed the tool's entry as "deferred schema, call `help()`
first".

**Cause.** Glean's agent runtime defer-hydrated the heaviest catalog entries.
That tool's description had grown to a full routing playbook.

**Fix.** The description was cut to two sentences; the routing detail moved to
the skill, where it belongs. A length cap in the spec keeps it from regrowing.
The change was logged as an experiment; the short description has stayed.

**Rule.** A tool description is two to five sentences. The playbook (steps,
presentation, edge cases) lives in the skill section for that tool.

### A skill with instructions and nothing to call

**Symptom.** After Glean Chat moved to skill-based tool access, a plain question
("who is the partner manager for WWT?") matched the hand-authored skill, which
then reported the tools as unavailable.

**Cause.** The hand-authored skill had no tools attached. The auto-generated
tool bundle for the server did, but its only description was the server URL, so
natural-language prompts never ranked it.

**Fix.** A **Callable tools** section in the skill that names the server as it
appears in Glean, the bundle skill's identifier, the discovery query that loads
it, and the exact tool names, then says: do not conclude the tools are
unavailable, do not answer from search instead, do not ask the user to enable
anything. Verified in Chat: the same prompt loaded the bundle and ran the two
tools the section named.

**Rule.** A hand-authored skill is a router and a playbook. It must tell the
model where the tools live and how to load them, by name, so the model never
has to discover them.

### Invented tool names

**Symptom.** (Inferred from the fix.) Chat tried to discover tool names by
inspecting a runtime, listing modules, or trying alternate spellings instead of
calling the catalog name.

**Fix.** The skill lists every tool by exact catalog name under Reads and Writes
and says: "Call these tools by the exact names below. Do not inspect Python,
list modules, probe the runtime, or invent alternate spellings." Separately, the
server resolves host-mangled names (`portal__searchitems`, `searchitems`) back
to the canonical name, because Glean Tool Search was observed to store
`<server>__<lowercased tool name>` and to call title-case or lowercase.

**Rule.** The skill is the authoritative list of names. The server tolerates
case and prefix mangling; nothing else.

### A required field the server did not need

**Symptom.** Chat refused to call the create tool at all once the connection
moved to OAuth.

**Cause.** Every write tool listed `currentUserEmail` in JSON Schema `required`,
and the skill told the model to look the email up or ask for it. The server
already derived the acting user from the token and ignored the argument, so the
schema and the skill were forcing a question with no answer.

**Fix.** Drop the field from `required`; give every occurrence one shared
description that says it is optional, ignored on a signed-in connection, and
not to be asked for unless a tool error says it is missing (`CURRENT_USER_EMAIL`
in `apps/mcp/src/tools/updateItem.ts`). The skill's **Acting user** section
says the same thing in the same words. The error path for key connections is
unchanged and still prompts once.

**Rule.** `required` is for values the model can always supply from the prompt.
Identity is never one of them: "a model must never invent an identity field",
as the source project's attribution decision put it. When a schema and a skill
both describe a field, they must agree.

### Host-injected arguments

**Symptom.** Two separate incidents with one shape: the catalog accepted the
tool, then the call never reached the server. In one, Glean's Create-click
validator rejected a write payload before `tools/call`. In the other, Tool
Search found a read tool and the connector rejected the call.

**Cause.** Glean's write-action execute path injects an extra argument,
`_user_goal` ("the exact input query from the user that caused you to call this
tool"), and a schema with `additionalProperties: false` had not declared it. The
read tool's schema used `oneOf` at the property level, which the catalog import
accepted and the connector did not.

**Fix.** Declare `_user_goal` as an optional string on every write tool and
ignore it in the handler; keep input schemas flat (no `oneOf` at the top of a
property).

**Rule.** The accelerator validates arguments against the advertised schema
before the handler runs ([The argument gate](design.md#the-argument-gate)), so
an undeclared host argument is a `-32602`, not a silent pass. If your host
injects fields, declare them. Confirm against your tenant with one write from
Chat before relying on it.

### The catalog is a snapshot

**Symptom.** After a deploy that changed a schema, Agent Builder still showed the
pre-deploy `required` list. In another case Chat kept the old schema for up to
twelve hours after deploy.

**Cause.** Glean imports `tools/list` when the server is added and does not
re-poll.

**Fix.** Re-sync the connection after any change to a tool name, description,
or schema (see [After any change](#after-any-change-re-sync-the-catalog)).

### Body wording steers too

**Symptom.** A working multi-step flow (list a partner's accounts, join a
Salesforce field, render a sheet) stopped reaching the tool after the skill's
output instructions were tightened to "CSV only".

**Cause.** The new wording was added after the flow already worked, and it moved
routing off the path that worked. The source project reverted to the wording
from the successful chat.

**Rule.** Every sentence in a skill body is a steering input, not only the
description. Change one thing, re-run the prompts that worked, keep the change
only if they still work. Keep a short list of proving prompts with the skill.

### Too many skills, or a stale one

**Observation.** The source project's agent spec records two rules learned
while tuning: no one-to-one tool-wrapper skills ("they add routing cost with no
orchestration benefit"), and detach a skill once its workflow moves into the
agent instructions, because a stale attached skill would contradict the review
gate the new workflow enforces.

**Rule.** Skill routing reads every attached skill's description on every turn,
so the set should be small. Do not add a skill that wraps one tool one-to-one.
Remove a skill when its section moves elsewhere.

## Rules for tool descriptions

The description is the only thing Glean knows about a tool before the first
call. Write it for a reader who will choose between this tool and its
neighbours in under a second.

1. **Lead with the record-level job and its cardinality.** "Query live records
   for ONE item by id or name" or "Search MANY items by name, description, or
   website". Capitals on ONE and MANY are deliberate; they survived every
   rewording in the source project because they are the axis Chat most often
   got wrong.
2. **Quote the user phrasings it answers.** Two or three, in the words people
   type: "who owns Contoso?", "which distributors are archived?". These are the
   strings the router matches against. Do not include the product name or "MCP"
   among them.
3. **Say what comes back.** The fields a follow-up question or a write will need
   (`id`, `name`, `status`, `owner`, a portal link). If a per-row follow-up call
   is the likely mistake, say the rows already carry those fields and name the
   tool not to call.
4. **Say when not to use it, and name the sibling.** "Not for a list; that is
   `searchItems`." "For a single item's full record use `getItem`." Both sides
   of every pair name each other.
5. **Put write safeguards in the description.** Confirm before calling, exact id
   only from a named read tool, never a guessed id, what state the record lands
   in (draft, pending review), who can approve it. The host's confirmation panel
   reads the description; so does the model when it decides whether to ask.
6. **Two to five sentences.** Steps, presentation rules, and edge cases go in
   the skill. A long description risks being deferred out of the catalog.
7. **Leave the provenance suffix to the server.** `LIVE_DATA_NOTE` and
   `SUPPLEMENTARY_CONTEXT_NOTE` are appended by `listTools()`. Set `PORTAL_NAME`
   so the suffix names your portal, and set `MCP_SERVER_DESCRIPTION` to a scope
   statement in the same shape: what the server owns, then what it does not.
8. **Do not name a tool like a generic entry point.** `search`, `query`, `ask`,
   and `help` pull unrelated prompts toward the server. `routing.spec.ts`
   forbids them. Name tools `verbNoun` for the record they act on.
9. **Pin the routing copy with a test.** The accelerator's `routing.spec.ts`
   pins the provenance suffix. Extend it as the source project did: for each
   proving prompt, the tool it must reach and the phrases in that tool's
   description that make it the obvious pick; for each sibling pair, the
   sentence that names the other; for each write, the safeguard phrases. A
   reworded description that would re-route a prompt then fails CI instead of a
   user's question.

## Rules for `inputSchema` field descriptions

The schema is read twice: by Glean to fill arguments, and by the server's
argument gate to reject what Glean filled wrongly. Write the descriptions for
the first reader so the second one rarely fires.

1. **Every property has a description**, including the obvious ones. An
   undescribed `limit` is a `limit` the model guesses at.
2. **Say where the value comes from.** "Item id (`itm_...`) from `searchItems`.
   Do not guess." A field that must come from an earlier tool result says which
   tool and which field.
3. **Bounded values are `enum`s, and the description repeats them.** Generate
   both from the constant the handler uses. A missing value in either place is a
   value users cannot filter by.
4. **Give an example for anything with a format.** `example.com` for a domain,
   `2026-10-16T15:00:00Z` for a timestamp, `itm_...` for an id. The model copies
   the shape.
5. **`required` only for what the prompt always contains.** The record name on a
   create; the id on an update. Never identity, never a value the server can
   derive. The accelerator's `createItem` requires `name` alone.
6. **Shared fields use one shared constant.** `CURRENT_USER_EMAIL` is defined
   once and spread into every write tool, so the words cannot drift between
   tools, and a change to the policy is one edit.
7. **Flat schemas.** `type`, `enum`, `items`, bounds. Avoid `oneOf` and nested
   alternatives at the property level; the source project saw them pass the
   catalog import and fail at call time.
8. **Declare what the host injects.** With `additionalProperties: false`, an
   argument the host adds on its own (`_user_goal` on Glean write actions) must
   be declared or the argument gate rejects the call before the handler runs.
9. **Distinguish look-alike fields.** When two fields are both "status", say
   which: "the account badge, not the opportunity stage; use `stages` for
   that." The model picks the first field whose name matches the prompt.

## Rules for the skill

A skill file has one job per section, and the frontmatter description is the
router between skills. The example at `docs/mcp/skills/example/SKILL.md` follows
this shape exactly; copy it and replace the vocabulary.

### The frontmatter description

Glean reads it on every turn to decide whether to load the skill. It is the
only part of the file that influences routing between skills, so everything
that must be true before the body is read goes here:

- The records it covers and the question shapes it answers, in users' words.
  Subject matter first; the product name may appear, but not as the trigger.
- "Also use when someone asks what the server can do, which tools it has, or
  what to ask it", so capability questions land here and are answered without a
  tool call.
- The source-of-truth rule: call the tool for a data question; do not answer
  from search, indexed exports, documents, prior chats, or memory; a tool figure
  wins on conflict.
- The refusals: the neighbouring jobs this skill must not take. A refusal in the
  body is read too late; the skill has already been selected.

Keep it to one paragraph. Every attached skill's description is read on every
turn, so length here is paid for on every prompt in the tenant.

### Callable tools

Immediately after the opening paragraph:

- The server as it appears in Glean (its display name and connection id) and
  its MCP URL.
- The auto-generated tool-bundle skill for that server, and the query that loads
  it ("manage records in `<mcp-url>`"), with the instruction to load it before
  answering if a tool is not already callable, and never to conclude the tools
  are unavailable, answer from search instead, or ask the user to enable
  anything.
- Every tool by exact catalog name, split into **Reads** and **Writes**, with
  the instruction not to probe, list, or invent names.
- "Full argument lists live in the MCP tool catalog. This file says which tool,
  which job, and which mistakes to avoid." The schemas stay in the catalog so
  the two cannot disagree.

### The router row

One table, one row per job: what the user wants, the section that handles it,
the tool or tools it calls. Rules for the rows:

- Rows are distinguished by **cardinality** and **direction**, not by noun. If
  two rows share a noun ("item"), the first column must say what separates them
  ("one named item", "a pasted list of items", "a new item", "an existing
  item").
- A capabilities row at the top, mapped to the Capabilities section with tool
  `none`.
- Multi-step jobs name the sequence ("`searchItems`, then `updateItem`"), so
  the model does not skip the read.
- Below the table, a **direction check** paragraph that restates the splits in
  prose, then the one-line guards that recur: "If a tool errors, stop. Do not
  fall back to search, do not loop another tool, do not fill the answer from a
  document."

### The Capabilities list

A section the model answers from without calling a tool, for "what can it do"
and "what should I ask". Group by job, name the tool, give one example prompt
the user can paste. State the write gates (confirmation, draft, review in the
portal). End with an **It will not** list: the jobs the server declines, the
actions it never performs (send, publish, approve), the data it does not hold.
Say "Do not describe capabilities from a design doc, a slide, or an older chat";
the list is the answer.

### Per-tool sections

One section per router row, in router order. Each:

1. Opens with the tool line: `Tool: searchItems.` or `Tools: searchItems, then
   updateItem.` Name every tool the section may call and no others.
2. Says what it is for and what it is not for, in user phrasings, mirroring the
   description's refusal in the other direction.
3. Numbered steps that map the user's words to arguments ("archived" to
   `status: ["ARCHIVED"]`; "add" to `createItem`, "change" to `updateItem`),
   name the candidate-disambiguation path (show candidates, ask, retry with the
   id), and for writes insert the preview-and-approve step before the call.
4. Says what to present: which fields, in which order, from which part of the
   result (`content[].text` rows vs. a preview line vs. `structuredContent`).
   Humanize enums. Never invent a metric the result does not contain.
5. Closes with the one or two mistakes seen for this job ("Never loop this over a
   column of names", "Do not read back a prior brief; it is stale").

### The field rule

**A field the skill does not mention does not reach the answer.** Chat follows
the skill; when a tool starts returning a new column and the skill's section
still lists the old ones, the model presents the old ones. The source project
made this a repository rule: a change to a tool, argument, description, or
returned field includes the skill in the same change, in three places, the
router row if the job changed, the Capabilities bullet, and that tool's section.
Output-only changes (a new field in the result, same schema) still need the
skill update; they do not need a catalog re-sync.

Adopt the same rule in your repository's contributor notes. The accelerator's
equivalent is: a change under `backend/apps/mcp/src/tools/` updates
`docs/mcp/skills/<name>/SKILL.md` in the same pull request.

### Agent Builder companion

A Glean Agent Builder agent that uses the server needs configuration that has no
home in a skill: which server connection it uses, which Glean-native tools are
attached beside it, its output mode, confirmation settings, and schedules. The
source project kept that in a separate `agent-instructions.md` and found two
things worth carrying over: the agent spec points at the skill for routing and
workflows rather than restating them, so the two cannot drift; and when a
schema change (the optional acting-user field) landed, both files had to change
in the same commit or one surface kept asking a question the other had stopped
asking. The example ships a short companion for that reason. If you only use
Chat, skip it.

## Review checklist

Run this against any change to a tool, a schema, or the skill before it merges.

**Tool descriptions**

- [ ] First sentence states the record-level job and ONE vs. MANY.
- [ ] Two or three user phrasings, none of them the product name or "MCP".
- [ ] Says what fields come back; if a per-row follow-up is the likely mistake,
      says the rows already carry them and names the tool not to call.
- [ ] Names each sibling tool and the prompt shapes that belong to it; the
      sibling names this tool back.
- [ ] Writes: confirm-before-call, exact id from a named read tool, landing
      state, who approves.
- [ ] Two to five sentences. No steps or presentation rules.
- [ ] No tool named `search`, `query`, `ask`, or `help`.
- [ ] `PORTAL_NAME` and `MCP_SERVER_DESCRIPTION` set for the deployment;
      `LIVE_DATA_NOTE` left to the server.
- [ ] `routing.spec.ts` pins the phrases above for every proving prompt.

**Schemas**

- [ ] Every property described; sources named for ids; examples for formats.
- [ ] Every bounded value an `enum`, repeated in the description, generated from
      the handler's constant.
- [ ] `required` contains only prompt-supplied values; no identity field.
- [ ] Shared fields come from one shared constant.
- [ ] No `oneOf` at property level; host-injected arguments declared.
- [ ] `annotations` correct: `READ_ONLY` on reads and content tools,
      `CREATES_RECORDS` or `UPDATES_IN_PLACE` on writes.

**Skill**

- [ ] Description: subject-matter triggers, capability-question clause,
      source-of-truth rule, refusals. One paragraph.
- [ ] Callable tools: server name and id, bundle skill, discovery query, exact
      names under Reads and Writes, "do not conclude unavailable".
- [ ] Router: capabilities row first; rows split by cardinality and direction;
      multi-step rows name the sequence; direction check and "if a tool errors,
      stop" below the table.
- [ ] Capabilities: grouped by job, tool named, pasteable example, write gates,
      "It will not".
- [ ] One section per router row, tools named on the first line, words-to-
      arguments mapping, preview-and-approve on writes, presentation rules,
      known mistakes.
- [ ] Every field the tool now returns that the answer should carry is named in
      that tool's section.
- [ ] Acting-user wording matches `CURRENT_USER_EMAIL` exactly.
- [ ] No one-to-one wrapper skills; superseded skills removed from the agent.

**Proving prompts** (run in Chat after deploy and re-sync)

- [ ] A plain question for each router row, without the product name.
- [ ] The same question naming the product ("use the portal to ...").
- [ ] A one-record and a many-record version of any paired tools.
- [ ] "What can the portal MCP do?" (answered from Capabilities, no call).
- [ ] One write: confirmation panel appears for the write only, the read before
      it ran without one, the result lands in the state the description said.
- [ ] One prompt the server should refuse (policy, documentation, general
      knowledge).

## After any change: re-sync the catalog

Glean imports `tools/list` as a snapshot. Until the connection is re-synced,
Chat and Agent Builder keep the old names, descriptions, and schemas; the source
project measured that lag at up to twelve hours when it was not forced.

1. Deploy the MCP stack (Actions → **infra-deploy** → env, stack `app/mcp`).
2. Confirm the live catalog: `POST https://mcp.<env>.<domain_root>/mcp` with
   `{"jsonrpc":"2.0","id":1,"method":"tools/list"}` and check the changed
   description or schema is what came back.
3. In the Glean admin console, open the server under Platform → Tools (Agent
   Builder → the server connection → **Edit settings**), change nothing, and
   **Save**. Saving re-imports the catalog.
4. If the skill changed, publish the new `SKILL.md` where your tenant manages
   skills. The repository copy is the source of truth; the published copy is a
   deploy artifact.
5. Run the proving prompts above. A result whose `_meta.portal.status` is
   `no_matches` is an empty result; `validation_error` with a `violations` list
   means the model filled an argument the schema rejects, which is a description
   problem, not a data problem.

Output-only changes (a new field in a result, same name and schema) do not need
step 3, but they do need the skill update and step 4, or the new field never
reaches an answer.
