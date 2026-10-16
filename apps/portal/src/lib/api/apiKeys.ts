// Live API-key management (AppSync). Admin-gated server-side. Scopes/status cross the
// wire as UPPER-case GraphQL enums; we lower-case them to the app's ApiKey shape (and
// upper-case scopes on the way in), the same convention as adminMutations.
import type { ApiKey, ApiKeyScope } from '../../data/types';
import { gql } from './graphql';

interface ApiKeyFields {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: string[];
  status: string;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

const KEY_FIELDS = `id name prefix last4 scopes status createdAt createdBy lastUsedAt expiresAt revokedAt`;

const API_KEYS = `query { apiKeys { ${KEY_FIELDS} } }`;

export async function fetchApiKeys(): Promise<ApiKey[]> {
  const data = await gql<{ apiKeys: ApiKeyFields[] }>(API_KEYS);
  return data.apiKeys.map(toApiKey);
}

export interface CreateApiKeyInput {
  name: string;
  scopes: ApiKeyScope[];
  expiresAt?: string | null;
}

const CREATE_API_KEY = `
  mutation CreateApiKey($input: CreateApiKeyInput!) {
    createApiKey(input: $input) { apiKey { ${KEY_FIELDS} } secret }
  }
`;

/** Returns the new key plus its full secret — shown exactly once. */
export async function createApiKey(
  input: CreateApiKeyInput,
): Promise<{ apiKey: ApiKey; secret: string }> {
  const data = await gql<{
    createApiKey: { apiKey: ApiKeyFields; secret: string };
  }>(CREATE_API_KEY, {
    input: {
      name: input.name,
      scopes: input.scopes.map((s) => s.toUpperCase()),
      expiresAt: input.expiresAt ?? null,
    },
  });
  return {
    apiKey: toApiKey(data.createApiKey.apiKey),
    secret: data.createApiKey.secret,
  };
}

const REVOKE_API_KEY = `mutation RevokeApiKey($id: ID!) { revokeApiKey(id: $id) { id } }`;

export async function revokeApiKey(id: string): Promise<void> {
  await gql(REVOKE_API_KEY, { id });
}

const DELETE_API_KEY = `mutation DeleteApiKey($id: ID!) { deleteApiKey(id: $id) }`;

export async function deleteApiKey(id: string): Promise<void> {
  await gql(DELETE_API_KEY, { id });
}

function toApiKey(k: ApiKeyFields): ApiKey {
  return {
    ...k,
    scopes: k.scopes.map((s) => s.toLowerCase() as ApiKeyScope),
    status: k.status.toLowerCase() as ApiKey['status'],
  };
}
