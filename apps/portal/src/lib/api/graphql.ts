// Minimal GraphQL-over-fetch client for AppSync. Sends the Cognito ID token as
// the bearer (the unified authorizer validates it against the pool's JWKS) and
// bounces to sign-in on a 401.

import { getIdToken, login } from '../auth/userManager';
import { GRAPHQL_URL, RUM_ENABLED } from './config';
import { recordGqlRequest } from '../telemetry';

export class ApiError extends Error {}

export interface Connection<T> {
  items: T[];
  total: number;
}

/** Drop undefined keys + empty-string scalars the schema would reject. */
export function defined<T extends object>(input: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(input).filter(([, v]) => v !== undefined && v !== ''),
  ) as Partial<T>;
}

/**
 * Drop undefined, empty-string, and empty-array values from a filter object.
 * Returns undefined when the cleaned object is empty (so callers can pass
 * `cleanFilter(f) ?? undefined` directly to the query variable).
 */
export function cleanFilter<T extends object>(filter: T): Partial<T> | undefined {
  const cleaned = Object.fromEntries(
    Object.entries(filter).filter(([, v]) =>
      Array.isArray(v) ? v.length > 0 : v !== undefined && v !== '',
    ),
  ) as Partial<T>;
  return Object.keys(cleaned).length ? cleaned : undefined;
}

interface GraphQLResponse<T> {
  data?: T;
  errors?: { message: string }[];
}

/** Best-effort GraphQL operation name for metric grouping (never variables/PII). */
function operationName(query: string): string {
  const named = query.match(/\b(?:query|mutation|subscription)\s+([A-Za-z0-9_]+)/);
  if (named) return named[1];
  const field = query.match(/\{\s*([A-Za-z0-9_]+)/);
  return field ? field[1] : 'anonymous';
}

/** Correlation id sent as x-request-id and stamped on the RUM event, so a client
 *  timing joins to its backend resolver timing. */
function newRequestId(): string {
  const c = globalThis.crypto;
  return c?.randomUUID ? c.randomUUID() : `r-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  if (!GRAPHQL_URL) throw new ApiError('VITE_GRAPHQL_URL is not configured.');

  const token = await getIdToken();
  if (!token) {
    void login();
    throw new ApiError('Not signed in — redirecting.');
  }

  const requestId = newRequestId();
  const startedAt = Date.now();
  let ok = false;
  try {
    const res = await fetch(GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${token}`,
        'x-request-id': requestId,
      },
      body: JSON.stringify({ query, variables }),
    });

    if (res.status === 401) {
      void login();
      throw new ApiError('Session expired — redirecting.');
    }
    if (!res.ok) throw new ApiError(`GraphQL request failed (HTTP ${res.status}).`);

    const body = (await res.json()) as GraphQLResponse<T>;
    if (body.errors?.length) throw new ApiError(body.errors.map((e) => e.message).join('; '));
    if (!body.data) throw new ApiError('GraphQL response had no data.');
    ok = true;
    return body.data;
  } finally {
    if (RUM_ENABLED) {
      recordGqlRequest({ op: operationName(query), durationMs: Date.now() - startedAt, ok, requestId });
    }
  }
}
