// Admin > Glean: the tenant endpoint (admin-set; DCR means no pre-registration),
// the caller's own connection, and the Hub -> Glean indexing runs with a
// "re-index now" action. Connect is per-user PKCE, backend-mediated.
import { useCallback, useEffect, useState } from 'react';
import { CheckCircle2, Plug, RefreshCw } from 'lucide-react';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { Button } from '../components/ui/Button';
import { Badge } from '../components/ui/Badge';
import { Spinner } from '../components/ui/Spinner';
import { EmptyState } from '../components/ui/EmptyState';
import { GleanLogo } from '../components/ui/GleanLogo';
import { showToast } from '../state/toast';
import { useSaveAction } from '../lib/saveAction';
import { PORTAL_NAME } from '../lib/api/config';
import { formatDate, statusTone } from '../lib/labels';
import {
  gleanBeginConnect,
  gleanConnection,
  gleanDisconnect,
  gleanRedirectUri,
  gleanSetEndpoint,
  rememberGleanReturn,
  type GleanConnection,
} from '../lib/api/glean';
import { fetchGleanIndexRuns, triggerGleanIndex } from '../lib/api/items';
import type { IndexRun } from '../data/types';

export function GleanView() {
  const [conn, setConn] = useState<GleanConnection | null | undefined>(undefined);
  const { saving, run } = useSaveAction();

  useEffect(() => {
    void gleanConnection().then(setConn).catch(() => setConn(null));
  }, []);

  async function connect() {
    try {
      rememberGleanReturn({ path: '/admin/glean' });
      window.location.href = await gleanBeginConnect(gleanRedirectUri());
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start Glean connect', 'danger');
    }
  }

  function disconnect() {
    void run({ action: gleanDisconnect, successMsg: 'Disconnected from Glean', onDone: setConn });
  }

  return (
    <div>
      <header className="ps-page__header">
        <div>
        <h1 className="ps-page-title">Glean</h1>
        <p className="ps-page-subtitle">
          Both directions of the integration: your Glean connection (Glean → {PORTAL_NAME}) and the indexing push
          ({PORTAL_NAME} → Glean).
        </p>
        </div>
      </header>

      {conn === undefined ? (
        <div style={{ padding: 48, display: 'flex', justifyContent: 'center' }}>
          <Spinner label="Loading…" />
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 20 }}>
          <EndpointCard conn={conn} onChanged={setConn} />
          {conn && !conn.configured ? (
            <EmptyState title="Glean endpoint not set" body="Enter your tenant's backend origin above (or set GLEAN_BASE_URL on the API) to enable connect." />
          ) : (
            <div style={{ maxWidth: 520 }}>
              <ConnectionCard conn={conn} saving={saving} onConnect={connect} onDisconnect={disconnect} />
            </div>
          )}
          <IndexingCard />
        </div>
      )}
    </div>
  );
}

