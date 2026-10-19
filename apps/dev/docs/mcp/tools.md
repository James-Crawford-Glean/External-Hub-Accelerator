---
id: tools
title: Tools
sidebar_label: Tools
sidebar_position: 3
---

# Tools

The live catalog is `tools/list`; this page describes each tool's contract and
the behaviour a host should expect. Inputs are JSON Schema with
`additionalProperties: false`. A caller who cannot write is served the three
read tools only ([The catalog matches the caller](design.md#the-catalog-matches-the-caller)).

## `whoAmI` (read)

The acting principal as the server sees it.

**Input:** none.

**Result:** `structuredContent` `{ kind: "user" | "apiKey", email, userId, role,
isAdmin, canWrite, scopes }`. Text: `ada@example.com: role ADMINISTRATOR
(administrator), may write.`

Call it first when a write tool reports that an acting user is required, to
learn whether the connection is signed in.

## `listUsers` (read)

People the portal knows about, from the user registry.

| Argument | Type | Notes |
|---|---|---|
| `search` | string | Case-insensitive fragment matched against name and email |
| `limit` | integer 1–100 | Default 25 |

**Result:** `{ total, rows: User[], truncated }`. Text lists `name <email>, title
[ROLE]` per row.

## `searchItems` (read, example domain)

Live items by name, description, or website, with optional status and category
filters. Visibility-scoped to the caller. Drafts awaiting review and rejected
drafts are never returned; they are reviewed in the portal.

| Argument | Type | Notes |
|---|---|---|
| `search` | string | Matched against name, description, website |
| `status` | `["ACTIVE" \| "ARCHIVED"]` | |
| `category` | string[] | |
| `limit` | integer 1–100 | Default 25 |

**Result:** `{ total, rows: Item[] & { url }, truncated }`. `url` is the deep
link into the web app (`PORTAL_APP_URL/items/<id>`). Text lists `name (id),
category [STATUS], owner` per row; the `id` is what `updateItem` needs.

## `createItem` (write, example domain)

Create an item as a `DRAFT` for the acting user to review. Annotated
`readOnlyHint: false, idempotentHint: false` (`CREATES_RECORDS`), so a host
asks the user before calling; the server then holds the row back until a
writer approves it in the portal. See
[Creates land as drafts](design.md#creates-land-as-drafts).

| Argument | Type | Notes |
|---|---|---|
| `name` | string | **Required.** |
| `category`, `description` | string | |
| `website` | string | Domain only; a scheme or path is stripped |
| `currentUserEmail` | string | Only for key connections with no signed-in user; ignored otherwise |

**Server-side rules:** `requireWrite`; the acting user becomes the draft's
owner and receives an `item_draft` notification linking to it. With no acting
user the tool returns `currentUserEmail is required…` as an error result
rather than writing: a draft must have someone to review it.

**Idempotent on acting user + name.** A retried call (same signed-in user,
same name after trimming and case-folding) finds the pending draft it already
made and returns it with `idempotent: true`; no second row or notification is
written. Approving or rejecting the draft releases the key. A partial unique
index backs this at the database, so two retries racing past the lookup
cannot both insert.

**Result:** `{ record: Item, status: "DRAFT", idempotent: boolean, url }`.
Text: `Drafted Contoso Logistics (itm_…) as DRAFT, owned by ed@example.com. It
is not published: approve it in the portal to make it live (…/items/itm_…).`
or, on a retry, `Already drafted (idempotent): Contoso Logistics (itm_…) is
awaiting review by ed@example.com (…). No second draft was created.`

## `updateItem` (write, example domain)

Change one item's fields or live status in place. Annotated
`readOnlyHint: false, idempotentHint: true`, so a host asks the user before
calling. That confirmation plus the server's `requireWrite` is the whole gate;
there is no draft state for an in-place edit.

| Argument | Type | Notes |
|---|---|---|
| `id` | string | **Required.** From `searchItems`. |
| `name`, `category`, `description`, `website` | string | Any subset |
| `status` | `"ACTIVE" \| "ARCHIVED"` | A status change applies to live rows only; `DRAFT` and `REJECTED` are set by review, never here |
| `currentUserEmail` | string | Only for key connections with no signed-in user; ignored otherwise |

**Server-side rules:** `requireWrite` (admin, `EDITOR`, or `write` scope); the
caller must be able to see the row (`visibilityRole`); at least one field must
change; an unknown `id` is a validation error. With no acting user the tool
returns `currentUserEmail is required…` as an error result rather than writing.

**Result:** `{ record: Item, changed: string[] }`. Text: `Updated Northwind
Traders (itm_…): status.`

## Errors

Arguments are validated against the tool's `inputSchema` before the handler
runs (see [The argument gate](design.md#the-argument-gate)). An unknown tool
name or an out-of-schema argument is a JSON-RPC `error` with code `-32602`;
for arguments, `error.data` carries the portal envelope with
`status: "validation_error"` and a `violations` list such as
`["limit: must be <= 100", "bogus: not an accepted argument"]`.

A tool-level problem the schema cannot express (unknown id, not authorized,
nothing to change, no acting user) comes back as a normal result with
`isError: true` and a one-line text, plus `_meta.portal.status` of
`validation_error` or `authorization_error`. A transport or server problem is
a JSON-RPC `error` with code `-32603` and the same envelope in `error.data`.
