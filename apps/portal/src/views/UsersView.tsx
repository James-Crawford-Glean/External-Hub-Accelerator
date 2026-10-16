// People: the user registry (everyone who has signed in or been referenced),
// with their roster role where they have one.
import { useEffect, useState } from 'react';
import { Avatar } from '../components/ui/Avatar';
import { Badge } from '../components/ui/Badge';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { SearchInput } from '../components/ui/SearchInput';
import { Spinner } from '../components/ui/Spinner';
import type { User } from '../data/types';
import { fetchUsers } from '../lib/api/identity';
import { useAsyncData } from '../lib/api/useAsyncData';
import { roleLabel } from '../lib/labels';

export function UsersView() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, loading, error } = useAsyncData(
    () => fetchUsers(debounced, pageSize, (page - 1) * pageSize),
    [debounced, page, pageSize],
    { items: [] as User[], total: 0 },
  );

  return (
    <div>
      <header className="ps-page__header">
        <div>
          <h1 className="ps-page-title">People</h1>
          <p className="ps-page-subtitle">
            Everyone the portal knows about, keyed by email to a stable internal id. Roles come from the access roster.
          </p>
        </div>
      </header>
      <div className="ps-row" style={{ gap: 10, marginBottom: 16 }}>
        <SearchInput placeholder="Search name or email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ minWidth: 280 }} />
      </div>
      <Card>
        <CardBody flush>
          {loading && data.items.length === 0 ? (
            <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
              <Spinner />
            </div>
          ) : error ? (
            <EmptyState title="Couldn't load people" body={error} />
          ) : data.items.length === 0 ? (
            <EmptyState title="No people yet" body="Users appear here after their first sign-in or when a sync references them." />
          ) : (
            <table className="ps-table">
              <thead>
                <tr>
                  <th>Person</th>
                  <th>Title</th>
                  <th>Role</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      <span className="ps-row" style={{ gap: 10 }}>
                        <Avatar name={u.name} initials={u.initials} size="sm" image={u.avatarUrl} />
                        <span>
                          <span style={{ display: 'block', fontWeight: 600 }}>{u.name}</span>
                          <span className="ps-text-subtle" style={{ fontSize: 12 }}>{u.email}</span>
                        </span>
                      </span>
                    </td>
                    <td className="ps-text-subtle">{u.title ?? '—'}</td>
                    <td>
                      {u.role ? (
                        <span className="ps-row" style={{ gap: 6 }}>
                          <Badge tone={u.isAdmin ? 'brand' : 'neutral'}>{roleLabel(u.role)}</Badge>
                          {u.isAdmin && <Badge tone="outline">Admin</Badge>}
                        </span>
                      ) : (
                        <span className="ps-text-subtle">No access</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      <Pagination page={page} pageSize={pageSize} totalItems={data.total} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} itemNoun="people" />
    </div>
  );
}
