// Example domain: what items add to the home screen (registered in src/domain.tsx).
import { Link } from 'react-router-dom';
import { Boxes } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { MetricCard } from '../components/ui/MetricCard';
import { fetchItems, type Item } from '../lib/api/items';
import { useAsyncData } from '../lib/api/useAsyncData';
import { formatDate } from '../lib/labels';

const EMPTY = { items: [] as Item[], total: 0 };

export function ItemsHomeMetrics() {
  const active = useAsyncData(() => fetchItems({ status: ['ACTIVE'] }, 1), [], EMPTY);
  const archived = useAsyncData(() => fetchItems({ status: ['ARCHIVED'] }, 1), [], EMPTY);
  return (
    <>
      <MetricCard label="Active items" value={active.data.total} loading={active.loading} />
      <MetricCard label="Archived items" value={archived.data.total} loading={archived.loading} />
    </>
  );
}

export function ItemsHomePanel() {
  const items = useAsyncData(() => fetchItems({ status: ['ACTIVE'] }, 5), [], EMPTY);
  return (
    <Card>
      <CardHeader
        title="Recent items"
        subtitle="The example domain."
        action={
          <Link to="/items" className="ps-row" style={{ gap: 6, fontSize: 13 }}>
            <Boxes size={14} /> All items
          </Link>
        }
      />
      <CardBody flush>
        {items.data.items.length === 0 ? (
          <p className="ps-text-subtle" style={{ padding: 18, fontSize: 13 }}>
            {items.loading ? 'Loading…' : 'No items yet. The item-sync worker fills this list from the upstream system.'}
          </p>
        ) : (
          <table className="ps-table">
            <tbody>
              {items.data.items.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link to={`/items/${i.id}`} style={{ fontWeight: 600, color: 'inherit' }}>
                      {i.name}
                    </Link>
                  </td>
                  <td className="ps-text-subtle">{i.category ?? '—'}</td>
                  <td className="ps-text-subtle" style={{ textAlign: 'right' }}>{formatDate(i.updatedAt)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
