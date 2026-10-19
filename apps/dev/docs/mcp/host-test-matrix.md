---
id: host-test-matrix
title: Host test matrix
sidebar_label: Host test matrix
sidebar_position: 6
---

# Host test matrix

The runbook for the first end-to-end test of a deployed environment: each MCP
host type, driven through the real edge, stage by stage, with the observable
that proves each stage happened. No host has yet completed this against a
deployed environment; the only full-flow test runs in-process against embedded
Postgres. Fill the **Result** column as you go and keep the filled copy with
the deploy record.

Four host types, one table each. The stages are the same for all of them:

**Discover → Register → Authorize → Token → List tools → Call read → Call write (draft) → Approve**

## Before you start

- A deployed environment, with `terragrunt output` from `live/<env>/app/mcp`
  at hand: `public_url`, `access_log_group_name`, `lambda_log_group_name`.
- Log access. Tail both groups in two terminals:

  ```sh
  aws logs tail "$ACCESS_LOG_GROUP" --follow --format short
  aws logs tail "$LAMBDA_LOG_GROUP" --follow --format short --filter-pattern '{ $.msg = "mcp.*" }'
  ```

- Database access through the RDS Data API (`aws rds-data execute-statement`
  with the cluster and secret ARNs from `live/<env>/infra/aurora`), for the
  row checks.
- Two roster entries at `app.access_roster`: the tester as `EDITOR` (writes)
  and a second person as `VIEWER` (to prove the catalog filter and the gate).
- `MCP_REDIRECT_HOSTS` set for the environment before the Glean rows: the
  tenant's backend host, or Register fails with `invalid_redirect_uri`.
- A clean slate for Register: list the pool's app clients first
  (`aws cognito-idp list-user-pool-clients --user-pool-id <pool>`) so a
  `dcr-*` client that appears is unambiguous.

## What each stage looks like from the server

The same observables apply to every host. The per-host tables below say how to
drive the stage and what differs; this table says what to look for.

| Stage | Request | HTTP (access log) | Lambda line | Row |
|---|---|---|---|---|
| Discover | `GET /.well-known/oauth-protected-resource` then `GET /.well-known/oauth-authorization-server` on the MCP host. Many hosts first `POST /mcp` with no token to trigger discovery. | `200` on both `.well-known` routes; a leading `POST /mcp` is `401` | `mcp.denied` with `reason: no_bearer`, `authMethod: none` for the leading probe; nothing for the metadata GETs | none |
| Register | `POST /register` with `client_name`, `redirect_uris`, `token_endpoint_auth_method` | `201`; a repeat is also `201`; a bad redirect host is `400`; a burst is `429` (never reaches the Lambda) | `mcp.register` with `outcome: created` (first) or `reused` (repeat), `clientName`, `redirectHosts`; `outcome: rejected` with `error: invalid_redirect_uri` on a bad host | A Cognito app client named `dcr-<slug>-<digest>` in the user pool (`list-user-pool-clients`) |
| Authorize | Browser at `https://auth.<env>.<root>/oauth2/authorize?...&scope=openid email <mcp-url>/read <mcp-url>/write` with PKCE | Cognito-side; nothing on the MCP host | Cognito pre-sign-up trigger log group (`/aws/lambda/<cognito-name>-presignup`) only when a sign-up is denied by the email-domain gate | Cognito user pool → Users shows the signed-in user |
| Token | `POST https://auth.<env>.<root>/oauth2/token` (code exchange) | Cognito-side | none; the proof is the first authenticated `POST /mcp` below | none |
| List tools | `POST /mcp` `initialize`, then `tools/list` with the `MCP-Protocol-Version` header set to the negotiated version | `200`, `200` | none (reads are not logged individually; `tools_call` lines start at the next stage). A `400` here with `-32600` means the host sent an unsupported `MCP-Protocol-Version` | none |
| Call read | `tools/call` `searchItems` `{ "search": "<a known item>" }` | `200` | `mcp.tools_call` with `name: searchItems`, `isError: false`, `ms` | none |
| Call write (draft) | `tools/call` `createItem` `{ "name": "Test <date>", "category": "Vendor" }`; the host shows a confirmation panel first (`readOnlyHint: false`) | `200` | `mcp.tools_call` with `name: createItem`, `isError: false` | `example.items` row with `status = 'DRAFT'`, `source = 'mcp'`, `owner_user_id` = the tester; `app.notifications` row with `kind = 'item_draft'`, `recipient_email` = the tester |
| Approve | In the web app: Items → **Drafts awaiting review** → approve (`approveItem`) | web app and GraphQL, not the MCP host | none | the same `example.items` row with `status = 'ACTIVE'`, `reviewed_at` and `reviewed_by_email` set; `searchItems` from the host now returns it; the next incremental Glean index run pushes it |

Row checks:

