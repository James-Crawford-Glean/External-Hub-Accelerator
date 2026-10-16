// The server-side write guardrail for assistant-initiated creates, end to end
// over the real migrations: the MCP createItem tool writes a DRAFT the default
// read hides; a writer approves or rejects it; the state machine admits only
// DRAFT -> ACTIVE and DRAFT -> REJECTED; the indexer never ships a draft.
import { pgAurora, type PgAurora } from '@libs/testkit';
import { AuthzService } from '@libs/authz';
import { IdentityService } from '@libs/identity';
import { ItemsService } from '@libs/items';
import { RosterService } from '@libs/roster';
import { SyncRunsService } from '@libs/sync-runs';
import { GleanIndexClient } from '@libs/glean-index';
import { ItemsResolver } from './items.resolver';
import { setAuroraForLocal } from '../../../mcp/src/container';
import { handleRpc } from '../../../mcp/src/mcp/server';
import { TOOLS } from '../../../mcp/src/mcp/tools';
import { pushItems } from '../../../workers/glean-index/src/lambda';

describe('items: DRAFT -> review state machine', () => {
  let pg: PgAurora;
  let items: ItemsService;
  let resolver: ItemsResolver;

  const admin = { sub: 'sub-admin', email: 'admin@example.com', name: 'Ada Admin' };
  const editor = { kind: 'user', sub: 'sub-editor', email: 'ed@example.com', name: 'Ed Editor' };
  const viewer = { sub: 'sub-viewer', email: 'viewer@example.com', name: 'Vic Viewer' };
  const serviceKey = { kind: 'apiKey', keyId: 'apk_1', scopes: 'read,write' };

  beforeAll(async () => {
    pg = await pgAurora();
    setAuroraForLocal(pg.aurora);
    await pg.exec(
      "INSERT INTO app.access_roster (email, role, is_admin) VALUES " +
        "('admin@example.com','ADMINISTRATOR',true), ('ed@example.com','EDITOR',false), ('viewer@example.com','VIEWER',false)",
    );
    const identity = new IdentityService(pg.aurora);
    const authz = new AuthzService(new RosterService(pg.aurora));
    items = new ItemsService(pg.aurora);
    resolver = new ItemsResolver(items, authz, identity, pg.aurora);
  });
  afterAll(() => pg.close());

  const call = (name: string, args: Record<string, unknown>, identity: Record<string, unknown>) =>
    handleRpc({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name, arguments: args } }, { identity });

  let draftId: string;

  it('the MCP createItem tool writes a DRAFT owned by the acting user and notifies them', async () => {
    const res = await call('createItem', { name: 'Draft Widget', category: 'Supplier' }, editor);
    const result = res?.result as { isError?: boolean; structuredContent: { record: { id: string; status: string; owner: { email: string } } } };
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent.record.status).toBe('DRAFT');
    expect(result.structuredContent.record.owner.email).toBe('ed@example.com');
    draftId = result.structuredContent.record.id;

    const notes = await pg.aurora.query<{ recipient_email: string; kind: string; href: string }>('SELECT recipient_email, kind, href FROM app.notifications');
    expect(notes).toEqual([{ recipient_email: 'ed@example.com', kind: 'item_draft', href: `/items/${draftId}` }]);
  });

  it('a retried createItem is idempotent on acting user + name: same draft back, no second row or notification', async () => {
    const res = await call('createItem', { name: '  draft widget ', category: 'Changed on retry' }, editor);
    const result = res?.result as { isError?: boolean; content: Array<{ text: string }>; structuredContent: { record: { id: string }; idempotent: boolean } };
    expect(result.isError).toBeFalsy();
    expect(result.structuredContent).toMatchObject({ record: { id: draftId }, status: 'DRAFT', idempotent: true });
    expect(result.content[0]!.text).toMatch(/^Already drafted \(idempotent\)/);
    expect(await pg.aurora.query("SELECT id FROM example.items WHERE lower(name) = 'draft widget'")).toHaveLength(1);
    expect(await pg.aurora.query("SELECT id FROM app.notifications WHERE kind = 'item_draft'")).toHaveLength(1);
  });

  it('the idempotency key is per acting user: another writer drafting the same name gets their own draft', async () => {
    const res = await call('createItem', { name: 'Draft Widget' }, admin);
    const result = res?.result as { structuredContent: { record: { id: string; owner: { email: string } }; idempotent: boolean } };
    expect(result.structuredContent.idempotent).toBe(false);
    expect(result.structuredContent.record.id).not.toBe(draftId);
    expect(result.structuredContent.record.owner.email).toBe('admin@example.com');
    await pg.exec(`DELETE FROM example.items WHERE id = '${result.structuredContent.record.id}'`);
    await pg.exec(`DELETE FROM app.notifications WHERE source_id = '${result.structuredContent.record.id}'`);
  });

  it('two retries racing past the lookup cannot both insert: the partial unique index lets one through', async () => {
    const [a, b] = await Promise.all([
      call('createItem', { name: 'Raced Draft' }, editor),
      call('createItem', { name: 'raced draft' }, editor),
    ]);
    const ids = [a, b].map((r) => (r?.result as { isError?: boolean; structuredContent: { record: { id: string } } }));
    expect(ids.every((r) => !r.isError)).toBe(true);
    expect(new Set(ids.map((r) => r.structuredContent.record.id)).size).toBe(1);
    expect(await pg.aurora.query("SELECT id FROM example.items WHERE lower(name) = 'raced draft'")).toHaveLength(1);
    await pg.exec("DELETE FROM app.notifications WHERE source_id IN (SELECT id FROM example.items WHERE lower(name) = 'raced draft')");
    await pg.exec("DELETE FROM example.items WHERE lower(name) = 'raced draft'");
  });

  it('a service key with no acting user cannot create a draft', async () => {
    const res = await call('createItem', { name: 'Orphan' }, serviceKey);
    const result = res?.result as { isError?: boolean; content: Array<{ text: string }> };
    expect(result.isError).toBe(true);
    expect(result.content[0]!.text).toContain('currentUserEmail is required');
    expect(await pg.aurora.query("SELECT 1 FROM example.items WHERE name = 'Orphan'")).toEqual([]);
  });

  it('a service key with currentUserEmail creates the draft under that user', async () => {
    const res = await call('createItem', { name: 'Keyed Draft', currentUserEmail: 'ed@example.com' }, serviceKey);
    const result = res?.result as { structuredContent: { record: { status: string; owner: { email: string } } } };
    expect(result.structuredContent.record).toMatchObject({ status: 'DRAFT', owner: { email: 'ed@example.com' } });
  });

  it('drafts are hidden from default reads and visible only through draftsOnly or an explicit status', async () => {
    expect((await resolver.items({}, null, admin)).items.map((i) => i.name)).not.toContain('Draft Widget');
    expect((await resolver.items({ filter: { draftsOnly: true } }, null, admin)).items.map((i) => i.name)).toEqual(
      expect.arrayContaining(['Draft Widget', 'Keyed Draft']),
    );
    expect((await resolver.items({ filter: { status: ['DRAFT'] } }, null, editor)).total).toBe(2);
    // searchItems reuses the resolver, so the assistant cannot read back unpublished drafts either.
    const total = (r: Awaited<ReturnType<typeof call>>) => (r?.result as { structuredContent: { total: number } }).structuredContent.total;
    expect(total(await call('searchItems', { search: 'draft widget' }, editor))).toBe(0);
    // Naming the status is stopped at the protocol gate (DRAFT is outside the tool's inputSchema enum)...
    const gated = await call('searchItems', { search: 'draft widget', status: ['DRAFT'] }, editor);
    expect(gated?.error).toMatchObject({ code: -32602, data: { violations: ['status[0]: must be one of ACTIVE, ARCHIVED'] } });
    // ...and, as defense in depth, the handler clamps to live statuses even when called without the gate.
    const direct = await TOOLS.searchItems!.handler({ search: 'draft widget', status: ['DRAFT', 'ACTIVE', 'ARCHIVED'] }, { identity: editor });
    expect((direct.structuredContent as { total: number }).total).toBe(0);
  });

  it('a viewer cannot approve or reject', async () => {
    await expect(resolver.approveItem({ id: draftId }, null, viewer)).rejects.toThrow('requires write access');
    await expect(resolver.rejectItem({ id: draftId }, null, viewer)).rejects.toThrow('requires write access');
  });

  it('updateItem edits a draft in place but cannot move any row into or out of the review states', async () => {
    const edited = await resolver.updateItem({ id: draftId, input: { description: 'Edited while pending' } }, null, editor);
    expect(edited).toMatchObject({ status: 'DRAFT', description: 'Edited while pending' });
    // Publishing is review()'s job: a status edit on a non-live row is a no-op, so the audit cannot be skipped.
    const published = await resolver.updateItem({ id: draftId, input: { status: 'ACTIVE', description: 'Sneaky publish' } }, null, editor);
    expect(published).toMatchObject({ status: 'DRAFT', description: 'Edited while pending', reviewedAt: null });
    await expect(resolver.updateItem({ id: draftId, input: { status: 'DRAFT' } }, null, editor)).rejects.toThrow('status must be one of');
    await expect(resolver.updateItem({ id: draftId, input: { status: 'REJECTED' } }, null, editor)).rejects.toThrow('status must be one of');
  });

  it('approve: DRAFT -> ACTIVE with the review audit; the row then appears in default reads', async () => {
    const out = await resolver.approveItem({ id: draftId }, null, admin);
    expect(out).toMatchObject({ status: 'ACTIVE', reviewedBy: 'admin@example.com' });
    expect(out.reviewedAt).toBeTruthy();
    expect((await resolver.items({}, null, viewer)).items.map((i) => i.name)).toContain('Draft Widget');
  });

  it('approval releases the idempotency key: the same name can be drafted again as a new row', async () => {
    const res = await call('createItem', { name: 'Draft Widget' }, editor);
    const result = res?.result as { structuredContent: { record: { id: string; status: string }; idempotent: boolean } };
    expect(result.structuredContent).toMatchObject({ idempotent: false, record: { status: 'DRAFT' } });
    expect(result.structuredContent.record.id).not.toBe(draftId);
    await pg.exec(`DELETE FROM app.notifications WHERE source_id = '${result.structuredContent.record.id}'`);
    await pg.exec(`DELETE FROM example.items WHERE id = '${result.structuredContent.record.id}'`);
  });

  it('a second approve, or a reject after approve, is a no-op: only DRAFT rows change', async () => {
    const again = await resolver.approveItem({ id: draftId }, null, admin);
    expect(again.status).toBe('ACTIVE');
    const rejected = await resolver.rejectItem({ id: draftId }, null, admin);
    expect(rejected.status).toBe('ACTIVE');
    expect(rejected.reviewedBy).toBe('admin@example.com');
  });

  it('reject: DRAFT -> REJECTED, hidden from default reads and from the review queue, kept for audit', async () => {
    const keyed = (await resolver.items({ filter: { draftsOnly: true } }, null, admin)).items.find((i) => i.name === 'Keyed Draft')!;
    const out = await resolver.rejectItem({ id: keyed.id }, null, editor);
    expect(out).toMatchObject({ status: 'REJECTED', reviewedBy: 'ed@example.com' });
    expect((await resolver.items({}, null, admin)).items.map((i) => i.name)).not.toContain('Keyed Draft');
    expect((await resolver.items({ filter: { draftsOnly: true } }, null, admin)).total).toBe(0);
    expect((await resolver.items({ filter: { status: ['REJECTED'] } }, null, admin)).total).toBe(1);
    // Approving a rejected row does nothing.
    expect((await resolver.approveItem({ id: keyed.id }, null, admin)).status).toBe('REJECTED');
  });

  it('the indexer ships live rows only and removes a rejected one', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    const client = new GleanIndexClient({ origin: 'https://tenant-be.example.net', datasource: 'd', token: async () => 't', fetchImpl });
    const cfg = { datasource: 'd', displayName: 'P', portalUrl: 'https://p.example' };
    const runs = new SyncRunsService(pg.aurora);

    // One more draft that stays unreviewed.
    await call('createItem', { name: 'Still Draft' }, editor);

    const full = await pushItems({ items, runs, client, cfg, lastSuccess: async () => null }, { full: true });
    const bulk = calls.find((c) => c.url.endsWith('/bulkindexdocuments'))!.body as { documents: Array<{ title: string }> };
    expect(full.indexed).toBe(1);
    expect(bulk.documents.map((d) => d.title)).toEqual(['Draft Widget']);

    calls.length = 0;
    const inc = await pushItems({ items, runs, client, cfg, lastSuccess: async () => '2000-01-01T00:00:00Z' });
    const deletes = calls.filter((c) => c.url.endsWith('/deletedocument'));
    expect(inc.indexed).toBe(1);
    expect(deletes).toHaveLength(2); // the rejected row and the unreviewed draft
    expect(calls.filter((c) => c.url.endsWith('/indexdocument'))).toHaveLength(1);
  });
});
