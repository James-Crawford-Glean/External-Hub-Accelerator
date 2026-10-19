// Minimal MCP server over JSON-RPC 2.0. In a stateless Lambda the Streamable-HTTP
// transport is request/response: one JSON-RPC request in, one response out;
// notifications (no `id`) get no response body. We hand-roll the handful of methods
// the spec needs rather than pull in the MCP SDK, whose server transport assumes a
// long-lived process — revisit if the method surface grows.
import { listTools, toolByName, PORTAL_NAME, type ToolContext, type ToolResponseMetadata, type ToolResult } from './tools';
import { validateArguments } from './validate';
import { negotiateProtocolVersion, SUPPORTED_PROTOCOL_VERSIONS } from './protocol';

const SERVER_INFO = { name: `${PORTAL_NAME.toLowerCase()}-mcp`, version: '0.1.0' } as const;
// Sent as `instructions` on initialize: the server-level scope statement a host
// weighs when deciding whether this server owns a prompt. Positive scope first,
// exclusions second. Override with MCP_SERVER_DESCRIPTION once the domain is known.
export const SERVER_DESCRIPTION =
  process.env.MCP_SERVER_DESCRIPTION ||
  `Query and update live ${PORTAL_NAME} records. Do not use ${PORTAL_NAME} for general policy, ` +
    'internal documentation lookup, or generic company knowledge.';

// JSON-RPC 2.0 error codes (subset). `as const` — no `const enum` under isolatedModules.
const RPC = {
  ParseError: -32700,
  InvalidRequest: -32600,
  MethodNotFound: -32601,
  InvalidParams: -32602,
  Internal: -32603,
} as const;

export type JsonRpcId = string | number | null;

export interface JsonRpcRequest {
  jsonrpc: '2.0';
  id?: JsonRpcId;
  method: string;
  params?: Record<string, unknown>;
}

export interface JsonRpcResponse {
  jsonrpc: '2.0';
  id: JsonRpcId;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

function ok(id: JsonRpcId | undefined, result: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

function fail(id: JsonRpcId | undefined, code: number, message: string, data?: unknown): JsonRpcResponse {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data === undefined ? {} : { data }) } };
}

// Arrays a read tool returns as its payload. Named explicitly rather than "first array in the
// object" so an incidental array field (candidates, samples) can't be mistaken for the result set.
const RESULT_ARRAYS = ['rows', 'items', 'created'] as const;

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

const asRecord = (v: unknown): Record<string, unknown> =>
  typeof v === 'object' && v !== null ? (v as Record<string, unknown>) : {};

function matchCount(sc: Record<string, unknown>): number | undefined {
  if (typeof sc.resolved === 'number') return sc.resolved;
  if (typeof sc.total === 'number') return sc.total;
  // Single-record reads carry no count.
  if (sc.record) return 1;
  return undefined;
}

// An empty result and a failure must not read alike, so the status is derived rather than guessed:
// isError splits into authorization vs validation, and a short window splits into partial.
function responseMetadata(result: ToolResult): ToolResponseMetadata {
  const text = result.content.map((c) => c.text).join(' ').trim();
  const sc = asRecord(result.structuredContent);
  const matches = matchCount(sc);
  const total = typeof sc.total === 'number' ? sc.total : undefined;
  const returned = RESULT_ARRAYS.map((k) => sc[k]).find(Array.isArray)?.length;
  const partial =
    sc.truncated === true ||
    sc.nextOffset != null ||
    (typeof returned === 'number' && typeof total === 'number' && returned < total);
  const dataAsOf = typeof sc.dataAsOf === 'string' ? sc.dataAsOf : str(asRecord(sc.record).dataAsOf);
  const status = result.isError
    ? /not authorized|requires .*access|restricted/i.test(text)
      ? 'authorization_error'
      : 'validation_error'
    : partial
      ? 'partial'
      : matches === 0 || /^no (?:matching|new|\w+ matched)/i.test(text)
        ? 'no_matches'
        : 'success';
  return {
    source: PORTAL_NAME,
    retrievedAt: new Date().toISOString(),
    status,
    ...(matches === undefined ? {} : { matches }),
    ...(typeof sc.unresolved === 'number' ? { unmatched: sc.unresolved } : {}),
    ...(typeof total === 'number' ? { coverage: { complete: !partial, returned, total } } : {}),
    ...(dataAsOf ? { dataAsOf } : {}),
    summary: text.split('\n', 1)[0]?.slice(0, 300) || `${PORTAL_NAME} request completed.`,
  };
}