```sql
SELECT id, status, source, owner_user_id, reviewed_at, reviewed_by_email
FROM example.items WHERE name LIKE 'Test %' ORDER BY created_at DESC LIMIT 5;

SELECT recipient_email, kind, href, created_at
FROM app.notifications WHERE kind = 'item_draft' ORDER BY created_at DESC LIMIT 5;
```

Expected results the matrix also proves on the way: the `initialize` response's
`protocolVersion` equals the host's proposal when it is `2025-06-18` or
`2025-03-26`, else `2025-06-18`; a `VIEWER` running List tools receives three
tools, an `EDITOR` five ([The catalog matches the caller](design.md#the-catalog-matches-the-caller));
a `VIEWER` calling `createItem` gets a JSON-RPC error with
`_meta.portal.status: authorization_error` and the `mcp.tools_call` line shows
`rpcError: true, status: authorization_error`.

## Glean Chat via the MCP Gateway

The governed path. An administrator adds the server in the Glean admin console;
Glean discovers, registers, and (once per user) authorizes. Users then reach
the tools from Chat.

| Stage | Drive it | Expect | Result |
|---|---|---|---|
| Discover | Admin console → Platform → Tools → add MCP server with `<public_url>/mcp` | Access log: `.well-known` GETs `200` from Glean's egress IP; `userAgent` identifies Glean | |
| Register | Automatic on add | `mcp.register` `outcome: created`, `clientName` as Glean names itself, `redirectHosts: 1`; the redirect host is the tenant backend host listed in `MCP_REDIRECT_HOSTS`. Glean also sends a non-standard `resource` field; the shim ignores it. A second add or a re-sync logs `reused` | |
| Authorize | A user opens the server's connect prompt in Glean and signs in through the Cognito hosted UI | Cognito shows the user; no MCP-host traffic | |
| Token | Automatic after consent | First authenticated `POST /mcp` from Glean appears in the access log with `200` | |
| List tools | Automatic: Glean imports the catalog when the server is added and on **Edit settings → Save** | The tool list in the admin console shows five tools. If it shows three, the importing connection could not write: re-import with a write-capable connection or set `MCP_CATALOG_FILTER=off` ([overview](overview.md#making-it-available-in-glean)) | |
| Call read | In Chat: "find the Northwind item" (or a name from your data) | `mcp.tools_call` `searchItems`; the answer quotes the live record. Glean adds `_user_goal` to write-action calls; the argument gate drops it, so no `-32602` | |
| Call write (draft) | In Chat: "add Fabrikam as a vendor"; approve Glean's confirmation panel | `mcp.tools_call` `createItem`; `DRAFT` row and `item_draft` notification; Chat says it is a draft awaiting approval | |
| Approve | Web app: Items → Drafts awaiting review → approve | Row `ACTIVE`; a follow-up Chat search finds it | |

Notes: the catalog Glean holds is a snapshot; after any change to a tool name,
description, or schema, **Edit settings → Save** on the server connection. The
skill that routes Chat to these tools is in `docs/mcp/skills/example/` and
[Skill authoring](skill-authoring.md) explains the proving prompts.

## Glean Agent Builder

Same server connection as Chat, referenced by its connection id; the agent
attaches tools explicitly, so this row set proves the per-agent surface.

| Stage | Drive it | Expect | Result |
|---|---|---|---|
| Discover, Register | Already done when the server was added for Chat; a new connection repeats them | `mcp.register` `reused` if the registration tuple is unchanged, `created` for a new connection | |
| Authorize, Token | The agent's user authorizes once | As for Chat | |
| List tools | Builder → the agent → tools → add from the server connection | The five tools are offered for attachment (three if the importing connection could not write) | |
| Call read | Preview the agent with "find the Northwind item" | `mcp.tools_call` `searchItems` | |
| Call write (draft) | Preview with "add Fabrikam as a vendor" | Confirmation panel unless **Run without user confirmation** is on for the write tool; then `createItem`, `DRAFT` row, notification | |
| Approve | Web app | As for Chat | |

Notes: keep **Run without user confirmation** off for `createItem` and
`updateItem` in an interactive agent; the companion spec in
`docs/mcp/skills/example/agent-instructions.md` says what else belongs in the
builder.

## IDE host (Cursor)

A direct path. The IDE registers itself through DCR as a public client with a
loopback redirect, authorizes in the user's browser, and lists tools per user,
so it exercises the catalog filter as designed.

| Stage | Drive it | Expect | Result |
|---|---|---|---|
| Discover | Cursor settings → MCP → add server with `<public_url>/mcp` | Access log: `POST /mcp` `401` then the `.well-known` GETs `200`; `mcp.denied` `reason: no_bearer` | |
| Register | Automatic | `mcp.register` `outcome: created`, `redirectHosts: 1`; the redirect is `http://localhost:<port>/...` (loopback is always allowed) and the method is typically `none` (no client secret). Confirm the client name Cursor sends from the line | |
| Authorize | Browser opens the Cognito hosted UI; sign in as the tester | Cognito shows the user | |
| Token | Automatic | First authenticated `POST /mcp` `200` | |
| List tools | Cursor shows the server's tools | Five tools for the `EDITOR` tester. Repeat as the `VIEWER`: three tools | |
| Call read | In Cursor's chat: "use the portal to find the Northwind item" | `mcp.tools_call` `searchItems` | |
| Call write (draft) | "add Fabrikam as a vendor in the portal"; approve Cursor's tool-call prompt | `createItem`, `DRAFT` row, notification | |
| Approve | Web app | Row `ACTIVE` | |

Notes: an IDE may send `MCP-Protocol-Version` on every request after
`initialize`; a `400` with `-32600` here means it negotiated a version the
server does not list ([Protocol version](design.md#protocol-version)).

## CLI host (curl)

The explicit path, with every request visible. Use it first; when it passes,
a failure in another host is on that host's side of the wire. Replace
`$MCP`, `$AUTH`, and `$POOL` with `public_url`, the Cognito hosted-UI origin,
and the user pool id.

| Stage | Drive it | Expect | Result |
|---|---|---|---|
| Discover | `curl -si -X POST $MCP/mcp -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize"}'` then `curl -s $MCP/.well-known/oauth-protected-resource` and `curl -s $MCP/.well-known/oauth-authorization-server` | `401` with `WWW-Authenticate: Bearer resource_metadata="..."`; `mcp.denied` `reason: no_bearer`. Both metadata documents `200`; `authorization_servers[0]` is the Cognito issuer, `registration_endpoint` is `$MCP/register` | |
| Register | `curl -s -X POST $MCP/register -H 'content-type: application/json' -d '{"client_name":"cli-test","redirect_uris":["http://localhost:8080/callback"],"token_endpoint_auth_method":"none"}'` | `201` with `client_id`, no `client_secret`; `mcp.register` `outcome: created, clientName: cli-test, redirectHosts: 1`. Run it again: `reused`. Run it with `"redirect_uris":["https://attacker.example/cb"]`: `400` `invalid_redirect_uri`, `outcome: rejected` | |
| Authorize | Generate a PKCE verifier and challenge; open `$AUTH/oauth2/authorize?client_id=<client_id>&response_type=code&redirect_uri=http://localhost:8080/callback&scope=openid%20email%20$MCP/read%20$MCP/write&code_challenge=<challenge>&code_challenge_method=S256` in a browser; sign in; copy `code` from the redirected URL | Cognito shows the user. A denied email domain shows the pre-sign-up trigger's log line | |
| Token | `curl -s -X POST $AUTH/oauth2/token -d grant_type=authorization_code -d client_id=<client_id> -d code=<code> -d redirect_uri=http://localhost:8080/callback -d code_verifier=<verifier>` | `200` with `access_token`; its `scope` contains `$MCP/read $MCP/write`. Export it as `$TOKEN` | |
| List tools | `curl -s -X POST $MCP/mcp -H "authorization: Bearer $TOKEN" -H 'content-type: application/json' -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18"}}'` then the same with `-H 'MCP-Protocol-Version: 2025-06-18'` and `{"jsonrpc":"2.0","id":2,"method":"tools/list"}` | `protocolVersion: "2025-06-18"`; five tools for the `EDITOR`. Repeat `tools/list` with `MCP-Protocol-Version: 2024-11-05`: `400` with `-32600` and `supportedProtocolVersions`. Repeat the flow as the `VIEWER`: three tools | |
| Call read | `{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"searchItems","arguments":{"search":"northwind"}}}` | `200`; `_meta.portal.status` `success` or `no_matches`; `mcp.tools_call` `searchItems` | |
| Call write (draft) | `{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"createItem","arguments":{"name":"Test cli","category":"Vendor","_user_goal":"add a test item"}}}` | `200`; `structuredContent.status: "DRAFT"`; the `_user_goal` is dropped by the gate, not rejected. `DRAFT` row and notification. Send it again: `idempotent: true`, no second row. Send it with `"bogus":1`: `-32602` with `violations`. As the `VIEWER`: JSON-RPC error with `authorization_error` | |
| Approve | Web app: Items → Drafts awaiting review → approve | Row `ACTIVE`; `searchItems` for `Test cli` returns it | |

Also from the CLI, prove the key path if the stack has the unified authorizer:
create a read-only key in Admin → API keys, call `tools/list` with
`authorization: Bearer <key>`: three tools; call `createItem`: the resolver
gate refuses; call `GET $MCP/logos?domain=example.com` with a write-only key:
`403` and `mcp.denied` `reason: read_scope_required`. A bad key is a `403`
from the gateway authorizer, visible only in the access log with
`authorizerError` set.

## Recording

Keep one filled copy of this page per environment and date. A stage that
passes in the CLI column and fails in a host column is a host-side difference
(registration method, redirect host, header behaviour, catalog snapshot);
compare the `mcp.register` and `mcp.denied` lines between the two runs first.
