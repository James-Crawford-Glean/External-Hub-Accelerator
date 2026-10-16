// The example domain end to end over the real migrations: upstream sync,
// owner resolution into the registry, visibility-scoped reads, role-gated
// in-place writes (requireWrite), the MCP tools, and the Glean Indexing push
// with permissions derived from visibility. The DRAFT -> review path lives in
// apps/api/src/items/items-review.integration.spec.ts.
import { pgAurora, type PgAurora } from '@libs/testkit';
import { AccessRequestsService } from '@libs/access-requests';
import { AuthzService } from '@libs/authz';
import { IdentityService } from '@libs/identity';
import { ItemsService } from '@libs/items';
import { RosterService } from '@libs/roster';
import { SyncRunsService } from '@libs/sync-runs';
import { GleanIndexClient } from '@libs/glean-index';
import type { AvatarService } from '@libs/avatar';
import { ItemsResolver } from '../../../api/src/items/items.resolver';
import { UsersResolver } from '../../../api/src/users/users.resolver';
import { pushItems, toDocument } from '../../glean-index/src/lambda';
import { syncItems } from './lambda';
import { FIXTURE } from './upstream';

describe('example domain: sync -> read/write -> MCP -> Glean index', () => {
  let pg: PgAurora;
  let items: ItemsService;
  let authz: AuthzService;
  let resolver: ItemsResolver;
  let runs: SyncRunsService;

  const admin = { sub: 'sub-admin', email: 'admin@example.com', name: 'Ada Admin' };
  const editor = { sub: 'sub-editor', email: 'owner.one@example.com', name: 'Owner One' };
  const viewer = { sub: 'sub-viewer', email: 'viewer@example.com', name: 'Vic Viewer' };

  beforeAll(async () => {
    pg = await pgAurora();
    await pg.exec(
      "INSERT INTO app.access_roster (email, role, is_admin) VALUES " +
        "('admin@example.com','ADMINISTRATOR',true), ('owner.one@example.com','EDITOR',false), ('viewer@example.com','VIEWER',false)",
    );
    const identity = new IdentityService(pg.aurora);
    const roster = new RosterService(pg.aurora);
    authz = new AuthzService(roster);
    items = new ItemsService(pg.aurora);
    runs = new SyncRunsService(pg.aurora);
    resolver = new ItemsResolver(items, authz, identity);
    // Platform users resolver exists alongside; proves the registry is shared.
    new UsersResolver(pg.aurora, authz, identity, roster, new AccessRequestsService(pg.aurora), {
      avatarUrlForEmail: async () => null,
    } as unknown as AvatarService);
    await syncItems({ items, identity, runs, upstream: async () => FIXTURE });
  });
  afterAll(() => pg.close());

  it('syncs the fixture, resolves owners into the registry, and records a run', async () => {
    const res = await resolver.items({}, null, admin);
    expect(res.total).toBe(FIXTURE.length);
    const northwind = res.items.find((i) => i.externalId === 'EX-1001')!;
    expect(northwind.owner?.email).toBe('owner.one@example.com');
    expect(northwind.owner?.id).toMatch(/^usr_/);
    expect(res.items.find((i) => i.externalId === 'EX-1005')?.status).toBe('ARCHIVED');
    const run = await pg.aurora.query<{ status: string; records_created: number }>(
      "SELECT status, records_created FROM app.sync_runs WHERE entity = 'items'",
    );
    expect(run).toEqual([{ status: 'success', records_created: FIXTURE.length }]);
  });

  it('a second sync updates rather than duplicates and keeps app-owned edits', async () => {
    const before = (await resolver.items({ filter: { search: 'northwind' } }, null, admin)).items[0]!;
    await resolver.updateItem({ id: before.id, input: { description: 'Edited in the portal' } }, null, editor);
    const upstream = FIXTURE.map((f) => (f.externalId === 'EX-1001' ? { ...f, name: 'Northwind Traders Ltd', description: 'upstream text' } : f));
    const identity = new IdentityService(pg.aurora);
    const out = await syncItems({ items, identity, runs, upstream: async () => upstream });
    expect(out).toEqual({ processed: 5, created: 0, updated: 5 });
    const after = (await resolver.item({ id: before.id }, null, admin))!;
    expect(after.name).toBe('Northwind Traders Ltd');
    expect(after.description).toBe('Edited in the portal');
  });

  it('viewers read but cannot write; editors write; restricted rows hide from other roles', async () => {
    const target = (await resolver.items({ filter: { search: 'contoso' } }, null, admin)).items[0]!;
    await expect(resolver.updateItem({ id: target.id, input: { category: 'x' } }, null, viewer)).rejects.toThrow('requires write access');
    await resolver.updateItem({ id: target.id, input: { visibilityRole: 'EDITOR' } }, null, admin);
    expect(await resolver.item({ id: target.id }, null, viewer)).toBeNull();
    expect((await resolver.item({ id: target.id }, null, editor))?.visibilityRole).toBe('EDITOR');
    expect((await resolver.items({}, null, viewer)).total).toBe(FIXTURE.length - 1);
  });

  it('createItem attributes ownership to the caller by default', async () => {
    const created = await resolver.createItem({ input: { name: 'Hand-entered', category: 'Supplier' } }, null, editor);
    expect(created.owner?.email).toBe('owner.one@example.com');
    expect(created.source).toBe('app');
    expect(created.externalId).toBeNull();
  });

  it('indexes into Glean with permissions derived from visibility and marks rows indexed', async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetchImpl = (async (url: string, init: RequestInit) => {
      calls.push({ url, body: JSON.parse(init.body as string) });
      return new Response('', { status: 200 });
    }) as unknown as typeof fetch;
    const cfg = { datasource: 'portal_items', displayName: 'Portal', portalUrl: 'https://example.portal.example.com/portal' };
    const client = new GleanIndexClient({ origin: 'https://tenant-be.example.net', datasource: 'portal_items', token: async () => 't', fetchImpl });

    const full = await pushItems({ items, runs, client, cfg, lastSuccess: async () => null }, { full: true });
    expect(full).toEqual({ indexed: 6, mode: 'full' });
    expect(calls[0]!.url).toContain('/adddatasource');
    const bulk = calls[1]!.body as { documents: Array<Record<string, unknown>> };
    const restricted = bulk.documents.find((d) => (d.title as string).startsWith('Contoso'))!;
    const open = bulk.documents.find((d) => (d.title as string).startsWith('Fabrikam'))!;
    // Role-restricted: Glean may show it to the owner only, never to every datasource user.
    expect(restricted.permissions).toEqual({ allowedUsers: [{ email: 'owner.two@example.com' }] });
    expect(open.permissions).toEqual({ allowAllDatasourceUsersAccess: true });
    expect(open.viewURL).toMatch(/^https:\/\/example\.portal\.example\.com\/portal\/items\/itm_/);
    const unindexed = await pg.aurora.query('SELECT 1 FROM example.items WHERE indexed_at IS NULL');
    expect(unindexed).toEqual([]);

    // Incremental: nothing changed since the full run.
    const since = (await pg.aurora.query<{ started_at: string }>("SELECT started_at FROM app.sync_runs WHERE entity='glean-index' ORDER BY started_at DESC LIMIT 1"))[0]!.started_at;
    const inc = await pushItems({ items, runs, client, cfg, lastSuccess: async () => since });
    expect(inc).toEqual({ indexed: 0, mode: 'incremental' });
  });

  it('toDocument indexes an ownerless restricted item for nobody', async () => {
    const row = (await items.list({ search: 'contoso' }, { role: null, isAdmin: true })).items[0]!;
    const doc = toDocument({ ...row, owner_email: null, owner_name: null }, { datasource: 'd', displayName: 'P', portalUrl: 'https://p.example' });
    expect(doc.permissions).toEqual({ allowedUsers: [] });
    expect(doc.body).toContain('Category: Carrier');
    expect(doc.customProperties).toEqual(expect.arrayContaining([{ name: 'status', value: 'ACTIVE' }]));
  });
});
