// Home: the domain's metrics and panel (from the registration in src/domain.tsx),
// the caller's Glean connection, and an "Ask Glean" panel that streams a chat
// answer through the portal's own streaming API using the caller's Glean token
// (Glean -> Hub).
import { useEffect, useRef, useState } from 'react';
import { Plug, Send } from 'lucide-react';
import { Button } from '../components/ui/Button';
import { Card, CardBody, CardHeader } from '../components/ui/Card';
import { GleanLogo } from '../components/ui/GleanLogo';
import { MetricCard } from '../components/ui/MetricCard';
import { useCurrentUser } from '../data/useCurrentUser';
import { DOMAIN } from '../domain';
import { PORTAL_NAME } from '../lib/api/config';
import { gleanBeginConnect, gleanConnection, gleanRedirectUri, rememberGleanReturn, streamGleanChat, type GleanConnection } from '../lib/api/glean';
import { gleanReconnectCode, promptGleanReconnect } from '../lib/api/gleanReconnect';
import { useAsyncData } from '../lib/api/useAsyncData';
import { showToast } from '../state/toast';

export function HomeView() {
  const me = useCurrentUser();
  const conn = useAsyncData(gleanConnection, [], null as GleanConnection | null);
  const { HomeMetrics, HomePanel } = DOMAIN;

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

      <div className={`ps-grid ${HomeMetrics ? 'ps-grid--cols-3' : 'ps-grid--cols-2'}`} style={{ marginBottom: 20 }}>
        {HomeMetrics && <HomeMetrics />}
        <MetricCard
          label="Glean connection"
          value={conn.data?.connected ? 'Connected' : conn.data?.needsReconnect ? 'Reconnect' : 'Not connected'}
          loading={conn.loading}
          hint={conn.data?.email ?? undefined}
        />
      </div>

      <div className={`ps-grid ${HomePanel ? 'ps-grid--cols-2' : ''}`} style={{ alignItems: 'start' }}>
        {HomePanel && <HomePanel />}
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
