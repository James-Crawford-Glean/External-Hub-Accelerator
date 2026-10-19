---
name: Portal
description: >
  Answer questions about live Portal records: items (name, category, status,
  owner, website, portal link), the people in the portal's user registry
  (name, email, title, role), and who the connection is acting as. Also use
  when someone asks what the Portal MCP can do, which tools it has, what to
  ask it, or how to use it. Use for "find the Northwind item", "which
  distributors are archived", "who owns Contoso Logistics", "give me the link
  to the Fabrikam item", "list portal users with sales in their title", "what
  role does Ada have", "add Fabrikam as a vendor", "archive Northwind",
  "rename the Contoso item", and "who am I signed in as". For a capabilities
  question, answer from the Capabilities section and do not call a tool. For a
  data question, call the Portal MCP tool in the matching section, however the
  prompt is phrased and whether or not it names the Portal. Do not answer from
  Glean search, indexed exports, documents, prior chats, or memory; a Portal
  record wins when those sources disagree. Not for policy, how-to
  documentation, or general company knowledge.
---

# Portal

Live Portal records are the source of truth for items and portal users. For a data question, call the tool in the matching section before you answer. For "what can the Portal MCP do", "what tools does it have", or "what can I ask", answer from the Capabilities section and do not call a tool. Glean search, documents, indexed exports, prior chats, and memory may appear only under a heading **Supplementary context**, and only after the tool result. If the two disagree, show the tool figure.

Each section below is one job. Follow only the section the router selects. To share a narrower skill later, copy that section into its own file, move its trigger phrases into that file's description, and attach only the tools that section names.

## Callable tools

This skill carries instructions only. The tools live in the Glean MCP server **Portal** (connection id `<server_id>`, endpoint `https://mcp.<env>.<domain_root>/mcp`). Glean exposes them through the auto-generated skill for that server, whose `tools/<name>.json` files hold the schemas.

If a Portal tool is not already in your callable set, load that skill before answering: discover it with the query "manage records in `https://mcp.<env>.<domain_root>/mcp`", read `tools/<name>.json` for the tool the router selected, and call it with that connection id. Do not conclude the tools are unavailable, do not answer from Glean search instead, and do not ask the user to enable anything.

Call these tools by the exact names below. Do not inspect code, list modules, probe the runtime, or invent alternate spellings to discover tool names.

**Reads:** `whoAmI`, `listUsers`, `searchItems`.

**Writes:** `createItem`, `updateItem`.

Full argument lists live in the MCP tool catalog. This file says which tool, which job, and which mistakes to avoid.

## Router

| The user wants | Section | Tool |
|---|---|---|
| What the Portal MCP can do, which tools it has, what to ask | Capabilities | none |
| Who the connection is acting as, whether it may write, or a write said an acting user is required | Acting user | `whoAmI` |
| People in the portal: by name or email fragment, someone's title or role | Find people | `listUsers` |
| One or more existing items by name, description, website, status, or category; an item's owner, status, or link; the id for an edit | Find items | `searchItems` |
| A new item that does not exist yet | Create an item | `searchItems`, then `createItem` |
| A change to an existing item: name, category, description, website, archive, or reactivate | Edit an item | `searchItems`, then `updateItem` |

Direction check. A person (name, email, title, role) is Find people. A record with a category, owner, or website is Find items. "Add", "create", or "new" is Create an item; "change", "rename", "archive", "reactivate", or "fix" is Edit an item. "Is Northwind archived?" is a read, not an edit. Both writes start with `searchItems`: a create to check the item does not already exist, an edit to get the exact `id`.

Items in review (`DRAFT`) and rejected drafts never appear in `searchItems`. They are reviewed in the portal, not here. Do not tell a user a draft is live, and do not try to publish one with `updateItem`.

If a Portal tool errors, stop. Do not answer from Glean search, do not retry with a guessed id, and do not fill the answer from a document.

## Capabilities

Use this when someone asks what the Portal MCP can do, which tools it has, what they can ask, or how a job maps to a tool. Do not call a tool. Do not describe capabilities from a design doc, a slide, or an older chat. Answer from the list below.

Group the answer by the job, name the tool, and give one example they can paste. Mention the write gates. Skip tools they did not ask about only when they asked about one job. A general "what can it do" question gets the full list.

**Look up**

- Items by name, description, or website, filtered by status (`ACTIVE`, `ARCHIVED`) or category, with owner, status, and a link into the portal. `searchItems`. "Find the Northwind item." "Which distributors are archived?"
- People the portal knows, by name or email fragment, with title and role. `listUsers`. "List portal users with sales in their title."
- Who the connection is acting as and whether it may write. `whoAmI`. "Who am I signed in as?"

**Write, after you confirm**

- Add an item. `createItem`. It lands as a `DRAFT` owned by the person asking; a writer approves or rejects it in the portal (Items → Drafts, or the notification bell). Nothing is published from chat. "Add Fabrikam as a vendor."
- Change one existing item's name, category, description, or website, or set its status to `ACTIVE` or `ARCHIVED`. `updateItem`. The change applies immediately under the acting user. Administrators, editors, and `write`-scoped keys only. "Archive Northwind."

**It will not**