/**
 * Handle one JSON-RPC request. Returns a response, or `null` for notifications
 * (requests with no `id`), which the transport answers with 202 / empty body.
 */
export async function handleRpc(req: JsonRpcRequest, ctx: ToolContext): Promise<JsonRpcResponse | null> {
  if (req?.jsonrpc !== '2.0' || typeof req.method !== 'string') {
    return fail(req?.id, RPC.InvalidRequest, 'invalid JSON-RPC 2.0 request');
  }
  const isNotification = req.id === undefined || req.id === null;

  switch (req.method) {
    case 'initialize':
      return ok(req.id, {
        protocolVersion: negotiateProtocolVersion(req.params?.protocolVersion),
        serverInfo: SERVER_INFO,
        capabilities: { tools: { listChanged: false } },
        instructions: SERVER_DESCRIPTION,
      });

    case 'notifications/initialized':
      return null; // client ack — no response

    case 'ping':
      return ok(req.id, {});

    case 'tools/list':
      return ok(req.id, { tools: listTools() });

    case 'tools/call': {
      const name = typeof req.params?.name === 'string' ? req.params.name : '';
      const tool = toolByName(name);
      if (!tool) return fail(req.id, RPC.InvalidParams, `unknown tool: ${name || '(none)'}`);
      // Protocol-level check per the MCP spec: arguments outside the advertised
      // inputSchema never reach a handler. Tool-level problems (unknown id, no
      // acting user) stay isError results so the host can relay them.
      const validated = validateArguments(tool.inputSchema, req.params?.arguments);
      if (!validated.ok) {
        const summary = `invalid arguments for ${tool.name}: ${validated.violations.join('; ')}`;
        console.log(JSON.stringify({ msg: 'mcp.tools_call', name, id: req.id ?? null, ms: 0, invalidArguments: true }));
        return fail(req.id, RPC.InvalidParams, summary, {
          source: PORTAL_NAME,
          retrievedAt: new Date().toISOString(),
          status: 'validation_error',
          summary,
          violations: validated.violations,
        } satisfies ToolResponseMetadata & { violations: readonly string[] });
      }
      const started = Date.now();
      try {
        const handled: ToolResult = await tool.handler(validated.value, ctx);
        const result: ToolResult = { ...handled, _meta: { ...handled._meta, portal: responseMetadata(handled) } };
        console.log(
          JSON.stringify({
            msg: 'mcp.tools_call',
            name,
            id: req.id ?? null,
            ms: Date.now() - started,
            isError: result.isError === true,
          }),
        );
        return ok(req.id, result);
      } catch (e) {
        const status = e instanceof Error && e.name === 'Unauthorized' ? 'authorization_error' : 'server_failure';
        console.log(
          JSON.stringify({
            msg: 'mcp.tools_call',
            name,
            id: req.id ?? null,
            ms: Date.now() - started,
            rpcError: true,
            status,
          }),
        );
        const message = e instanceof Error ? e.message : 'tool execution failed';
        return fail(req.id, RPC.Internal, message, {
          source: PORTAL_NAME,
          retrievedAt: new Date().toISOString(),
          status,
          summary: message,
        } satisfies ToolResponseMetadata);
      }
    }

    default:
      return isNotification ? null : fail(req.id, RPC.MethodNotFound, `method not found: ${req.method}`);
  }
}

export const PARSE_ERROR_CODE = RPC.ParseError;

/** The JSON-RPC error body for a request whose MCP-Protocol-Version header names a
 *  version this server does not speak; the transport answers it with HTTP 400. */
export function unsupportedProtocolVersion(id: JsonRpcId | undefined, received: string): JsonRpcResponse {
  return fail(
    id,
    RPC.InvalidRequest,
    `unsupported MCP-Protocol-Version "${received}"; this server supports ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`,
    { supportedProtocolVersions: SUPPORTED_PROTOCOL_VERSIONS },
  );
}
