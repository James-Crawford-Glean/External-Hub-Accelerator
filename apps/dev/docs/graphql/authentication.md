---
id: authentication
title: Authentication
sidebar_label: Authentication
sidebar_position: 2
---

# Authentication

Every GraphQL request carries `Authorization: Bearer <token>`. AppSync's primary
auth mode is a **unified Lambda authorizer** that accepts **Cognito tokens
(people)** and **opaque API keys (machines)** and resolves the caller into a
principal the resolvers read. A secondary **AWS_IAM** provider admits
SigV4-signed callers (CI, integration tests).

## 1. Cognito ID token (people)

How the web app and this portal's **[Sandbox](/graphql-sandbox)** authenticate.
You sign in through Cognito's hosted UI (Authorization Code + PKCE, federated to
your identity provider) and the app sends the **ID token** as the bearer:

```
authorization: Bearer <cognito-id-token>
```

The authorizer verifies the JWT against the pool's JWKS with `aud` pinned to the
SPA app client, and (when `ALLOWED_EMAIL_DOMAINS` is set) rejects an email outside
the allowed domains as a second layer behind the pool's pre-sign-up gate. Tokens
are short-lived and refreshed silently by the client.

Who you are then decides what you may do: the authorizer resolves your email
against the **access roster** (`app.access_roster`) to a role and an admin flag.
A signed-in caller who is not on the roster can authenticate but has no role; the
web app records their sign-in as an access request for an administrator.

## 2. Cognito access token (MCP hosts)

An MCP host that connects through OAuth presents a Cognito **access token**
scoped `<mcp-url>/read` or `<mcp-url>/write`. The same authorizer accepts it;
the scopes cap what the person's roster role would otherwise allow. See
**[MCP authentication](../mcp/overview.md#authentication)**.

## 3. API key (machines)

For server-side integrations and MCP hosts that use a static credential,
create a key under **Admin → API keys** in the web app and send it as the bearer:

```
authorization: Bearer <key>
```

The authorizer resolves the key to its scopes (`READ`, `WRITE`, `ADMIN`) by
looking up `HMAC(pepper, token)`; the raw secret is never stored. A key is not a
person: a write made with a key needs an acting user supplied explicitly.

## 4. AWS_IAM (SigV4)

Callers that already hold AWS credentials can sign requests with SigV4; they
still need an IAM policy granting `appsync:GraphQL` on the API. For automation,
not interactive use.

---

:::note Portal sign-in ≠ API access
Signing into this developer portal proves you have an account in the pool so you
can read the docs and open the Sandbox. The API applies its own authorization to
every operation based on the token you present.
:::
