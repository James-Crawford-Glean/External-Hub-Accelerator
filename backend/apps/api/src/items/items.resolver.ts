// Example domain: items. Reads are visibility-scoped by the caller's roster
// role; writes need write access (admin or EDITOR). Every mutation returns the
// full row so the SPA updates without a follow-up query.
//
// Two write paths exist on purpose. A person in the SPA creates ACTIVE rows.
// An assistant (the MCP createItem tool) creates DRAFT rows, which stay out of
// every default read until a writer approves (-> ACTIVE) or rejects
// (-> REJECTED) them here. That second, server-side gate is the guardrail; the
// host's confirmation panel is a courtesy.
import { AuroraService } from '@libs/aurora';
import { AuthzService, type Identity } from '@libs/authz';
import { IdentityService } from '@libs/identity';
import { ItemsService, type ItemFilter, type ItemInput, type ItemRow } from '@libs/items';

export interface Item {
  id: string;
  externalId: string | null;
  name: string;
  category: string | null;
  status: string;
  description: string | null;
  /** Domain; the SPA resolves a logo through fetchLogos. */
  website: string | null;
  owner: { id: string; email: string; name: string } | null;
  visibilityRole: string | null;
  source: string | null;
  syncedAt: string | null;
  indexedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export class ItemsResolver {
  constructor(
    private readonly svc: ItemsService,
    private readonly authz: AuthzService,
    private readonly identity: IdentityService,
    private readonly aurora: AuroraService,
  ) {}

  async items(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<{ items: Item[]; total: number }> {
    this.authz.requireRead(identity);
    const vis = await this.authz.visibilityFor(identity);
    const filter = (args.filter as ItemFilter | undefined) ?? {};
    const res = await this.svc.list({ ...filter, limit: args.limit as number, offset: args.offset as number }, vis);
    return { items: res.items.map((r) => this.shape(r)), total: res.total };
  }

  async item(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<Item | null> {
    this.authz.requireRead(identity);
    const vis = await this.authz.visibilityFor(identity);
    const row = await this.svc.byId(String(args.id ?? ''), vis);
    return row ? this.shape(row) : null;
  }

  async itemCategories(_args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<string[]> {
    this.authz.requireRead(identity);
    return this.svc.categories(await this.authz.visibilityFor(identity));
  }

  async createItem(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<Item> {
    await this.authz.requireWrite(identity);
    const input = (args.input as ItemInput) ?? {};
    const ownerUserId = input.ownerUserId ?? (await this.identity.callerId(identity));
    return this.shape(await this.svc.create({ ...input, ownerUserId, status: 'ACTIVE' }, 'app'));
  }

  /** The assistant path: the row lands as DRAFT, owned by the acting user, and
   *  a notification points them at it for review. Idempotent on acting user +
   *  name: a retried call returns the pending draft it already made
   *  (`created: false`) instead of drafting twice. */
  async draftItem(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<{ item: Item; created: boolean }> {
    await this.authz.requireWrite(identity);
    const input = (args.input as ItemInput) ?? {};
    const ownerUserId = await this.identity.callerId(identity);
    const name = (input.name ?? '').trim();
    if (!name) throw new Error('name is required');
    const existing = await this.svc.pendingDraft(ownerUserId, name);
    if (existing) return { item: this.shape(existing), created: false };
    const row = await this.insertDraft({ ...input, name, ownerUserId });
    if (!row.created) return { item: this.shape(row.row), created: false };
    const email = this.identity.callerEmail(identity);
    if (email) {
      await this.aurora.execute(
        'INSERT INTO app.notifications (id, recipient_email, kind, title, body, href, source_id) ' +
          "VALUES (:id, :email, 'item_draft', :title, :body, :href, :source) " +
          'ON CONFLICT (recipient_email, kind, source_id) DO NOTHING',
        {
          id: `ntf_${row.row.id.slice(4)}`,
          email,
          title: `Review draft: ${row.row.name}`,
          body: 'Created by an assistant on your behalf. Approve to publish or reject to discard.',
          href: `/items/${row.row.id}`,
          source: row.row.id,
        },
      );
    }
    return { item: this.shape(row.row), created: true };
  }

  /** Insert the DRAFT; if a concurrent retry raced past the lookup, the partial
   *  unique index lets exactly one through and the loser returns the winner. */
  private async insertDraft(input: ItemInput & { name: string; ownerUserId: string }): Promise<{ row: ItemRow; created: boolean }> {
    try {
      return { row: await this.svc.create({ ...input, status: 'DRAFT' }, 'mcp'), created: true };
    } catch (e) {
      const raced = /duplicate key|unique/i.test(e instanceof Error ? e.message : '') ? await this.svc.pendingDraft(input.ownerUserId, input.name) : null;
      if (!raced) throw e;
      return { row: raced, created: false };
    }
  }

  async approveItem(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<Item> {
    return this.review(String(args.id ?? ''), 'ACTIVE', identity);
  }

  async rejectItem(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<Item> {
    return this.review(String(args.id ?? ''), 'REJECTED', identity);
  }

  private async review(id: string, decision: 'ACTIVE' | 'REJECTED', identity: Identity): Promise<Item> {
    await this.authz.requireWrite(identity);
    await this.requireAccess(id, identity);
    const row = await this.svc.review(id, decision, {
      id: await this.identity.callerId(identity),
      email: this.identity.callerEmail(identity),
    });
    if (!row) throw new Error('item not found');
    return this.shape(row);
  }

  async updateItem(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<Item> {
    await this.authz.requireWrite(identity);
    const id = String(args.id ?? '');
    await this.requireAccess(id, identity);
    const row = await this.svc.update(id, (args.input as ItemInput) ?? {});
    if (!row) throw new Error('item not found');
    return this.shape(row);
  }

  async archiveItem(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<Item> {
    await this.authz.requireWrite(identity);
    const id = String(args.id ?? '');
    await this.requireAccess(id, identity);
    const row = await this.svc.update(id, { status: 'ARCHIVED' });
    if (!row) throw new Error('item not found');
    return this.shape(row);
  }

  private async requireAccess(id: string, identity: Identity): Promise<void> {
    const vis = await this.authz.visibilityFor(identity);
    const row = await this.svc.byId(id, { role: null, isAdmin: true });
    if (!row) throw new Error('item not found');
    if (!this.authz.canAccess(vis, row.visibility_role)) throw new Error('not authorized: this item is restricted');
  }

  private shape(r: ItemRow): Item {
    return {
      id: r.id,
      externalId: r.external_id,
      name: r.name,
      category: r.category,
      status: r.status,
      description: r.description,
      website: r.website,
      owner: r.owner_user_id && r.owner_email ? { id: r.owner_user_id, email: r.owner_email, name: r.owner_name || r.owner_email } : null,
      visibilityRole: r.visibility_role,
      source: r.source,
      syncedAt: r.synced_at,
      indexedAt: r.indexed_at,
      reviewedAt: r.reviewed_at,
      reviewedBy: r.reviewed_by_email,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    };
  }
}
