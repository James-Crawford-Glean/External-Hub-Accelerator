// Admin > Login activity: one row per completed interactive sign-in. Silent
// token renewals and reloads are not counted, so each row is a genuine
// re-authentication.
import { useEffect, useState } from 'react';
import { Card, CardBody } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { Pagination } from '../components/ui/Pagination';
import { SearchInput } from '../components/ui/SearchInput';
import { Spinner } from '../components/ui/Spinner';
import { useLoginActivity } from '../lib/api/useLoginActivity';
import { browserLabel, formatDate } from '../lib/labels';

function daysAgo(n: number): string {
  return new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);
}

function dayToIso(day: string, edge: 'start' | 'end'): string | undefined {
  if (!day) return undefined;
  const d = new Date(`${day}T${edge === 'start' ? '00:00:00.000' : '23:59:59.999'}`);
  return Number.isNaN(d.getTime()) ? undefined : d.toISOString();
}

export function LoginActivityView() {
  const [search, setSearch] = useState('');
  const [debounced, setDebounced] = useState('');
  const [from, setFrom] = useState(daysAgo(14));
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);

  useEffect(() => {
    const t = setTimeout(() => setDebounced(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data, loading, error } = useLoginActivity({
    search: debounced,
    from: dayToIso(from, 'start'),
    to: dayToIso(to, 'end'),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });

  return (
    <div>
      <header className="ps-page__header">
        <div>
          <h1 className="ps-page-title">Login activity</h1>
          <p className="ps-page-subtitle">
            One row per completed interactive sign-in. Use it to see how often someone re-authenticates; the browser
            column separates one device re-logging from many.
          </p>
        </div>
      </header>

      <div className="ps-row" style={{ gap: 10, flexWrap: 'wrap', marginBottom: 16 }}>
        <SearchInput placeholder="Filter by email…" value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} style={{ minWidth: 260 }} />
        <label className="ps-row" style={{ gap: 6, fontSize: 13 }}>
          <span className="ps-text-subtle">From</span>
          <input className="ps-input" type="date" value={from} onChange={(e) => { setFrom(e.target.value); setPage(1); }} />
        </label>
        <label className="ps-row" style={{ gap: 6, fontSize: 13 }}>
          <span className="ps-text-subtle">To</span>
          <input className="ps-input" type="date" value={to} onChange={(e) => { setTo(e.target.value); setPage(1); }} />
        </label>
      </div>

      <Card>
        <CardBody flush>
          {loading && data.items.length === 0 ? (
            <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
              <Spinner />
            </div>
          ) : error ? (
            <EmptyState title="Couldn't load login activity" body={error} />
          ) : data.items.length === 0 ? (
            <EmptyState title="No sign-ins in this range" />
          ) : (
            <table className="ps-table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Who</th>
                  <th>Browser</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e) => (
                  <tr key={e.id}>
                    <td className="ps-text-subtle">{formatDate(e.createdAt)}</td>
                    <td>{e.email}</td>
                    <td title={e.userAgent ?? ''}>{browserLabel(e.userAgent)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>
      <Pagination page={page} pageSize={pageSize} totalItems={data.total} onPageChange={setPage} onPageSizeChange={(n) => { setPageSize(n); setPage(1); }} itemNoun="sign-ins" />
    </div>
  );
}
