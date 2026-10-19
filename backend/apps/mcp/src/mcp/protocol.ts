// MCP protocol version negotiation (spec: Lifecycle → Initialization, and the
// Streamable HTTP transport's MCP-Protocol-Version header).
//
// On initialize the client proposes a version; the server answers with that version
// when it supports it, otherwise with the latest it does support, and the client
// decides whether to continue. On every later HTTP request the client sends the
// negotiated version as a header; a server that receives a version it does not
// support answers 400. A missing header is read as 2025-03-26 for compatibility,
// which is what the spec prescribes for a server that cannot otherwise tell.

/** Newest first. The server's behaviour is identical across these: it never
 *  accepted JSON-RPC batches (removed in 2025-06-18), and the structured tool
 *  output it returns is additive for a 2025-03-26 client. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly string[] = ['2025-06-18', '2025-03-26'];

export const LATEST_PROTOCOL_VERSION = SUPPORTED_PROTOCOL_VERSIONS[0]!;

/** The version a header-less request is taken to speak. */
export const DEFAULT_PROTOCOL_VERSION = '2025-03-26';

export const PROTOCOL_VERSION_HEADER = 'mcp-protocol-version';

export const isSupportedProtocolVersion = (version: unknown): version is string =>
  typeof version === 'string' && SUPPORTED_PROTOCOL_VERSIONS.includes(version);

/** The version to answer an initialize with: the client's when supported, else the latest. */
export const negotiateProtocolVersion = (requested: unknown): string =>
  isSupportedProtocolVersion(requested) ? requested : LATEST_PROTOCOL_VERSION;

export type HeaderCheck = { readonly ok: true; readonly version: string } | { readonly ok: false; readonly received: string };

/** Validate the MCP-Protocol-Version header of a post-initialize request. */
export function checkProtocolVersionHeader(headers: Record<string, string | undefined> | undefined): HeaderCheck {
  const received = headerValue(headers, PROTOCOL_VERSION_HEADER);
  if (received === undefined) return { ok: true, version: DEFAULT_PROTOCOL_VERSION };
  return isSupportedProtocolVersion(received) ? { ok: true, version: received } : { ok: false, received };
}

function headerValue(headers: Record<string, string | undefined> | undefined, name: string): string | undefined {
  if (!headers) return undefined;
  const key = Object.keys(headers).find((k) => k.toLowerCase() === name);
  const value = key === undefined ? undefined : headers[key];
  return typeof value === 'string' ? value.trim() : undefined;
}