function EndpointCard({ conn, onChanged }: { conn: GleanConnection | null; onChanged: (c: GleanConnection) => void }) {
  const current = (conn?.baseUrl ?? '').replace(/\/+$/, '');
  const [value, setValue] = useState(current);
  const { saving, run } = useSaveAction();
  const target = value.trim().replace(/\/+$/, '');
  const dirty = target.length > 0 && target !== current;

  return (
    <Card>
      <CardHeader title="Endpoint" subtitle="Your Glean tenant's backend origin, https://<tenant>-be.glean.com" />
      <CardBody>
        <div className="ps-row" style={{ gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            className="ps-input"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="https://<tenant>-be.glean.com"
            style={{ minWidth: 320 }}
            aria-label="Glean base URL"
          />
          <Button
            variant="primary"
            disabled={!dirty || saving}
            onClick={() => void run({ action: () => gleanSetEndpoint(target), successMsg: 'Glean endpoint updated', onDone: onChanged })}
          >
            {saving ? 'Saving…' : 'Save endpoint'}
          </Button>
        </div>
        {conn?.connected && (
          <p style={{ fontSize: 12, color: 'var(--color-ink-subtle)', marginTop: 10 }}>
            Switching tenants disconnects every current Glean connection; everyone reconnects against the new endpoint.
          </p>
        )}
      </CardBody>
    </Card>
  );
}

function ConnectionCard({
  conn,
  saving,
  onConnect,
  onDisconnect,
}: {
  conn: GleanConnection | null;
  saving: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
}) {
  const connected = Boolean(conn?.connected);
  return (
    <Card>
      <CardHeader title="Your connection" subtitle="Per-user OAuth (PKCE)" action={<GleanLogo size={24} variant="mark" />} />
      <CardBody>
        {connected ? (
          <>
            <div className="ps-row" style={{ gap: 8, color: 'var(--color-success-strong)', fontWeight: 600, fontSize: 14 }}>
              <CheckCircle2 size={16} /> Connected
            </div>
            <dl style={{ margin: '14px 0 18px', display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px', fontSize: 13 }}>
              <dt className="ps-text-subtle">Account</dt>
              <dd>{conn?.email || '—'}</dd>
              <dt className="ps-text-subtle">Scopes</dt>
              <dd>{conn?.scopes?.join(', ') || '—'}</dd>
              <dt className="ps-text-subtle">Expires</dt>
              <dd>{formatDate(conn?.expiresAt) || '—'}</dd>
            </dl>
            <Button variant="secondary" disabled={saving} onClick={onDisconnect}>
              Disconnect
            </Button>
          </>
        ) : (
          <>
            <p style={{ fontSize: 13, color: 'var(--color-ink-muted)', marginBottom: 14, lineHeight: 1.55 }}>
              Authorize {PORTAL_NAME} to call Glean on your behalf. You sign in through Glean once; the token is stored
              server-side and refreshed automatically. {conn?.needsReconnect ? 'Your previous connection expired.' : ''}
            </p>
            <Button variant="primary" iconLeft={<Plug size={14} />} onClick={onConnect}>
              Connect Glean
            </Button>
          </>
        )}
      </CardBody>
    </Card>
  );
}

function IndexingCard() {
  const [runs, setRuns] = useState<IndexRun[] | null>(null);
  const { saving, run } = useSaveAction();
  const load = useCallback(() => {
    void fetchGleanIndexRuns(10)
      .then(setRuns)
      .catch(() => setRuns([]));
  }, []);
  useEffect(load, [load]);

  return (
    <Card>
      <CardHeader
        title="Indexing"
        subtitle="Items pushed into your Glean datasource through the Indexing API; incremental on a schedule, full on demand."
        action={
          <Button
            variant="secondary"
            size="sm"
            iconLeft={<RefreshCw size={14} />}
            disabled={saving}
            onClick={() =>
              void run({
                action: triggerGleanIndex,
                successMsg: (ok) => (ok ? 'Full re-index started' : 'Indexing worker is not configured'),
                onDone: () => setTimeout(load, 1500),
              })
            }
          >
            Re-index now
          </Button>
        }
      />
      <CardBody flush>
        {runs === null ? (
          <div style={{ padding: 24, display: 'flex', justifyContent: 'center' }}>
            <Spinner />
          </div>
        ) : runs.length === 0 ? (
          <EmptyState title="No runs yet" body="The first scheduled run or a manual re-index will appear here." />
        ) : (
          <table className="ps-table">
            <thead>
              <tr>
                <th>Started</th>
                <th>Type</th>
                <th>Status</th>
                <th>Processed</th>
                <th>Completed</th>
              </tr>
            </thead>
            <tbody>
              {runs.map((r) => (
                <tr key={r.id}>
                  <td>{formatDate(r.startedAt)}</td>
                  <td>{r.type}</td>
                  <td>
                    <Badge tone={statusTone(r.status)}>{r.status}</Badge>
                  </td>
                  <td>{r.processed ?? '—'}</td>
                  <td>{formatDate(r.completedAt) || '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardBody>
    </Card>
  );
}
