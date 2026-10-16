---
id: overview
title: GraphQL API
sidebar_label: Overview
sidebar_position: 1
---

# GraphQL API

The GraphQL API is the complete read/write surface over the hub's data. It is
the same schema the web app uses; the generated **[Schema Reference](./reference/reference-home.md)**
in this portal is built from `backend/schema.graphql` at build time, so it always
matches the deployed API.

## Endpoint

`https://gql.<env>.<domain_root>/graphql`, a white-label AppSync custom domain.
The native AppSync URL is available from the `native_graphql_endpoint` Terraform
output for diagnostics.

- **Transport:** HTTP `POST` with a JSON body `{ "query": "...", "variables": { ... } }`.
- **Auth:** `Authorization: Bearer <token>`; see **[Authentication](./authentication.md)**.

## Trying it

The **[GraphQL Sandbox](/graphql-sandbox)** is an embedded GraphiQL client
pointed at this environment. Signed in, it forwards your session token; locally
you can paste an API key.

For a reusable integration see **[Node.js](./nodejs.md)**.

## Calling it directly

```bash
curl -sS "$GRAPHQL_URL" \
  -H "content-type: application/json" \
  -H "authorization: Bearer $TOKEN" \
  -d '{"query":"query { items(limit: 5) { items { id name category status } total } }"}'
```

## Conventions

- **List results** come back as a connection, `{ items: [...], total: <n> }`, so
  one page carries the full match count. Page with `limit` and `offset`.
- **Filters** are input objects; omit a field to leave that dimension open.
- **IDs are opaque.** `usr_…`, `apk_…`, `itm_…`. An upstream system's id is a
  satellite field (`externalId`), never an `ID!`.
- **Visibility.** Rows may carry a `visibilityRole`. Readers see rows with no
  role plus rows matching their own roster role; administrators see everything.
  The same rule applies through MCP and in what the indexing push sends to Glean.
- **Writes** need write access: an `ADMINISTRATOR` or `EDITOR` roster role, or an
  API key with the `WRITE` scope. Administrative mutations need the admin flag or
  the `ADMIN` scope.
- **Errors** follow the GraphQL standard `errors[]` array; a `200` can carry
  `errors` alongside partial `data`.
- **Correlation.** Send an `x-request-id` header to join a client timing to its
  backend resolver timing in CloudWatch.

## The example domain

The schema ships with one entity, `items`, chosen to exercise every platform
path (sync from an upstream, visibility, writes, MCP, indexing). The
[README](https://github.com/your-github-org/your-portal-repo#replacing-the-example-domain)
describes how to replace it with your own.
