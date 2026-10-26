// Glean per-user OAuth (DCR + PKCE), all backend-mediated: the SPA only ever
// holds the Cognito token; the Glean token lives server-side. The lifecycle
// mutations below use gql<T>(); streamGleanChat is the one exception, a
// same-origin SSE fetch against the streaming API (/glean-api/*), not AppSync.

import { gql } from './graphql';
import { getIdToken, login } from '../auth/userManager';

/** Transport-agnostic reason a Glean call failed, mirrored from the backend
 *  GleanError.code. RECONNECT_REQUIRED/NOT_CONNECTED/TENANT_MISMATCH need re-auth;
 *  TRANSIENT is a retryable blip. */
export type GleanErrorCode = 'NOT_CONNECTED' | 'RECONNECT_REQUIRED' | 'TENANT_MISMATCH' | 'TRANSIENT';

const GLEAN_ERROR_CODES: readonly GleanErrorCode[] = [
  'NOT_CONNECTED',
  'RECONNECT_REQUIRED',
  'TENANT_MISMATCH',
  'TRANSIENT',
];

/** Narrow an unknown value to a GleanErrorCode, or null. */
export function normalizeGleanCode(value: unknown): GleanErrorCode | null {
  return typeof value === 'string' && (GLEAN_ERROR_CODES as readonly string[]).includes(value)
    ? (value as GleanErrorCode)
    : null;
}

export interface GleanConnection {
  /** Backend has a Glean base URL configured at all. */
  configured: boolean;
  /** Caller has a stored, usable Glean token. */
  connected: boolean;
  /** A token row exists but can't be used without re-auth (expired, no usable refresh). */
  needsReconnect: boolean;
  /** Active Glean base URL (admin override or env default). */
  baseUrl: string | null;
  email: string | null;
  scopes: string[] | null;
  expiresAt: string | null;
}

/** The SPA callback URL Glean redirects back to — must match the backend allow-list. */
export function gleanRedirectUri(): string {
  return `${location.origin}${import.meta.env.BASE_URL}glean/callback`;
}

// Where to send the user after a connect round-trip. The OAuth flow is a full-page
// redirect out of the SPA and back to /glean/callback, so we stash the origin in
// sessionStorage (survives the same-tab navigation) rather than threading it
// through the opaque server-side state.
export interface GleanReturn {
  /** Route to return to (pathname + search), e.g. '/items'. */
  path: string;
}

const RETURN_KEY = 'portal.glean.returnTo';

export function rememberGleanReturn(to: GleanReturn): void {
  try {
    sessionStorage.setItem(RETURN_KEY, JSON.stringify(to));
  } catch {
    /* sessionStorage unavailable — fall back to the default landing */
  }
}

/** Read + clear the stored return target (single-use). */
export function takeGleanReturn(): GleanReturn | null {
  try {
    const raw = sessionStorage.getItem(RETURN_KEY);
    if (raw) sessionStorage.removeItem(RETURN_KEY);
    return raw ? (JSON.parse(raw) as GleanReturn) : null;
  } catch {
    return null;
  }
}

const CONNECTION_FIELDS = `configured baseUrl connected needsReconnect email scopes expiresAt`;

const CONNECTION = `query { gleanConnection { ${CONNECTION_FIELDS} } }`;

export async function gleanConnection(): Promise<GleanConnection> {
  const data = await gql<{ gleanConnection: GleanConnection }>(CONNECTION);
  return data.gleanConnection;
}

const BEGIN = `mutation($redirectUri: String!) { gleanBeginConnect(redirectUri: $redirectUri) { url } }`;

/** Returns the Glean authorize URL to navigate the browser to. */
export async function gleanBeginConnect(redirectUri: string): Promise<string> {
  const data = await gql<{ gleanBeginConnect: { url: string } }>(BEGIN, { redirectUri });
  return data.gleanBeginConnect.url;
}

/** Kick off the per-user OAuth flow, returning to `to` afterward. Reusable across
 *  workflows (any signed-in user, admin or not) — the connect mutation is
 *  per-user server-side, so this is the one entry point for (re)authorizing. */
export async function reconnectGlean(to: GleanReturn): Promise<void> {
  rememberGleanReturn(to);
  window.location.href = await gleanBeginConnect(gleanRedirectUri());
}

const COMPLETE = `mutation($code: String!, $state: String!) {
  gleanCompleteConnect(code: $code, state: $state) { ${CONNECTION_FIELDS} }
}`;

export async function gleanCompleteConnect(code: string, state: string): Promise<GleanConnection> {
  const data = await gql<{ gleanCompleteConnect: GleanConnection }>(COMPLETE, { code, state });
  return data.gleanCompleteConnect;
}

const DISCONNECT = `mutation { gleanDisconnect { ${CONNECTION_FIELDS} } }`;

export async function gleanDisconnect(): Promise<GleanConnection> {
  const data = await gql<{ gleanDisconnect: GleanConnection }>(DISCONNECT);
  return data.gleanDisconnect;
}

const SET_ENDPOINT = `mutation($baseUrl: String!) {
  gleanSetEndpoint(baseUrl: $baseUrl) { ${CONNECTION_FIELDS} }
}`;

