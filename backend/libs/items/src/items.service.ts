// The example domain's data access: list/detail with filters and row-level
// visibility, writes, and the upsert the sync worker uses. Replace this file
// with your domain's service; the resolver, worker, and MCP tools above it
// only touch this surface.
import { randomBytes } from 'node:crypto';
import { AuroraService } from '@libs/aurora';
import { visibilitySql, type Visibility } from '@libs/authz';
import { bind, inClause, paginate, type Params } from '@libs/sql';

export const ITEM_STATUSES = ['DRAFT', 'ACTIVE', 'ARCHIVED', 'REJECTED'] as const;
/** Statuses the default read returns; DRAFT and REJECTED need an explicit filter. */
export const LIVE_STATUSES: readonly ItemStatus[] = ['ACTIVE', 'ARCHIVED'];
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export interface ItemRow {
  id: string;
  external_id: string | null;
  name: string;
  category: string | null;
  status: ItemStatus;
  description: string | null;
  website: string | null;
  owner_user_id: string | null;
  owner_email: string | null;
  owner_name: string | null;
  visibility_role: string | null;
  source: string | null;
  synced_at: string | null;
  indexed_at: string | null;
  reviewed_at: string | null;
  reviewed_by_id: string | null;
  reviewed_by_email: string | null;
  created_at: string;
  updated_at: string;
  total?: number;
}

export interface ItemFilter {
  search?: string | null;
  status?: ItemStatus[] | null;
  category?: string[] | null;
  ownerId?: string | null;
  /** Only DRAFT rows (the review queue). Overrides `status`. */
  draftsOnly?: boolean | null;
  limit?: number | null;
  offset?: number | null;
}

export interface ItemInput {
  name?: string;
  category?: string | null;
  description?: string | null;
  website?: string | null;
  ownerUserId?: string | null;
  visibilityRole?: string | null;
  status?: ItemStatus;
}

/** An upstream record as the sync worker sees it. */
export interface UpstreamItem {
  externalId: string;
  name: string;
  category?: string | null;
  description?: string | null;
  website?: string | null;
  ownerEmail?: string | null;
  archived?: boolean;
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
export function genItemId(): string {
  let out = '';
  while (out.length < 14) for (const b of randomBytes(28)) if (b < 248 && out.length < 14) out += ALPHABET[b % 62];
  return `itm_${out}`;
}

const SELECT =
  'SELECT i.id, i.external_id, i.name, i.category, i.status, i.description, i.website, i.owner_user_id, ' +
  'u.email AS owner_email, u.name AS owner_name, i.visibility_role, i.source, i.synced_at, i.indexed_at, ' +
  'i.reviewed_at, i.reviewed_by_id, i.reviewed_by_email, i.created_at, i.updated_at';
const FROM = 'FROM example.items i LEFT JOIN app.users u ON u.id = i.owner_user_id';

const INPUT_COLUMNS: Record<string, string> = {
  name: 'name',
  category: 'category',
  description: 'description',
  website: 'website',
  ownerUserId: 'owner_user_id',
  visibilityRole: 'visibility_role',
  status: 'status',
};

export class ItemsService {
  constructor(private readonly aurora: AuroraService) {}

  async list(filter: ItemFilter, vis: Visibility): Promise<{ items: ItemRow[]; total: number }> {
    const params: Params = {};
    const where = [visibilitySql(vis, 'i.visibility_role')];
    const search = (filter.search ?? '').trim().toLowerCase();
    if (search) {
      params.q = `%${search}%`;
      where.push('(lower(i.name) LIKE :q OR lower(coalesce(i.description, \'\')) LIKE :q OR lower(coalesce(i.website, \'\')) LIKE :q)');
    }
    // Drafts and rejected rows never leak into a default list: the caller opts
    // in with draftsOnly (the review queue) or by naming the status explicitly.
    if (filter.draftsOnly) where.push("i.status = 'DRAFT'");
    else if (filter.status?.length) where.push(inClause('i.status', filter.status, params, 'st'));
    else where.push(inClause('i.status', [...LIVE_STATUSES], params, 'st'));
    if (filter.category?.length) where.push(inClause('i.category', filter.category, params, 'cat'));
    if (filter.ownerId) {
      params.owner = filter.ownerId;
      where.push('i.owner_user_id = :owner');
    }
    paginate(filter, params, { def: 50, maxLimit: 500 });
    const rows = await this.aurora.query<ItemRow>(
      `${SELECT}, count(*) OVER() AS total ${FROM} WHERE ${where.join(' AND ')} ` +
        'ORDER BY i.updated_at DESC, i.id LIMIT :lim OFFSET :off',
      params,
    );
    return { items: rows, total: Number(rows[0]?.total ?? 0) };
  }

  async byId(id: string, vis: Visibility): Promise<ItemRow | null> {
    const rows = await this.aurora.query<ItemRow>(
      `${SELECT} ${FROM} WHERE i.id = :id AND ${visibilitySql(vis, 'i.visibility_role')}`,
      { id },
    );
    return rows[0] ?? null;
  }

  /** The DRAFT this owner already has under this name, if any. Acting user +
   *  normalized name is the idempotency key for assistant-initiated creates, so
   *  a retried call finds its first draft instead of writing a second one. */
  async pendingDraft(ownerUserId: string, name: string): Promise<ItemRow | null> {
    const rows = await this.aurora.query<ItemRow>(
      `${SELECT} ${FROM} WHERE i.owner_user_id = :owner AND i.status = 'DRAFT' AND lower(i.name) = lower(:name) ` +
        'ORDER BY i.created_at DESC LIMIT 1',
      { owner: ownerUserId, name: name.trim() },
    );
    return rows[0] ?? null;
  }

