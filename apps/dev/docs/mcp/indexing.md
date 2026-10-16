---
id: indexing
title: Indexing push
sidebar_label: Indexing push
sidebar_position: 4
---

# Indexing push

The **Hub → Glean, indexed** path. A scheduled worker pushes hub records into a
custom Glean datasource through the Indexing API, so they appear in Glean search
and as grounding for chat, with Glean enforcing per-document permissions derived
from the hub's own visibility rules.

Use it alongside the MCP server, not instead of it: the index answers "find
things like this" across everything a user may see; the MCP server answers
"what is the current value of this field" and performs changes.

## What gets indexed

Each hub row becomes one document:

| Document field | From |
|---|---|
| `id` | the row's opaque id (`itm_…`) |
| `objectType` | the entity (`Item`) |
| `title` | `name` |
| `body` | description plus key fields as plain text |
| `viewURL` | `PORTAL_APP_URL/items/<id>`; Glean attributes clicks to the datasource through `urlRegex` |
| `permissions` | `allowAllDatasourceUsersAccess` for an unrestricted row; `allowedUsers: [owner]` for a role-restricted row |
| `updatedAt`, `createdAt`, `owner`, `customProperties` | the row |

The mapping lives in one function, `toDocument` in
`backend/apps/workers/glean-index/src/lambda.ts`. It is the only place that
knows your fields.

## Schedule and on-demand

- **Incremental** every 15 minutes: rows whose `updated_at` is after the last
  successful run, one `indexdocument` call each.
- **Full** on demand from Admin → Glean → *Re-index now* (or by invoking the
  worker with `{ "full": true }`): registers the datasource (`adddatasource`,
  idempotent), then `bulkindexdocuments` in pages of 100 with
  `forceRestartUpload`, which also removes documents that no longer exist.

Every run writes an `app.sync_runs` row (`entity = 'glean-index'`); the admin
screen lists them and the overview dashboard charts failures.

## Setup

1. In the Glean admin console, create an **Indexing API token** scoped to the
   datasource name the worker will register: `<project>_items` (underscores;
   the worker derives it from the project slug).
2. Store it in the `<project>-<env>/glean-indexing-token` secret
   (`aws secretsmanager put-secret-value`). The worker reads it at runtime;
   Terraform never does.
3. Run a full re-index once. The datasource appears in Glean's datasource list;
   documents follow within minutes.

`GLEAN_BASE_URL` is your tenant's backend origin, `https://<tenant>-be.glean.com`,
the same value the OAuth connection uses.

## Client

`backend/libs/glean-index` is a small, dependency-free client:
`addDatasource`, `indexDocument`, `bulkIndexDocuments`, `deleteDocument`. It
takes the token through a provider function, never logs it, and redacts it from
error text. Reuse it for a second entity or a second datasource.
