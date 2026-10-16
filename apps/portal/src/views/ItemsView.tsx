// Example domain: the items list. Search, status and category filters,
// pagination, logos resolved through the logo cache, and a create dialog for
// callers with write access. Writers also get the review queue (DRAFT rows the
// MCP server created) as a status option. Replace with your domain's list.
import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { SearchInput } from '../components/ui/SearchInput';
import { Spinner } from '../components/ui/Spinner';
import { ItemDialog } from '../components/items/ItemDialog';
import { ItemLogo } from '../components/items/ItemLogo';
import { useCurrentUser } from '../data/useCurrentUser';
import type { Item, ItemStatus } from '../data/types';
import { fetchItemCategories, fetchItems } from '../lib/api/items';
import { fetchLogos } from '../lib/api/logos';
import { useAsyncData } from '../lib/api/useAsyncData';
import { canWrite } from '../lib/capabilities';
import { formatDate, statusTone } from '../lib/labels';

const LIVE_STATUSES: Array<{ value: ItemStatus; label: string }> = [
  { value: 'ACTIVE', label: 'Active' },
  { value: 'ARCHIVED', label: 'Archived' },
];
const REVIEW_STATUSES: Array<{ value: ItemStatus; label: string }> = [
  { value: 'DRAFT', label: 'Drafts awaiting review' },
  { value: 'REJECTED', label: 'Rejected' },
];

export function ItemsView() {
  const me = useCurrentUser();
  const writable = canWrite(me);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ItemStatus | ''>('ACTIVE');
  const [category, setCategory] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [creating, setCreating] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);

  const filter = useMemo(
    () => ({
      search,
      draftsOnly: status === 'DRAFT' || undefined,
      status: status && status !== 'DRAFT' ? [status] : undefined,
      category: category ? [category] : undefined,
    }),
    [search, status, category],
  );
  const { data, loading, error } = useAsyncData(
    () => fetchItems(filter, pageSize, (page - 1) * pageSize),
    [filter, page, pageSize, refreshKey],
    { items: [] as Item[], total: 0 },
  );
  const categories = useAsyncData(fetchItemCategories, [refreshKey], [] as string[]);
  const logos = useLogos(data.items.map((i) => i.website));

  return (
    <div>
      <header className="ps-page__header">
        <div>
          <h1 className="ps-page-title">Items</h1>
          <p className="ps-page-subtitle">
            The example domain: records synced from an upstream system and edited here, visible in Glean through the MCP
            server and the indexing push.
          </p>
        </div>
        {writable && (
          <Button variant="primary" iconLeft={<Plus size={14} />} onClick={() => setCreating(true)}>
            New item
          </Button>
        )}
      </header>

      <div className="ps-row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <SearchInput placeholder="Search name, description, website…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ minWidth: 280 }} />
        <select className="ps-select" value={status} onChange={(e) => { setStatus(e.target.value as ItemStatus | ''); setPage(1); }} aria-label="Status">
          <option value="">Any live status</option>
          {LIVE_STATUSES.map((s) => (
            <option key={s.value} value={s.value}>
              {s.label}
            </option>
          ))}
          {writable &&
            REVIEW_STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
        </select>
        <select className="ps-select" value={category} onChange={(e) => { setCategory(e.target.value); setPage(1); }} aria-label="Category">
          <option value="">Any category</option>
          {categories.data.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <Card>
        <CardBody flush>
          {loading && data.items.length === 0 ? (
            <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
              <Spinner />
            </div>
          ) : error ? (
            <EmptyState title="Couldn't load items" body={error} />
          ) : data.items.length === 0 ? (
            status === 'DRAFT' ? (
              <EmptyState title="Nothing to review" body="Items the MCP server creates on a user's behalf land here as drafts until a writer approves or rejects them." />
            ) : (
              <EmptyState title="No items" body="Nothing matches these filters. The item-sync worker populates this list from the upstream system." />
            )
          ) : (
            <table className="ps-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Category</th>
                  <th>Status</th>
                  <th>Owner</th>
                  <th>Updated</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((item) => (
                  <tr key={item.id}>
                    <td>
                      <Link to={`/items/${item.id}`} className="ps-row" style={{ gap: 10, color: 'inherit' }}>
                        <ItemLogo name={item.name} url={logos.get(item.website ?? '') ?? null} />
                        <span>
                          <span style={{ display: 'block', fontWeight: 600 }}>{item.name}</span>
                          {item.website && <span className="ps-text-subtle" style={{ fontSize: 12 }}>{item.website}</span>}
                        </span>
                      </Link>
                    </td>
                    <td>{item.category ?? '—'}</td>
                    <td>
                      <Badge tone={statusTone(item.status)}>{item.status}</Badge>
                    </td>
                    <td>{item.owner?.name ?? '—'}</td>
                    <td className="ps-text-subtle">{formatDate(item.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      <Pagination
        page={page}
        pageSize={pageSize}
        totalItems={data.total}
        onPageChange={setPage}
        onPageSizeChange={(n) => { setPageSize(n); setPage(1); }}
        itemNoun="items"
      />

      <ItemDialog
        key={String(creating)}
        open={creating}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          setRefreshKey((k) => k + 1);
        }}
      />
    </div>
  );
}

/** Resolve logos for the visible rows through the logo cache; failures degrade to initials. */
function useLogos(domains: Array<string | null>): Map<string, string | null> {
  const key = domains.filter(Boolean).join(',');
  const { data } = useAsyncData(
    key ? () => fetchLogos(key.split(',')) : null,
    [key],
    new Map<string, string | null>(),
  );
  return data;
}
