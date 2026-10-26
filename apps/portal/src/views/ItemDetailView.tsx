// Example domain: one item. Shows every platform concept on a single record:
// opaque id, upstream external id, owner from the registry, visibility role,
// sync and index timestamps, the write actions, and the review step that
// publishes (or discards) a DRAFT the MCP server created.
import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Archive, Check, ExternalLink, Pencil, X } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { EmptyState } from '../components/ui/EmptyState';
import { KeyValueRow } from '../components/ui/KeyValueRow';
import { Spinner } from '../components/ui/Spinner';
import { ItemDialog } from '../components/items/ItemDialog';
import { ItemLogo } from '../components/items/ItemLogo';
import { useCurrentUser } from '../data/useCurrentUser';
import { approveItem, archiveItem, fetchItem, rejectItem, type Item } from '../lib/api/items';
import { fetchLogos } from '../lib/api/logos';
import { useAsyncData } from '../lib/api/useAsyncData';
import { canWrite } from '../lib/capabilities';
import { formatDate, roleLabel, statusTone } from '../lib/labels';
import { useSaveAction } from '../lib/saveAction';

export function ItemDetailView() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const me = useCurrentUser();
  const [editing, setEditing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const { data: item, loading, error } = useAsyncData(() => fetchItem(id), [id, refreshKey], null as Item | null);
  const { data: logos } = useAsyncData(
    item?.website ? () => fetchLogos([item.website!]) : null,
    [item?.website],
    new Map<string, string | null>(),
  );
  const { saving, run } = useSaveAction();

  if (loading && !item) {
    return (
      <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
        <Spinner />
      </div>
    );
  }
  if (error || !item) {
    return (
      <EmptyState
        title={error ? "Couldn't load this item" : 'Item not found'}
        body={error ?? 'It may have been archived, or it is restricted to a role you do not have.'}
        action={<Link to="/items">Back to items</Link>}
      />
    );
  }

  const writable = canWrite(me);
  const isDraft = item.status === 'DRAFT';
  const refresh = () => setRefreshKey((k) => k + 1);
  return (
    <div>
      <header className="ps-page__header">
        <div className="ps-row" style={{ gap: 14 }}>
          <ItemLogo name={item.name} url={logos.get(item.website ?? '') ?? null} size={44} />
          <div>
            <h1 className="ps-page-title">{item.name}</h1>
            <p className="ps-page-subtitle">
              {[item.category, item.website].filter(Boolean).join(' · ') || 'Item'}
            </p>
          </div>
        </div>
        {writable && (
          <div className="ps-row" style={{ gap: 8 }}>
            <Button variant="secondary" iconLeft={<Pencil size={14} />} onClick={() => setEditing(true)}>
              Edit
            </Button>
            {item.status === 'ACTIVE' && (
              <Button
                variant="ghost"
                iconLeft={<Archive size={14} />}
                disabled={saving}
                onClick={() => void run({ action: () => archiveItem(item.id), successMsg: 'Item archived', onDone: refresh })}
              >
                Archive
              </Button>
            )}
          </div>
        )}
      </header>

      {isDraft && (
        <Card style={{ marginBottom: 16 }}>
          <CardBody>
            <div className="ps-row" style={{ gap: 12, justifyContent: 'space-between', flexWrap: 'wrap' }}>
              <div>
                <strong>Awaiting review.</strong>{' '}
                <span className="ps-text-subtle">
                  Drafted by the Glean assistant for {item.owner?.name ?? 'its owner'}. It stays out of the default list and
                  out of the Glean index until a writer approves it.
                </span>
              </div>
              {writable && (
                <div className="ps-row" style={{ gap: 8 }}>
                  <Button
                    variant="primary"
                    iconLeft={<Check size={14} />}
                    disabled={saving}
                    onClick={() => void run({ action: () => approveItem(item.id), successMsg: 'Item approved and published', onDone: refresh })}
                  >
                    Approve
                  </Button>
                  <Button
                    variant="ghost"
                    iconLeft={<X size={14} />}
                    disabled={saving}
                    onClick={() => void run({ action: () => rejectItem(item.id), successMsg: 'Draft rejected', onDone: refresh })}
                  >
                    Reject
                  </Button>
                </div>
              )}
            </div>
          </CardBody>
        </Card>
      )}

      <div className="ps-grid ps-grid--cols-2" style={{ alignItems: 'start' }}>
        <Card>
          <CardHeader title="About" />
          <CardBody>
            <p style={{ fontSize: 14, lineHeight: 1.6, color: item.description ? 'inherit' : 'var(--color-ink-muted)' }}>
              {item.description ?? 'No description yet.'}
            </p>
            {item.website && (
              <a href={`https://${item.website}`} target="_blank" rel="noreferrer" className="ps-row" style={{ gap: 6, fontSize: 13, marginTop: 10 }}>
                {item.website} <ExternalLink size={12} />
              </a>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Record" subtitle="How the platform tracks this row." />
          <CardBody flush>
            <KeyValueRow label="Status" value={<Badge tone={statusTone(item.status)}>{item.status}</Badge>} />
            <KeyValueRow label="Owner" value={item.owner ? `${item.owner.name} <${item.owner.email}>` : '—'} />
            <KeyValueRow label="Visibility" value={item.visibilityRole ? `${roleLabel(item.visibilityRole)} only` : 'Everyone'} />
            <KeyValueRow label="Id" value={<code>{item.id}</code>} />
            <KeyValueRow label="Upstream id" value={item.externalId ? <code>{item.externalId}</code> : 'Created here'} />
            <KeyValueRow label="Source" value={item.source ?? '—'} />
            <KeyValueRow label="Last synced" value={formatDate(item.syncedAt) || 'Never'} />
            <KeyValueRow label="Indexed in Glean" value={formatDate(item.indexedAt) || 'Not yet'} />
            {item.reviewedAt && (
              <KeyValueRow label="Reviewed" value={`${formatDate(item.reviewedAt)}${item.reviewedBy ? ` by ${item.reviewedBy}` : ''}`} />
            )}
            <KeyValueRow label="Updated" value={formatDate(item.updatedAt)} />
          </CardBody>
        </Card>
      </div>

      <ItemDialog
        key={`${editing}-${item.updatedAt}`}
        open={editing}
        item={item}
        onClose={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          refresh();
        }}
      />
      <p style={{ marginTop: 16 }}>
        <Button variant="ghost" size="sm" onClick={() => navigate('/items')}>
          ← All items
        </Button>
      </p>
    </div>
  );
}
