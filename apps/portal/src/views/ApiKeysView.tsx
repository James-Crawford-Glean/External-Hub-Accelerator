// Admin > API keys: service credentials for machine callers (MCP hosts using a
// static key, integrations). The secret is shown once at creation; the server
// stores only a peppered hash.
import { useState } from 'react';
import { KeyRound } from 'lucide-react';
import { Badge } from '../components/ui/Badge';
import { Button } from '../components/ui/Button';
import { Card, CardBody } from '../components/ui/Card';
import { Dialog } from '../components/ui/Dialog';
import { EmptyState } from '../components/ui/EmptyState';
import { MetricCard } from '../components/ui/MetricCard';
import { Spinner } from '../components/ui/Spinner';
import { CreateApiKeyDialog } from '../components/dialogs/CreateApiKeyDialog';
import type { ApiKey } from '../data/types';
import { createApiKey, deleteApiKey, fetchApiKeys, revokeApiKey } from '../lib/api/apiKeys';
import { useAsyncData } from '../lib/api/useAsyncData';
import { apiKeyScopeLabels, apiKeyScopeTone, formatDate } from '../lib/labels';
import { useSaveAction } from '../lib/saveAction';

type Effective = 'active' | 'expiring' | 'expired' | 'revoked';

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function effectiveStatus(key: ApiKey): Effective {
  if (key.status === 'REVOKED') return 'revoked';
  if (key.expiresAt) {
    const d = daysUntil(key.expiresAt);
    if (d <= 0) return 'expired';
    if (d <= 14) return 'expiring';
  }
  return 'active';
}

const TONE: Record<Effective, 'success' | 'warning' | 'danger' | 'neutral'> = {
  active: 'success',
  expiring: 'warning',
  expired: 'danger',
  revoked: 'neutral',
};

export function ApiKeysView() {
  const [refreshKey, setRefreshKey] = useState(0);
  const [creating, setCreating] = useState(false);
  const [confirm, setConfirm] = useState<{ mode: 'revoke' | 'delete'; key: ApiKey } | null>(null);
  const { data: keys, loading, error } = useAsyncData(fetchApiKeys, [refreshKey], [] as ApiKey[]);
  const { saving, run } = useSaveAction();
  const refresh = () => setRefreshKey((k) => k + 1);

  const active = keys.filter((k) => effectiveStatus(k) === 'active').length;
  const expiring = keys.filter((k) => effectiveStatus(k) === 'expiring').length;

  return (
    <div>
      <header className="ps-page__header">
        <div>
          <h1 className="ps-page-title">API keys</h1>
          <p className="ps-page-subtitle">
            Service credentials for machine callers, authorized by scope rather than by a person's role. Send as{' '}
            <code>Authorization: Bearer &lt;key&gt;</code> to the GraphQL or MCP endpoint.
          </p>
        </div>
        <Button variant="primary" iconLeft={<KeyRound size={14} />} onClick={() => setCreating(true)}>
          Create key
        </Button>
      </header>

      <div className="ps-grid ps-grid--cols-3" style={{ marginBottom: 20 }}>
        <MetricCard label="Active keys" value={active} loading={loading} />
        <MetricCard label="Expiring within 14 days" value={expiring} loading={loading} />
        <MetricCard label="Total" value={keys.length} loading={loading} />
      </div>

      <Card>
        <CardBody flush>
          {loading && keys.length === 0 ? (
            <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
              <Spinner />
            </div>
          ) : error ? (
            <EmptyState title="Couldn't load keys" body={error} />
          ) : keys.length === 0 ? (
            <EmptyState title="No API keys" body="Create one to let an external system call the API." />
          ) : (
            <table className="ps-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Key</th>
                  <th>Scopes</th>
                  <th>Status</th>
                  <th>Last used</th>
                  <th>Expires</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {keys.map((k) => {
                  const eff = effectiveStatus(k);
                  return (
                    <tr key={k.id}>
                      <td>
                        <div style={{ fontWeight: 600 }}>{k.name}</div>
                        <div className="ps-text-subtle" style={{ fontSize: 12 }}>
                          by {k.createdBy} · {formatDate(k.createdAt)}
                        </div>
                      </td>
                      <td>
                        <code>
                          {k.prefix}…{k.last4}
                        </code>
                      </td>
                      <td>
                        <span className="ps-row" style={{ gap: 4 }}>
                          {k.scopes.map((s) => (
                            <Badge key={s} tone={apiKeyScopeTone[s]}>
                              {apiKeyScopeLabels[s]}
                            </Badge>
                          ))}
                        </span>
                      </td>
                      <td>
                        <Badge tone={TONE[eff]}>{eff}</Badge>
                      </td>
                      <td className="ps-text-subtle">{formatDate(k.lastUsedAt) || 'Never'}</td>
                      <td className="ps-text-subtle">{formatDate(k.expiresAt) || 'Never'}</td>
                      <td style={{ textAlign: 'right' }}>
                        {k.status === 'ACTIVE' ? (
                          <Button size="sm" variant="ghost" onClick={() => setConfirm({ mode: 'revoke', key: k })}>
                            Revoke
                          </Button>
                        ) : (
                          <Button size="sm" variant="ghost" onClick={() => setConfirm({ mode: 'delete', key: k })}>
                            Delete
                          </Button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </CardBody>
      </Card>

      <CreateApiKeyDialog
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={refresh}
        create={async (input) => (await createApiKey({ name: input.name, scopes: input.scopes, expiresAt: input.expiresAt })).secret}
      />

      <Dialog
        open={confirm !== null}
        title={confirm?.mode === 'revoke' ? 'Revoke this key?' : 'Delete this key?'}
        subtitle={
          confirm?.mode === 'revoke'
            ? 'Callers using it stop working within a minute. The row stays for audit.'
            : 'Removes the audit row for a revoked key. This cannot be undone.'
        }
        onClose={() => setConfirm(null)}
        primaryAction={{
          label: confirm?.mode === 'revoke' ? 'Revoke' : 'Delete',
          variant: 'danger',
          disabled: saving,
          onClick: () =>
            confirm &&
            void run({
              action: () => (confirm.mode === 'revoke' ? revokeApiKey(confirm.key.id) : deleteApiKey(confirm.key.id)),
              successMsg: `${confirm.mode === 'revoke' ? 'Revoked' : 'Deleted'} ${confirm.key.name}`,
              onDone: () => {
                setConfirm(null);
                refresh();
              },
            }),
        }}
      >
        <p style={{ fontSize: 14 }}>
          <strong>{confirm?.key.name}</strong>{' '}
          <code>
            {confirm?.key.prefix}…{confirm?.key.last4}
          </code>
        </p>
      </Dialog>
    </div>
  );
}
