// Bearer handling for the MCP resource server (MCP authorization spec, RFC 6750 §3):
// an unauthenticated call gets 401 with a WWW-Authenticate header naming our
// protected-resource metadata, which is how a compliant MCP host finds the
// authorization server and starts the OAuth dance.
import type { OAuthConfig } from './config';
import { protectedResourceMetadataUrl } from './metadata';

export interface HttpResult {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

export function bearerFrom(headers: Record<string, string | undefined> | undefined): string | null {
  const raw = headers?.authorization ?? headers?.Authorization ?? '';
  const match = /^Bearer\s+(.+)$/i.exec(raw.trim());
  return match?.[1]?.trim() || null;
}

export function unauthorized(cfg: Pick<OAuthConfig, 'publicUrl'>, description = 'bearer token required'): HttpResult {
  return {
    statusCode: 401,
    headers: {
      'content-type': 'application/json',
      'www-authenticate': `Bearer resource_metadata="${protectedResourceMetadataUrl(cfg)}", error="invalid_token", error_description="${description}"`,
    },
    body: JSON.stringify({ error: 'invalid_token', error_description: description }),
  };
}