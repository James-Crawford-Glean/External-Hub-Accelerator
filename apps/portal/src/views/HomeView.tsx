// Home: a quick read on the example domain, the caller's Glean connection,
// and an "Ask Glean" panel that streams a chat answer through the portal's
// own streaming API using the caller's Glean token (Glean -> Hub).
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Boxes, Plug, Send } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { GleanLogo } from '../components/ui/GleanLogo';
import { MetricCard } from '../components/ui/MetricCard';
import { useCurrentUser } from '../data/useCurrentUser';
import type { Item } from '../data/types';
import { PORTAL_NAME } from '../lib/api/config';
import { gleanBeginConnect, gleanConnection, gleanRedirectUri, rememberGleanReturn, streamGleanChat, type GleanConnection } from '../lib/api/glean';
import { gleanReconnectCode, promptGleanReconnect } from '../lib/api/gleanReconnect';
import { fetchItems } from '../lib/api/items';
import { useAsyncData } from '../lib/api/useAsyncData';
import { formatDate } from '../lib/labels';
import { showToast } from '../state/toast';

export function HomeView() {
  const me = useCurrentUser();
  const items = useAsyncData(() => fetchItems({ status: ['ACTIVE'] }, 5), [], { items: [] as Item[], total: 0 });
  const archived = useAsyncData(() => fetchItems({ status: ['ARCHIVED'] }, 1), [], { items: [] as Item[], total: 0 });
  const conn = useAsyncData(gleanConnection, [], null as GleanConnection | null);

  return (
    <div>
      <header className="ps-page__header">
        <div>
          <h1 className="ps-page-title">Welcome{me ? `, ${me.name.split(' ')[0]}` : ''}</h1>
          <p className="ps-page-subtitle">
            {PORTAL_NAME} is connected to Glean in both directions: Glean reads live records here through the MCP server
            and the indexing push, and you can ask Glean questions from here with your own Glean access.
          </p>
        </div>
      </header>

      <div className="ps-grid ps-grid--cols-3" style={{ marginBottom: 20 }}>
        <MetricCard label="Active items" value={items.data.total} loading={items.loading} />
        <MetricCard label="Archived items" value={archived.data.total} loading={archived.loading} />
        <MetricCard
          label="Glean connection"
          value={conn.data?.connected ? 'Connected' : conn.data?.needsReconnect ? 'Reconnect' : 'Not connected'}
          loading={conn.loading}
          hint={conn.data?.email ?? undefined}
        />
      </div>

      <div className="ps-grid ps-grid--cols-2" style={{ alignItems: 'start' }}>
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

        <AskGlean conn={conn.data} />
      </div>
    </div>
  );
}

function AskGlean({ conn }: { conn: GleanConnection | null }) {
  const [prompt, setPrompt] = useState('');
  const [answer, setAnswer] = useState('');
  const [thinking, setThinking] = useState('');
  const [busy, setBusy] = useState(false);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  async function connect() {
    try {
      rememberGleanReturn({ path: '/' });
      window.location.href = await gleanBeginConnect(gleanRedirectUri());
    } catch (e) {
      showToast(e instanceof Error ? e.message : 'Could not start Glean connect', 'danger');
    }
  }

  async function ask() {
    const q = prompt.trim();
    if (!q || busy) return;
    abort.current?.abort();
    const ctl = new AbortController();
    abort.current = ctl;
    setAnswer('');
    setThinking('');
    setBusy(true);
    try {
      await streamGleanChat({
        prompt: q,
        signal: ctl.signal,
        onText: (d) => setAnswer((a) => a + d),
        onThinking: (d) => setThinking((t) => (t + d).slice(-400)),
      });
    } catch (e) {
      if (ctl.signal.aborted) return;
      const code = gleanReconnectCode(e);
      if (code) promptGleanReconnect({ returnTo: { path: '/' }, code });
      else showToast(e instanceof Error ? e.message : 'Glean request failed', 'danger');
    } finally {
      if (abort.current === ctl) setBusy(false);
    }
  }

  return (
    <Card>
      <CardHeader title="Ask Glean" subtitle="Streams an answer from your Glean tenant, as you." action={<GleanLogo size={22} variant="mark" />} />
      <CardBody>
        {!conn?.configured ? (
          <p className="ps-text-subtle" style={{ fontSize: 13 }}>
            An administrator has not set the Glean endpoint yet.
          </p>
        ) : !conn.connected ? (
          <>
            <p style={{ fontSize: 13, color: 'var(--color-ink-muted)', marginBottom: 12, lineHeight: 1.55 }}>
              Connect your Glean account to ask questions from here. The token stays server-side.
            </p>
            <Button variant="primary" iconLeft={<Plug size={14} />} onClick={() => void connect()}>
              Connect Glean
            </Button>
          </>
        ) : (
          <>
            <form
              className="ps-row"
              style={{ gap: 8 }}
              onSubmit={(e) => {
                e.preventDefault();
                void ask();
              }}
            >
              <input
                className="ps-input"
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                placeholder="What do we know about Northwind Traders?"
                style={{ flex: 1 }}
                aria-label="Question for Glean"
              />
              <Button variant="primary" iconLeft={<Send size={14} />} disabled={busy || !prompt.trim()} type="submit">
                {busy ? 'Asking…' : 'Ask'}
              </Button>
            </form>
            {thinking && busy && (
              <p className="ps-text-subtle" style={{ fontSize: 12, marginTop: 10, whiteSpace: 'pre-wrap' }}>
                {thinking}
              </p>
            )}
            {answer && (
              <div style={{ marginTop: 14, fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' }} aria-live="polite">
                {answer}
              </div>
            )}
          </>
        )}
      </CardBody>
    </Card>
  );
}
