---
id: overview
title: MCP Server
sidebar_label: Overview
sidebar_position: 1
---

# MCP Server

The MCP server is the **Hub → Glean, federated** path: an MCP host (Glean chat,
Glean Agent Builder, Cursor, Claude Desktop) calls it at query time and gets
live records with the caller's permissions applied. Nothing is copied into the
host; the hub stays the system of record.

It is a stateless Node Lambda behind an HTTP API on its own hostname, speaking
**Streamable HTTP** with **JSON-RPC 2.0** bodies. Every tool reuses the GraphQL
API's resolver classes, so the MCP and GraphQL surfaces cannot disagree about a
record or about who may see it.

## Endpoint

```
https://mcp.<env>.<domain_root>/mcp
```

Liveness (no auth): `GET https://mcp.<env>.<domain_root>/mcp/health` → `{ "status": "ok", "server": "mcp" }`.

The hostname is also the OAuth **resource identifier**: discovery documents live
at `/.well-known/oauth-authorization-server` and
`/.well-known/oauth-protected-resource` on the same host.

### Logos

`GET https://mcp.<env>.<domain_root>/logos?domain=<domain>` returns logo metadata
for a domain from the hub's logo cache, or a `302` to the CDN with
`response=image`. `variant` is `auto`, `large`, or `small`. Same authorization as
`/mcp`; a credential without read capability is `403`.

## Transport

- Method: `POST`, `Content-Type: application/json`, `Accept: application/json`
- One JSON-RPC request object per call, one response object back; notifications
  (no `id`) are answered `202` with an empty body
- Protocol versions: `2025-06-18` and `2025-03-26`. `initialize` answers with
  the client's proposed version when it is one of these, otherwise with
  `2025-06-18`. Later requests send the negotiated version as
  `MCP-Protocol-Version`; an unsupported value is `400` with a JSON-RPC
  `-32600` error listing the supported set, and a missing header is read as
  `2025-03-26`. See [Protocol version](design.md#protocol-version).

## Authentication

Two credentials work, and they can coexist on one deployment.

### OAuth 2.1 (the default)

The server is an OAuth 2.1 **resource server** with **Dynamic Client
Registration**, using the environment's Cognito user pool as the authorization
server. A host that implements the MCP authorization spec needs only the MCP
URL:

1. It fetches `/.well-known/oauth-protected-resource`, learns the authorization
   server, and registers itself with `POST /register` (RFC 7591). The server
   mints a Cognito app client for it; the host's redirect hosts must be on the
   `OAUTH_REDIRECT_HOSTS` allowlist (for Glean, your tenant's backend host).
2. The user signs in through Cognito's hosted UI and consents to the
   `<mcp-url>/read` and `<mcp-url>/write` scopes.
3. The host sends the resulting Cognito **access token** as the bearer. The
   Lambda verifies it against the pool's JWKS, checks `aud` against the resource
   identifier, and resolves the user's email against the access roster.

The acting user is therefore known on every call. A `read`-only grant can never
write, whatever the person's roster role says.

### API key (service connections)

A host that cannot do OAuth sends a static key from Admin → API keys:

```
Authorization: Bearer <key>
```

The HTTP API's unified authorizer resolves the key to its scopes. A key is not a
person, so write tools need the acting user passed explicitly (see below).

### Acting user

Write tools attribute changes to a person. Resolution order:

1. The signed-in user of an OAuth connection (always present there)
2. The `x-user-email` request header, when the host forwards one
3. The tool's `currentUserEmail` argument

There is **no fallback identity**. A key connection that supplies none of these
gets a required-field error from the write tool rather than a change attributed
to nobody. The tool descriptions tell the model when to ask the user for an
email, so a signed-in connection is never asked.

## Protocol methods

| Method | Purpose |
|---|---|
| `initialize` | Handshake: negotiated protocol version, capabilities, `serverInfo`, and the server's scope statement as `instructions`. |
| `notifications/initialized` | Client → server; no response. |
| `ping` | Liveness. |
| `tools/list` | Tools with JSON-Schema `inputSchema` and MCP `annotations` (`readOnlyHint`, `destructiveHint`, `idempotentHint`, `openWorldHint`). |
| `tools/call` | Invoke a tool by `name` with an `arguments` object. |

### Example: `tools/call`

```json
{ "jsonrpc": "2.0", "id": 3, "method": "tools/call",
  "params": { "name": "searchItems", "arguments": { "search": "northwind", "limit": 5 } } }
```

```json
{ "jsonrpc": "2.0", "id": 3, "result": {
  "content": [{ "type": "text", "text": "1 item(s); showing 1.\n- Northwind Traders (itm_7Kf3Qb9RtX2mLp), Distributor, owner Owner One" }],
  "structuredContent": { "total": 1, "rows": [ { "id": "itm_7Kf3Qb9RtX2mLp", "name": "Northwind Traders", "...": "..." } ], "truncated": false },
  "_meta": { "portal": { "source": "Portal", "status": "success", "matches": 1,
             "coverage": { "complete": true, "returned": 1, "total": 1 },
             "retrievedAt": "2026-10-16T02:00:00.000Z", "summary": "1 item(s); showing 1." } }
} }
```

## Result shape

Every tool returns `content[]` (a short text digest the model can read) and
`structuredContent` (the machine-readable payload). The server adds a
**provenance envelope** under `_meta.portal` on every response: `source`,
`retrievedAt`, a derived `status` (`success`, `no_matches`, `partial`,
`authorization_error`, `validation_error`, `server_failure`), and when
applicable `matches` and `coverage`. An agent can tell an empty result from a
failure without parsing prose, and never narrates one as the other.

## Making it available in Glean

Add the MCP URL as a server under Admin console → Platform → Tools. Glean
imports `tools/list` as a snapshot and does not re-poll; after adding or
renaming a tool, re-sync the connection. Per-tool availability is set
separately for Chat, Agents, and the Glean MCP Server surface, and can be
scoped to users or groups.

Because the snapshot is taken with one credential, that credential decides
which tools Glean ever sees: `tools/list` omits write tools for a caller who
cannot write ([The catalog matches the caller](design.md#the-catalog-matches-the-caller)).
Import with a connection that can write, or set `MCP_CATALOG_FILTER=off` on the
Lambda, if Glean users should be offered `createItem` and `updateItem`.

Glean Chat reaches the tools through a skill. [Skill authoring](skill-authoring.md)
covers what Glean reads to pick a tool, the routing mistakes to design against,
and the skill that ships with the example domain.

The first connection from each host type, stage by stage with the log line and
database row that proves each stage, is the [Host test matrix](host-test-matrix.md).
