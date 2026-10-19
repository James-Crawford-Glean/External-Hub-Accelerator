// Version negotiation: initialize answers the client's version when supported and
// the latest otherwise; later requests must carry a supported MCP-Protocol-Version
// header or get a 400 with a JSON-RPC error naming what the server does speak.
import { route, type RouteDeps } from '../lambda';
import { handleRpc } from './server';
import {
  checkProtocolVersionHeader,
  DEFAULT_PROTOCOL_VERSION,
  LATEST_PROTOCOL_VERSION,
  negotiateProtocolVersion,
  SUPPORTED_PROTOCOL_VERSIONS,
} from './protocol';

const identity = { kind: 'user', email: 'ops@example.com', sub: 'sub-ops' };
const initialize = (params?: Record<string, unknown>) =>
  handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize', ...(params ? { params } : {}) }, { identity });
const versionOf = async (params?: Record<string, unknown>) => ((await initialize(params))?.result as { protocolVersion: string }).protocolVersion;

describe('initialize negotiation', () => {
  it('pins the supported set, newest first', () => {
    expect(SUPPORTED_PROTOCOL_VERSIONS).toEqual(['2025-06-18', '2025-03-26']);
    expect(LATEST_PROTOCOL_VERSION).toBe('2025-06-18');
    expect(DEFAULT_PROTOCOL_VERSION).toBe('2025-03-26');
  });

  it('match: answers with the version the client proposed when supported', async () => {
    expect(await versionOf({ protocolVersion: '2025-06-18' })).toBe('2025-06-18');
    expect(await versionOf({ protocolVersion: '2025-03-26' })).toBe('2025-03-26');
  });

  it('downgrade: answers with the latest supported version when the client proposes a newer or unknown one', async () => {
    expect(await versionOf({ protocolVersion: '2026-07-28' })).toBe('2025-06-18');
    expect(await versionOf({ protocolVersion: 'draft' })).toBe('2025-06-18');
    expect(await versionOf({})).toBe('2025-06-18');
    expect(await versionOf()).toBe('2025-06-18');
    expect(negotiateProtocolVersion(42)).toBe(LATEST_PROTOCOL_VERSION);
  });
});

describe('MCP-Protocol-Version header', () => {
  it('reads a missing header as the compatibility default and accepts any supported value, case-insensitively', () => {
    expect(checkProtocolVersionHeader(undefined)).toEqual({ ok: true, version: '2025-03-26' });
    expect(checkProtocolVersionHeader({})).toEqual({ ok: true, version: '2025-03-26' });
    expect(checkProtocolVersionHeader({ 'mcp-protocol-version': '2025-06-18' })).toEqual({ ok: true, version: '2025-06-18' });
    expect(checkProtocolVersionHeader({ 'MCP-Protocol-Version': ' 2025-03-26 ' })).toEqual({ ok: true, version: '2025-03-26' });
    expect(checkProtocolVersionHeader({ 'mcp-protocol-version': '2024-11-05' })).toEqual({ ok: false, received: '2024-11-05' });
  });

  const deps: RouteDeps = { oauth: null, credentials: () => null, poolClients: () => ({}) as never };
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    route({ rawPath: '/mcp', requestContext: { http: { method: 'POST' } }, headers, body: JSON.stringify(body) }, deps);

  it('unsupported: a later request with an unknown version is 400 with a JSON-RPC error that lists the supported set', async () => {
    const res = await post({ jsonrpc: '2.0', id: 7, method: 'tools/list' }, { 'mcp-protocol-version': '2024-11-05' });
    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toEqual({
      jsonrpc: '2.0',
      id: 7,
      error: {
        code: -32600,
        message: 'unsupported MCP-Protocol-Version "2024-11-05"; this server supports 2025-06-18, 2025-03-26',
        data: { supportedProtocolVersions: ['2025-06-18', '2025-03-26'] },
      },
    });
  });

  it('a supported or absent header reaches the method', async () => {
    const withHeader = await post({ jsonrpc: '2.0', id: 1, method: 'ping' }, { 'MCP-Protocol-Version': '2025-06-18' });
    const without = await post({ jsonrpc: '2.0', id: 2, method: 'ping' });
    expect(withHeader.statusCode).toBe(200);
    expect(JSON.parse(withHeader.body)).toEqual({ jsonrpc: '2.0', id: 1, result: {} });
    expect(without.statusCode).toBe(200);
  });

  it('initialize negotiates through its params; a header on it is not what decides', async () => {
    const res = await post(
      { jsonrpc: '2.0', id: 3, method: 'initialize', params: { protocolVersion: '2026-07-28' } },
      { 'mcp-protocol-version': '2026-07-28' },
    );
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body).result.protocolVersion).toBe('2025-06-18');
  });
});
