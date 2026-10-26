// The real MCP server + platform tools against embedded Postgres: initialize,
// tools/list, and a tools/call round trip with the provenance envelope.
import { pgAurora, type PgAurora } from '@libs/testkit';
import { setAuroraForLocal } from '../container';
import { handleRpc } from './server';
import { TOOLS } from './tools';

describe('MCP server end to end (pglite)', () => {
  let pg: PgAurora;
  beforeAll(async () => {
    pg = await pgAurora();
    setAuroraForLocal(pg.aurora);
    await pg.exec("INSERT INTO app.access_roster (email, role, is_admin) VALUES ('ops@example.com', 'EDITOR', false)");
    await pg.exec("INSERT INTO app.access_roster (email, role, is_admin) VALUES ('viewer@example.com', 'VIEWER', false)");
    await pg.exec("INSERT INTO app.users (id, email, name, title) VALUES ('usr_00000000000001', 'ops@example.com', 'Ola Ops', 'Operations')");
  });
  afterAll(() => pg.close());

  const user = { kind: 'user', email: 'ops@example.com', sub: 'sub-ops' };
  const viewer = { kind: 'user', email: 'viewer@example.com', sub: 'sub-viewer' };
  const readKey = { kind: 'apiKey', keyId: 'apk_read', scopes: 'read', email: null, sub: null };
  const writeKey = { kind: 'apiKey', keyId: 'apk_write', scopes: 'read,write', email: null, sub: null };

  const catalogFor = async (identity: Record<string, unknown>, id: number) => {
    const res = await handleRpc({ jsonrpc: '2.0', id, method: 'tools/list' }, { identity });
    return (res?.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name).sort();
  };

  it('initialize advertises tools and the server description', async () => {
    const res = await handleRpc({ jsonrpc: '2.0', id: 1, method: 'initialize' }, { identity: user });
    expect(res?.result).toMatchObject({ capabilities: { tools: { listChanged: false } } });
    expect(typeof (res?.result as { instructions: string }).instructions).toBe('string');
  });

  it('tools/list includes the platform tools with annotations', async () => {
    const res = await handleRpc({ jsonrpc: '2.0', id: 2, method: 'tools/list' }, { identity: user });
    const tools = (res?.result as { tools: Array<{ name: string; annotations: { readOnlyHint: boolean } }> }).tools;
    expect(tools.map((t) => t.name)).toEqual(expect.arrayContaining(['whoAmI', 'listUsers']));
    expect(tools.every((t) => typeof t.annotations.readOnlyHint === 'boolean')).toBe(true);
  });

  it('tools/list matches the caller: an editor sees every tool, a viewer and a read-scoped key see reads only', async () => {
    const all = Object.keys(TOOLS).sort();
    const reads = all.filter((n) => TOOLS[n]?.annotations.readOnlyHint);
    expect(await catalogFor(user, 20)).toEqual(all);
    expect(await catalogFor(viewer, 21)).toEqual(reads);
    expect(await catalogFor(readKey, 22)).toEqual(reads);
    expect(await catalogFor(writeKey, 23)).toEqual(all);
  });

  it('whoAmI resolves the roster role and write capability', async () => {
    const res = await handleRpc(
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'whoAmI', arguments: {} } },
      { identity: user },
    );
    const result = res?.result as { structuredContent: Record<string, unknown>; _meta: { portal: { status: string } } };
    expect(result.structuredContent).toMatchObject({ kind: 'user', email: 'ops@example.com', role: 'EDITOR', canWrite: true });
    expect(result._meta.portal.status).toBe('success');
  });

  it('listUsers returns registry rows with the coverage envelope', async () => {
    const res = await handleRpc(
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'listUsers', arguments: { search: 'ola' } } },
      { identity: user },
    );
    const result = res?.result as { structuredContent: { total: number; rows: unknown[] }; _meta: { portal: Record<string, unknown> } };
    expect(result.structuredContent.total).toBe(1);
    expect(result._meta.portal).toMatchObject({ status: 'success', matches: 1, coverage: { complete: true, returned: 1, total: 1 } });
  });

  it('an unknown tool is an InvalidParams error, not a result', async () => {
    const res = await handleRpc({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'nope' } }, { identity: user });
    expect(res?.error?.code).toBe(-32602);
  });
});
