---
id: nodejs
title: Node.js and npm
sidebar_label: Node.js and npm
sidebar_position: 3
---

# Node.js and npm

Use the GraphQL API from a Node.js service, a command-line script, or an
npm-based web application. Keep the endpoint and credential outside the source
so the same integration moves between environments unchanged.

## Configuration

Create a local `.env` file and keep it out of version control:

```dotenv
PORTAL_GRAPHQL_URL=https://gql.example.<domain_root>/graphql
PORTAL_TOKEN=replace-me-with-a-token
```

- **Server-side Node.js:** use an API key created under Admin → API keys, held
  in a secret manager or an environment variable. Never ship it in a browser
  bundle.
- **Browser applications:** use the Cognito flow in
  **[Authentication](./authentication.md)**.

## Minimal client with `graphql-request`

```bash
npm install graphql graphql-request dotenv
```

`src/portal.mjs`:

```js
import 'dotenv/config';
import { GraphQLClient, gql } from 'graphql-request';

const url = process.env.PORTAL_GRAPHQL_URL;
const token = process.env.PORTAL_TOKEN;
if (!url || !token) throw new Error('Set PORTAL_GRAPHQL_URL and PORTAL_TOKEN');

export const client = new GraphQLClient(url, {
  headers: { authorization: `Bearer ${token}` },
});

const ITEMS = gql`
  query Items($filter: ItemFilter, $limit: Int, $offset: Int) {
    items(filter: $filter, limit: $limit, offset: $offset) {
      items { id name category status website owner { name email } updatedAt }
      total
    }
  }
`;

export async function listItems({ search, status, limit = 50, offset = 0 } = {}) {
  const { items } = await client.request(ITEMS, {
    filter: { search, status },
    limit,
    offset,
  });
  return items;
}
```

```bash
node -e "import('./src/portal.mjs').then(m => m.listItems({ search: 'north' })).then(r => console.log(r))"
```

## Example: paging through every row

Connections return `total`, so a loop knows when it is done:

```js
export async function* allItems(filter = {}, pageSize = 100) {
  for (let offset = 0; ; offset += pageSize) {
    const page = await listItems({ ...filter, limit: pageSize, offset });
    yield* page.items;
    if (offset + page.items.length >= page.total || page.items.length === 0) return;
  }
}
```

## Example: a write with an API key

A key is not a person. Writes made with a key are attributed to the key's
`createdBy`; if your workflow needs a specific acting user, use a user token
or the MCP server, which carries the acting user explicitly.

```js
const UPDATE_ITEM = gql`
  mutation UpdateItem($id: ID!, $input: ItemInput!) {
    updateItem(id: $id, input: $input) { id name status updatedAt }
  }
`;

export async function archive(id) {
  const { updateItem } = await client.request(UPDATE_ITEM, { id, input: { status: 'ARCHIVED' } });
  return updateItem;
}
```

The key needs the `WRITE` scope; a `READ` key gets `not authorized: requires write access`.

## Native `fetch`

No dependency needed on Node 18+:

```js
export async function gqlFetch(query, variables) {
  const res = await fetch(process.env.PORTAL_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${process.env.PORTAL_TOKEN}`,
      'x-request-id': crypto.randomUUID(),
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}`);
  const body = await res.json();
  if (body.errors?.length) throw new Error(body.errors.map((e) => e.message).join('; '));
  return body.data;
}
```

## Moving between environments

Only `PORTAL_GRAPHQL_URL` and `PORTAL_TOKEN` change. Each environment has its
own Cognito pool and its own API keys, so a key minted in one does not work in
another.