/** Switch the active Glean tenant (e.g. a sandbox tenant -> production). Disconnects everyone. */
export async function gleanSetEndpoint(baseUrl: string): Promise<GleanConnection> {
  const data = await gql<{ gleanSetEndpoint: GleanConnection }>(SET_ENDPOINT, { baseUrl });
  return data.gleanSetEndpoint;
}

// --------------------------------------------------------------------------
// Streaming draft (SSE). Hits the same-origin streaming proxy directly — a
// root-absolute path so it matches CloudFront's /glean-api/* behavior (the SPA
// itself is served under /ps/, but the proxy origin lives at the root). The
// Node Lambda emits SSE: `data:` frames carrying JSON-encoded answer deltas,
// `event: thinking` frames carrying the agent's progress updates, `:` heartbeat
// comments, and an `event: done` / `event: error` terminator.
// --------------------------------------------------------------------------

export class GleanStreamError extends Error {
  /** The backend GleanError.code when the server sent a structured error frame. */
  readonly code?: GleanErrorCode;
  constructor(message: string, code?: GleanErrorCode) {
    super(message);
    this.code = code;
  }
}

const CHAT_PATH = '/glean-api/draft';

export interface StreamGleanChatArgs {
  prompt: string;
  /** Called with each answer text delta as it arrives. */
  onText: (delta: string) => void;
  /** Called with each agent "thinking" delta (skill use, searches, outlining). */
  onThinking?: (delta: string) => void;
  signal?: AbortSignal;
}

/** Stream a Glean chat answer for `prompt` as the signed-in user. Resolves when
 *  the stream completes; rejects on transport/auth errors or a server `error` event. */
export async function streamGleanChat({ prompt, onText, onThinking, signal }: StreamGleanChatArgs): Promise<void> {
  const token = await getIdToken();
  if (!token) {
    void login();
    throw new GleanStreamError('Not signed in — redirecting.');
  }

  const res = await fetch(CHAT_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ prompt }),
    signal,
  });

  if (res.status === 401) {
    void login();
    throw new GleanStreamError('Session expired — redirecting.');
  }
  if (!res.ok || !res.body) {
    throw new GleanStreamError(`Glean chat stream failed (HTTP ${res.status}).`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const handleFrame = (frame: string) => {
    let event = 'message';
    const dataLines: string[] = [];
    for (const raw of frame.split('\n')) {
      if (!raw || raw.startsWith(':')) continue; // blank line or heartbeat comment
      const sep = raw.indexOf(':');
      const field = sep === -1 ? raw : raw.slice(0, sep);
      const value = sep === -1 ? '' : raw.slice(sep + 1).replace(/^ /, '');
      if (field === 'event') event = value;
      else if (field === 'data') dataLines.push(value);
    }
    if (dataLines.length === 0) return;
    const data = dataLines.join('\n');
    if (event === 'done') return;
    if (event === 'error') throw gleanStreamErrorFrom(data);
    if (event === 'thinking') {
      const t = jsonString(data);
      if (t) onThinking?.(t);
      return;
    }
    const text = jsonString(data);
    if (text) onText(text);
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) >= 0) {
        handleFrame(buffer.slice(0, sep));
        buffer = buffer.slice(sep + 2);
      }
    }
    const tail = buffer.trim();
    if (tail) handleFrame(tail);
  } catch (err) {
    await reader.cancel().catch(() => {});
    throw err;
  }
}

/** Build a GleanStreamError from an SSE `error` frame. Tolerant of both the
 *  current structured `{code,message}` payload and the legacy bare-string form,
 *  so the SPA and the streaming Lambda need not deploy in lockstep. */
function gleanStreamErrorFrom(data: string): GleanStreamError {
  try {
    const v: unknown = JSON.parse(data);
    if (typeof v === 'string') return new GleanStreamError(v || 'Glean draft stream errored.');
    if (v && typeof v === 'object') {
      const o = v as { code?: unknown; message?: unknown };
      const message = typeof o.message === 'string' && o.message ? o.message : 'Glean draft stream errored.';
      return new GleanStreamError(message, normalizeGleanCode(o.code) ?? undefined);
    }
  } catch {
    /* not JSON — fall through */
  }
  return new GleanStreamError('Glean draft stream errored.');
}

/** Decode an SSE `data:` payload (always JSON-encoded on the wire) to its string. */
function jsonString(data: string): string {
  try {
    const v: unknown = JSON.parse(data);
    return typeof v === 'string' ? v : '';
  } catch {
    return '';
  }
}

/** One run of the Hub -> Glean indexing worker (admin). */
export interface IndexRun {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  processed: number | null;
}

export async function fetchGleanIndexRuns(limit = 20): Promise<IndexRun[]> {
  const data = await gql<{ gleanIndexRuns: IndexRun[] }>(`query IndexRuns($limit: Int) { gleanIndexRuns(limit: $limit) { id type status startedAt completedAt processed } }`, {
    limit,
  });
  return data.gleanIndexRuns;
}

/** Asks the indexing worker for a full re-index; false when no worker is wired to the API. */
export async function triggerGleanIndex(): Promise<boolean> {
  const data = await gql<{ triggerGleanIndex: boolean }>(`mutation TriggerGleanIndex { triggerGleanIndex(full: true) }`);
  return data.triggerGleanIndex;
}