  async categories(vis: Visibility): Promise<string[]> {
    const rows = await this.aurora.query<{ category: string }>(
      `SELECT DISTINCT i.category FROM example.items i WHERE i.category IS NOT NULL AND ${visibilitySql(vis, 'i.visibility_role')} ORDER BY 1`,
    );
    return rows.map((r) => r.category);
  }

  /** Flip a DRAFT to ACTIVE (approve) or REJECTED (reject), stamping the
   *  review audit. Only DRAFT rows change; any other status is a no-op, so a
   *  retried or stale approval cannot overwrite a later decision. */
  async review(id: string, decision: 'ACTIVE' | 'REJECTED', reviewer: { id: string; email: string | null }): Promise<ItemRow | null> {
    await this.aurora.execute(
      'UPDATE example.items SET status = :status, reviewed_at = now(), reviewed_by_id = :rid, reviewed_by_email = :remail, ' +
        "updated_at = now() WHERE id = :id AND status = 'DRAFT'",
      { id, status: decision, rid: reviewer.id, remail: reviewer.email },
    );
    return this.byId(id, { role: null, isAdmin: true });
  }

  async create(input: ItemInput, source: string): Promise<ItemRow> {
    const name = (input.name ?? '').trim();
    if (!name) throw new Error('name is required');
    const params: Params = { id: genItemId(), source };
    const pairs = bind({ ...input, name, status: input.status ?? 'ACTIVE' }, INPUT_COLUMNS, params);
    const cols = ['id', 'source', ...pairs.map(([c]) => c)];
    const vals = [':id', ':source', ...pairs.map(([, ph]) => ph)];
    const rows = await this.aurora.query<{ id: string }>(
      `INSERT INTO example.items (${cols.join(', ')}) VALUES (${vals.join(', ')}) RETURNING id`,
      params,
    );
    return (await this.byId(rows[0]!.id, { role: null, isAdmin: true }))!;
  }

  async update(id: string, input: ItemInput): Promise<ItemRow | null> {
    const params: Params = { id };
    const sets = bind({ ...input }, INPUT_COLUMNS, params).map(([c, ph]) => `${c} = ${ph}`);
    if (input.status && !LIVE_STATUSES.includes(input.status)) {
      throw new Error(`status must be one of ${LIVE_STATUSES.join(', ')}; drafts change state through review()`);
    }
    if (sets.length === 0) return this.byId(id, { role: null, isAdmin: true });
    // A status change only applies to a live row, so an in-place edit can never
    // publish a DRAFT or resurrect a REJECTED row around the review audit.
    const guard = input.status ? ` AND ${inClause('status', [...LIVE_STATUSES], params, 'live')}` : '';
    await this.aurora.execute(`UPDATE example.items SET ${sets.join(', ')}, updated_at = now() WHERE id = :id${guard}`, params);
    return this.byId(id, { role: null, isAdmin: true });
  }

  /** Sync-worker upsert keyed by external_id; app-owned fields (owner,
   *  visibility, description edits) are never clobbered by the upstream. */
  async upsertFromUpstream(items: UpstreamItem[], ownerIds: Map<string, string>): Promise<{ created: number; updated: number }> {
    let created = 0;
    let updated = 0;
    for (const u of items) {
      const owner = u.ownerEmail ? (ownerIds.get(u.ownerEmail.toLowerCase()) ?? null) : null;
      const rows = await this.aurora.query<{ inserted: boolean }>(
        'INSERT INTO example.items (id, external_id, name, category, description, website, owner_user_id, status, source, synced_at) ' +
          "VALUES (:id, :ext, :name, :category, :description, :website, :owner, :status, 'sync', now()) " +
          'ON CONFLICT (external_id) WHERE external_id IS NOT NULL DO UPDATE SET ' +
          'name = EXCLUDED.name, category = EXCLUDED.category, website = EXCLUDED.website, ' +
          'description = COALESCE(example.items.description, EXCLUDED.description), ' +
          'owner_user_id = COALESCE(example.items.owner_user_id, EXCLUDED.owner_user_id), ' +
          'status = EXCLUDED.status, synced_at = now(), updated_at = now() ' +
          'RETURNING (xmax = 0) AS inserted',
        {
          id: genItemId(),
          ext: u.externalId,
          name: u.name,
          category: u.category ?? null,
          description: u.description ?? null,
          website: u.website ?? null,
          owner,
          status: u.archived ? 'ARCHIVED' : 'ACTIVE',
        },
      );
      if (rows[0]?.inserted) created++;
      else updated++;
    }
    return { created, updated };
  }

  /** Rows changed since the last push (or all when `since` is null). */
  async changedSince(since: string | null): Promise<ItemRow[]> {
    return this.aurora.query<ItemRow>(
      `${SELECT} ${FROM} WHERE :since::timestamptz IS NULL OR i.updated_at > :since::timestamptz ORDER BY i.updated_at`,
      { since },
    );
  }

  async markIndexed(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const params: Params = {};
    await this.aurora.execute(`UPDATE example.items SET indexed_at = now() WHERE ${inClause('id', ids, params, 'i')}`, params);
  }
}