- Answer item or people facts from a spreadsheet, an indexed export, or a prior chat.
- Publish, approve, or reject a draft. Those are portal actions.
- Delete an item. Archiving keeps the record.
- Show drafts awaiting review or rejected drafts.
- Answer policy, how-to, or general company questions. Those are Glean search.

## Acting user

Tool: `whoAmI`.

The connection identifies the user. Writes run as the signed-in person; do not ask for an email, look one up, or pass `currentUserEmail` by default. If a write tool's error says an acting user is required, call `whoAmI` once. If it reports a service key with no signed-in user, ask the user for their work email once, pass it as `currentUserEmail`, and reuse it for the conversation. Never attribute a change to a shared mailbox or guess an email.

For "who am I signed in as" or "can I make changes here", call `whoAmI` and present kind (user or service key), email, role, and whether the connection may write. Do not call it before every read; reads do not need it.

## Find people

Tool: `listUsers`.

Use for "list portal users with sales in their title", "what role does Ada have", "who in the portal has a contoso email". Not for who owns an item (that is Find items) and not for people outside the portal (that is Employee Search).

1. Call `listUsers` with `search` set to the name or email fragment the user gave. Omit `search` for the whole list. Default `limit` is 25; raise it (max 100) only when they asked for everyone.
2. Present name, email, title, and role from the rows the tool returned. Roles are `ADMINISTRATOR`, `EDITOR`, `VIEWER`; humanize them.
3. If `truncated` is true, say how many matched (`total`) versus how many are shown, and offer to narrow the search.

## Find items

Tool: `searchItems`.

Use for "find the Northwind item", "which distributors are archived", "who owns Contoso Logistics", "give me the link to the Fabrikam item", "items in the Vendor category". Also the first step of every write. Not for people, and not for a draft awaiting review.

1. Map words to arguments: a name, description word, or domain to `search`; "archived" to `status: ["ARCHIVED"]`, "active" or "live" to `status: ["ACTIVE"]`, nothing when they did not say; a category name to `category: ["<name>"]`. Default `limit` is 25.
2. Present one row per item: name, category, status, owner, website, and the portal link (`url`). The text lines carry `name (id), category [STATUS], owner`; the `id` (`itm_...`) is what Edit an item needs. Humanize `ACTIVE` and `ARCHIVED`.
3. If `truncated` is true, say `total` versus shown and offer to narrow. If there are no rows, say no live item matched; do not search Glean for one.
4. When the user named one item and several rows match, show the candidates (name, category, owner) and ask which they mean before any write.

## Create an item

Tools: `searchItems`, then `createItem`.

Use for "add Fabrikam as a vendor", "create an item for Northwind Traders", "new item: Contoso Logistics, distributor". Not for changing an item that already exists (Edit an item).

1. Call `searchItems` with the proposed name. If a live item with that name exists, say so and switch to Edit an item unless the user wants a second record.
2. Map fields: `name` (required), `category`, `description`, `website` (domain only, `example.com`; strip a scheme or path). Do not invent a category, description, or website the user did not give.
3. Show a summary table, one row per field. Ask to approve, edit, or decline. On decline, stop.
4. On approval, call `createItem`. Tell the user it was saved as a draft owned by them and is not published; a writer approves it in the portal (Items → Drafts, or the notification bell). Give the returned portal link.
5. If the result says `idempotent: true`, a draft with that name is already awaiting review for this user. Say so and give its link. Do not create a second one.
6. If the tool says an acting user is required, follow Acting user, then retry once.

## Edit an item

Tools: `searchItems`, then `updateItem`.

Use for "archive Northwind", "reactivate Contoso", "rename the Fabrikam item to Fabrikam Inc", "set Northwind's website to northwind.example.com", "move Contoso to the Vendor category". Not for creating an item, publishing a draft, or deleting a record.

1. Find the row with `searchItems`. Show the best candidate (name, category, status, owner) and wait for confirmation. If several are plausible, list them and ask. Never guess an `itm_` id.
2. Map words to fields: a new name to `name`; a category to `category`; description text to `description`; a domain to `website`; "archive" to `status: "ARCHIVED"`; "reactivate", "unarchive", or "make live" to `status: "ACTIVE"`. Pass only the fields that change.
3. Show before and after for each changed field. Ask to approve, edit, or decline. On decline, stop.
4. On approval, call `updateItem` with the confirmed `id` and only the changed fields. The change applies immediately; there is no review step. Echo the `changed` list from the result.
5. A status change applies to live items only. If the user wants to publish or reject a draft, say that happens in the portal (Items → Drafts) and stop. If the tool reports the caller may not write, say the change needs an administrator or editor; do not retry.

## Build a narrower skill from this file

Use this when someone asks how to build a Portal skill, or which tool a job should call.

1. Pick one router row. That row is the skill.
2. Copy its section into a new `SKILL.md`. Put the row's trigger phrases, and the jobs it must refuse, in the description. The description is what Glean reads on every turn, so the refusal has to be there, not only in the body.
3. Keep the live-data rule in the new file. Name the Portal tool. Say that documents, exports, and prior chats do not replace the tool.
4. Attach only the tools that section lists. A skill that can call every tool will pick the wrong one.
5. Leave the confirm, draft, and "not published yet" language in the body. Those gates are how the portal keeps assistant writes reviewable.
