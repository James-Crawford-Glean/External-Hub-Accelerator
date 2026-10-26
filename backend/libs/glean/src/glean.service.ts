// Glean OAuth (public DCR client + PKCE) + token custody, plus the chat stream
// reader. Base-URL resolution: the admin's DB override wins over the env default.
//
// Glean's tenant is an OAuth 2.1 Authorization Server (not an OIDC login IdP):
// per-user Authorization Code + PKCE with Dynamic Client Registration, so no
// static client is pre-registered and there is NO client secret. Cognito stays
// the app login; this is a separate per-user authorization minting a Glean API
// token. Backend-mediated: this service holds the PKCE verifier
// (app.glean_oauth_state) and the tokens (app.glean_tokens); the SPA never sees
// a Glean token. The streaming proxy fetches a live token via the token RPC,
// which calls access_token().
//
// Config (env, set by Terraform — dev only today), read lazily inside methods:
//   GLEAN_BASE_URL       e.g. https://<tenant>-be.glean.com (unset => not configured)
//   GLEAN_SCOPES         space-separated, default 'openid email offline_access search chat'
//   GLEAN_REDIRECT_URIS  comma-separated allow-list of SPA callback URLs
//   GLEAN_AUTH_PROMPT    OIDC `prompt` for /authorize (default 'login'; '' to omit)
import { createHash, randomBytes } from 'node:crypto';
import { Logger } from '@libs/log';
import { AuroraService } from '@libs/aurora';

const DEFAULT_SCOPES = 'openid email offline_access search chat entities';
const PHOTO_MAX_ATTEMPTS = 4;
const PHOTO_RETRYABLE = new Set([408, 425, 429, 500, 502, 503, 504]);
/** Glean default silhouettes are ~1KB palette PNGs; real headshots are much larger. */
export const MIN_PHOTO_BYTES = 2_048;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const photoBackoffMs = (attempt: number, retryAfter: string | null): number => {
  if (retryAfter) {
    const parsed = Number.parseFloat(retryAfter);
    if (!Number.isNaN(parsed) && parsed >= 0) return Math.min(parsed * 1000, 30_000);
  }
  return Math.min(500 * 2 ** attempt, 8_000) + Math.random() * 250;
};

function plausiblePhoto(buf: Uint8Array): boolean {
  return buf.length >= MIN_PHOTO_BYTES;
}

type PhotoOk = { kind: 'ok'; bytes: { body: Uint8Array; contentType: string } };
type PhotoMiss = {
  kind: 'miss';
  reason: 'not_glean_hosted' | 'placeholder' | 'http' | 'not_image' | 'error';
  status?: number;
  bytes?: number;
};
type PhotoAttempt = PhotoOk | PhotoMiss;

function uniqueHttpUrls(candidates: Array<string | null | undefined>): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of candidates) {
    if (!u || !u.startsWith('http') || seen.has(u)) continue;
    seen.add(u);
    out.push(u);
  }
  return out;
}

function photoHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * Glean-served image URLs need the user token; Slack/Google CDNs do not. Glean
 * serves photos from the tenant backend host and from sibling hosts under the
 * same parent domain (`<tenant>-be.glean.com` -> `*.glean.com`), so the parent
 * is derived from GLEAN_BASE_URL rather than hard-coded. A base host with no
 * parent beyond the public suffix matches itself only, so the token is never
 * sent to an arbitrary host.
 */
export function isGleanHostedPhotoUrl(url: string, base: string): boolean {
  const host = photoHost(url);
  const baseHost = photoHost(base);
  if (!host || !baseHost) return false;
  if (host === baseHost) return true;
  const parent = baseHost.slice(baseHost.indexOf('.') + 1);
  return parent.includes('.') && (host === parent || host.endsWith(`.${parent}`));
}

export interface GleanConnection {
  configured: boolean;
  connected: boolean;
  baseUrl: string | null;
  email: string | null;
  scopes: string[] | null;
  expiresAt: string | null;
  /** A token row exists but can't be used without re-auth (expired with no
   *  usable refresh token). Lets the SPA prompt a reconnect before a call fails. */
  needsReconnect: boolean;
}

/** The transport-agnostic reason a Glean call failed. Rides on GleanError.code
 *  so every surface (SSE proxy, GraphQL, SPA) reacts on a stable value rather
 *  than string-matching human text. `RECONNECT_REQUIRED`/`NOT_CONNECTED` mean the
 *  user must (re)authorize; `TRANSIENT` is a retryable Glean/network blip. */
export type GleanErrorCode = 'NOT_CONNECTED' | 'RECONNECT_REQUIRED' | 'TENANT_MISMATCH' | 'TRANSIENT';

export class GleanError extends Error {
  constructor(
    readonly code: GleanErrorCode,
    message: string,
    readonly httpStatus?: number,
  ) {
    super(message);
    this.name = 'GleanError';
  }
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
  expires_in?: number | string;
  [k: string]: unknown;
}

/** One decoded delta from the Glean chat stream: the answer text (CONTENT) and
 *  the agent's behind-the-scenes progress (UPDATE / anything else), split apart. */
export interface GleanChatDelta {
  content: string;
  thinking: string;
}

export class GleanService {
  private readonly log = new Logger(GleanService.name);
  // OAuth Authorization Server metadata (RFC 8414), cached per base URL.
  private readonly metaCache = new Map<string, Record<string, unknown>>();

  constructor(private readonly aurora: AuroraService) {}

  // identity ---------------------------------------------------------------

  /** Canonical custody key for the caller: the registry usr_* id (app.users by
   *  email), falling back to the Cognito sub. Same resolution as users.me();
   *  tokens in app.glean_tokens are keyed by this. */
  async ownerId(email: string | null | undefined, sub: string | null | undefined): Promise<string> {
    return (await this.userIdByEmail(email)) || sub || 'unknown';
  }

  private async userIdByEmail(email: string | null | undefined): Promise<string | null> {
    if (!email) return null;
    const rows = await this.aurora.query<{ id: string }>(
      'SELECT id FROM app.users WHERE lower(email) = :e LIMIT 1',
      { e: email.toLowerCase() },
    );
    return rows.length ? rows[0]!.id : null;
  }

  // config -----------------------------------------------------------------

  /** Admin-set base URL (app.glean_config), if any. Tolerant of the table not
   *  existing yet (pre-migration) so connection() never hard-fails. */
  private async configBase(): Promise<string | null> {
    let rows: { base_url?: string | null }[];
    try {
      rows = await this.aurora.query<{ base_url?: string | null }>('SELECT base_url FROM app.glean_config WHERE id = true');
    } catch {
      return null;
    }
    const v = rows.length ? rows[0]!.base_url : null;
    return v ? v.trim().replace(/\/+$/, '') : null;
  }

  /** Active Glean base URL: the admin override (DB) wins, else the env default. */
  async baseUrl(): Promise<string> {
    return (await this.configBase()) || (process.env.GLEAN_BASE_URL || '').trim().replace(/\/+$/, '');
  }

  /** Admin: set the active Glean endpoint. Switching tenants invalidates every
   *  stored token + pending state (a token can't cross tenants) — forces reconnect. */
  async setEndpoint(newBase: string, by: string | null): Promise<void> {
    const nb = (newBase || '').trim().replace(/\/+$/, '');
    if (!nb.startsWith('https://')) throw new Error('glean: endpoint must be an https:// URL');
    const changed = nb !== (await this.baseUrl());
    await this.aurora.execute(
      'INSERT INTO app.glean_config (id, base_url, updated_at, updated_by) VALUES (true, :b, now(), :by) ' +
        'ON CONFLICT (id) DO UPDATE SET base_url = EXCLUDED.base_url, updated_at = now(), ' +
        'updated_by = EXCLUDED.updated_by',
      { b: nb, by },
    );
    if (changed) {
      await this.aurora.execute('DELETE FROM app.glean_tokens');
      await this.aurora.execute('DELETE FROM app.glean_oauth_state');
      this.log.log(`glean.endpoint.changed base=${nb} by=${by}`);
    }
  }

  async configured(): Promise<boolean> {
    return !!(await this.baseUrl());
  }

  private scopes(): string {
    return (process.env.GLEAN_SCOPES || DEFAULT_SCOPES).trim();
  }

  /** OIDC `prompt` for /authorize. Defaults to 'login' so a stale session for a
   *  different Glean tenant can't shadow the selected endpoint's SSO. Set
   *  GLEAN_AUTH_PROMPT='' to omit. Unknown values are ignored by the AS. */
  private prompt(): string | null {
    const val = (process.env.GLEAN_AUTH_PROMPT ?? 'login').trim();
    return val || null;
  }

  private allowedRedirects(): string[] {
    return (process.env.GLEAN_REDIRECT_URIS || '')
      .split(',')
      .map((u) => u.trim())
      .filter((u) => u);
  }

  // http -------------------------------------------------------------------

  /** One HTTPS call. Returns [status, parsed-json|text]. Never raises on HTTP
   *  error status — returns the parsed error body so callers can surface it. */
  private async request(
    method: string,
    url: string,
    opts: { form?: Record<string, string>; body?: unknown; token?: string } = {},
  ): Promise<[number, unknown]> {
    const headers: Record<string, string> = { Accept: 'application/json' };
    let data: string | undefined;
    if (opts.form !== undefined) {
      data = new URLSearchParams(opts.form).toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    } else if (opts.body !== undefined) {
      data = JSON.stringify(opts.body);
      headers['Content-Type'] = 'application/json';
    }
    if (opts.token) headers['Authorization'] = `Bearer ${opts.token}`;
    const resp = await fetch(url, {
      method,
      headers,
      ...(data !== undefined ? { body: data } : {}),
      signal: AbortSignal.timeout(30_000),
    });
    return [resp.status, this.parse(await resp.text())];
  }

  private parse(text: string): unknown {
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private async meta(base: string): Promise<Record<string, unknown>> {
    const cached = this.metaCache.get(base);
    if (cached) return cached;
    const [status, doc] = await this.request('GET', `${base}/.well-known/oauth-authorization-server`);
    if (status !== 200 || typeof doc !== 'object' || doc === null) {
      throw new Error(`glean: cannot read OAuth metadata (${status})`);
    }
    const meta = doc as Record<string, unknown>;
    this.metaCache.set(base, meta);
    return meta;
  }

  // DCR client (cached per base URL in Aurora) -----------------------------

  /** Client id for `base`. Registers a public PKCE client via DCR on first use
   *  and whenever GLEAN_SCOPES no longer matches the cached registration (so
   *  adding scopes like `entities` takes effect without a manual DB wipe). */
  async ensureClient(base: string): Promise<string> {
    const desired = this.scopes();
    const rows = await this.aurora.query<{ client_id: string; scope: string | null }>(
      'SELECT client_id, scope FROM app.glean_oauth_client WHERE glean_base_url = :b',
      { b: base },
    );
    if (rows.length && rows[0]!.scope === desired) return rows[0]!.client_id;
    const meta = await this.meta(base);
    const regUrl = meta['registration_endpoint'] as string | undefined;
    if (!regUrl) throw new Error('glean: no registration_endpoint (DCR disabled?)');
    const [status, doc] = await this.request('POST', regUrl, {
      body: {
        client_name: process.env.GLEAN_CLIENT_NAME || 'portal',
        redirect_uris: this.allowedRedirects(),
        grant_types: ['authorization_code', 'refresh_token'],
        response_types: ['code'],
        token_endpoint_auth_method: 'none',
        scope: desired,
      },
    });
    const rec = doc as { client_id?: string } | null;
    if ((status !== 200 && status !== 201) || typeof doc !== 'object' || doc === null || !rec?.client_id) {
      throw new Error(`glean: DCR failed (${status}): ${this.errBody(doc)}`);
    }
    const cid = rec.client_id;
    await this.aurora.execute(
      'INSERT INTO app.glean_oauth_client (glean_base_url, client_id, scope) VALUES (:b, :c, :s) ' +
        'ON CONFLICT (glean_base_url) DO UPDATE SET client_id = EXCLUDED.client_id, ' +
        'scope = EXCLUDED.scope, registered_at = now()',
      { b: base, c: cid, s: desired },
    );
    this.log.log(`glean.dcr.registered base=${base} client=${cid} scope=${desired}`);
    return cid;
  }

  private errBody(doc: unknown): string {
    if (typeof doc === 'string') return doc.slice(0, 300);
    try {
      return JSON.stringify(doc).slice(0, 300);
    } catch {
      return String(doc).slice(0, 300);
    }
  }

  // PKCE + authorize -------------------------------------------------------

  private b64url(raw: Buffer): string {
    return raw.toString('base64url');
  }

  /** Start a connect: validate the redirect, mint PKCE+state, persist state,
   *  return the Glean authorize URL for the SPA to navigate to. */
  async begin(owner: string, redirectUri: string): Promise<string> {
    const base = await this.baseUrl();
    if (!base) throw new Error('glean: not configured');
    if (!this.allowedRedirects().includes(redirectUri)) throw new Error('glean: redirect_uri not allowed');
    const clientId = await this.ensureClient(base);
    const verifier = this.b64url(randomBytes(48));
    const challenge = this.b64url(createHash('sha256').update(verifier).digest());
    const state = this.b64url(randomBytes(24));
    await this.aurora.execute(
      'INSERT INTO app.glean_oauth_state (state, owner_user_id, code_verifier, redirect_uri, glean_base_url) ' +
        'VALUES (:s, :o, :v, :r, :b)',
      { s: state, o: owner, v: verifier, r: redirectUri, b: base },
    );
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: this.scopes(),
      state,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    const prompt = this.prompt();
    if (prompt) params.set('prompt', prompt);
    const meta = await this.meta(base);
    return `${meta['authorization_endpoint'] as string}?${params.toString()}`;
  }

  /** Consume the state row, exchange the code (PKCE, no secret), store tokens. */
  async complete(owner: string, code: string, state: string): Promise<GleanConnection> {
    const rows = await this.aurora.query<{
      owner_user_id: string;
      code_verifier: string;
      redirect_uri: string;
      glean_base_url: string;
    }>(
      'SELECT owner_user_id, code_verifier, redirect_uri, glean_base_url ' +
        'FROM app.glean_oauth_state WHERE state = :s',
      { s: state },
    );
    if (!rows.length) throw new Error('glean: unknown or expired state');
    const row = rows[0]!;
    if (row.owner_user_id !== owner) throw new Error('glean: state does not belong to caller');
    const base = row.glean_base_url;
    const clientId = await this.ensureClient(base);
    const meta = await this.meta(base);
    const [status, tok] = await this.request('POST', meta['token_endpoint'] as string, {
      form: {
        grant_type: 'authorization_code',
        code,
        redirect_uri: row.redirect_uri,
        client_id: clientId,
        code_verifier: row.code_verifier,
      },
    });
    await this.aurora.execute('DELETE FROM app.glean_oauth_state WHERE state = :s', { s: state });
    const t = tok as TokenResponse | null;
    if (status !== 200 || typeof tok !== 'object' || tok === null || !t?.access_token) {
      throw new Error(`glean: token exchange failed (${status}): ${String(tok).slice(0, 200)}`);
    }
    await this.store(owner, base, t);
    return this.connection(owner);
  }

  // tokens -----------------------------------------------------------------

  private async store(owner: string, base: string, tok: TokenResponse): Promise<void> {
    const claims = this.jwtClaims(tok.id_token || tok.access_token || '');
    const expiresAt = new Date(Date.now() + Number(tok.expires_in || 0) * 1000).toISOString();
    await this.aurora.execute(
      'INSERT INTO app.glean_tokens ' +
        '(owner_user_id, glean_base_url, access_token, refresh_token, scope, expires_at, email, updated_at) ' +
        'VALUES (:o, :b, :at, :rt, :sc, :exp::timestamptz, :em, now()) ' +
        'ON CONFLICT (owner_user_id) DO UPDATE SET ' +
        'glean_base_url = EXCLUDED.glean_base_url, access_token = EXCLUDED.access_token, ' +
        'refresh_token = COALESCE(EXCLUDED.refresh_token, app.glean_tokens.refresh_token), ' +
        'scope = EXCLUDED.scope, expires_at = EXCLUDED.expires_at, email = EXCLUDED.email, updated_at = now()',
      {
        o: owner,
        b: base,
        at: tok.access_token!,
        rt: tok.refresh_token ?? null,
        sc: tok.scope ?? null,
        exp: expiresAt,
        em: (claims['email'] as string | undefined) ?? null,
      },
    );
  }

  private jwtClaims(token: string): Record<string, unknown> {
    const parts = token.split('.');
    if (parts.length < 2) return {};
    try {
      return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
    } catch {
      return {};
    }
  }

  /** Connection status for the SPA card. */
  async connection(owner: string): Promise<GleanConnection> {
    const base = await this.baseUrl();
    if (!base) {
      return { configured: false, connected: false, baseUrl: null, email: null, scopes: null, expiresAt: null, needsReconnect: false };
    }
    const rows = await this.aurora.query<{
      glean_base_url: string;
      refresh_token: string | null;
      scope: string | null;
      email: string | null;
      expires_at: string | null;
    }>('SELECT glean_base_url, refresh_token, scope, email, expires_at FROM app.glean_tokens WHERE owner_user_id = :o', {
      o: owner,
    });
    // A token minted against a different tenant doesn't count as connected.
    if (!rows.length || rows[0]!.glean_base_url !== base) {
      return { configured: true, connected: false, baseUrl: base, email: null, scopes: null, expiresAt: null, needsReconnect: false };
    }
    const r = rows[0]!;
    // Still "connected" (a token exists for this tenant), but it can't self-heal
    // when it's expired with no refresh token — the SPA surfaces a reconnect CTA.
    const needsReconnect = this.expired(r.expires_at) && !r.refresh_token;
    return {
      configured: true,
      connected: true,
      baseUrl: base,
      email: r.email ?? null,
      scopes: r.scope ? r.scope.split(/\s+/) : [],
      expiresAt: AuroraService.iso8601(r.expires_at),
      needsReconnect,
    };
  }

  async disconnect(owner: string): Promise<void> {
    await this.aurora.execute('DELETE FROM app.glean_tokens WHERE owner_user_id = :o', { o: owner });
  }

  /** Live [access_token, base] for the caller, refreshing if expired. Throws if
   *  not connected or refresh fails. This is the contract the streaming proxy
   *  consumes via the token RPC. */
  async accessToken(owner: string): Promise<[string, string]> {
    const rows = await this.aurora.query<{
      glean_base_url: string;
      access_token: string;
      refresh_token: string | null;
      expires_at: string | null;
    }>(
      'SELECT glean_base_url, access_token, refresh_token, expires_at ' +
        'FROM app.glean_tokens WHERE owner_user_id = :o',
      { o: owner },
    );
    if (!rows.length) throw new GleanError('NOT_CONNECTED', 'glean: not connected');
    const r = rows[0]!;
    const expired = this.expired(r.expires_at);
    this.log.log(`glean.token.check hasRow=true expired=${expired} hasRefresh=${!!r.refresh_token}`);
    if (!expired) return [r.access_token, r.glean_base_url];
    if (!r.refresh_token) throw new GleanError('RECONNECT_REQUIRED', 'glean: token expired, reconnect required');
    const base = r.glean_base_url;
    const t = await this.refreshGrant(base, r.refresh_token);
    await this.store(owner, base, t);
    return [t.access_token!, base];
  }

  /** Exchange a refresh token for a fresh access token at the tenant's token
   *  endpoint. Throws RECONNECT_REQUIRED when the grant is rejected (the refresh
   *  token is expired/revoked) — the only recovery is a new authorization. */
  private async refreshGrant(base: string, refreshToken: string): Promise<TokenResponse> {
    const meta = await this.meta(base);
    const [status, tok] = await this.request('POST', meta['token_endpoint'] as string, {
      form: {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: await this.ensureClient(base),
      },
    });
    const t = tok as TokenResponse | null;
    const ok = status === 200 && typeof tok === 'object' && tok !== null && !!t?.access_token;
    this.log.log(`glean.token.refresh status=${status} ok=${ok}`);
    if (!ok) throw new GleanError('RECONNECT_REQUIRED', 'glean: refresh failed, reconnect required', status);
    return t!;
  }

  /** Force a refresh regardless of local expiry — used when Glean rejects a token
   *  our clock still considered live (clock skew, server-side revocation). */
  private async forceRefresh(owner: string): Promise<[string, string]> {
    const rows = await this.aurora.query<{ glean_base_url: string; refresh_token: string | null }>(
      'SELECT glean_base_url, refresh_token FROM app.glean_tokens WHERE owner_user_id = :o',
      { o: owner },
    );
    if (!rows.length) throw new GleanError('NOT_CONNECTED', 'glean: not connected');
    const r = rows[0]!;
    if (!r.refresh_token) throw new GleanError('RECONNECT_REQUIRED', 'glean: token expired, reconnect required');
    const t = await this.refreshGrant(r.glean_base_url, r.refresh_token);
    await this.store(owner, r.glean_base_url, t);
    return [t.access_token!, r.glean_base_url];
  }

  private expired(expiresAt: string | null): boolean {
    if (!expiresAt) return true;
    // Normalize the Data API form ('2026-... +00' / space-separated) to ISO.
    let s = expiresAt.trim().replace('Z', '+00:00').replace(' ', 'T');
    if (!/([+-]\d{2}:?\d{2}|[+-]\d{2})$/.test(s.slice(11))) s += '+00:00';
    else s = s.replace(/([+-]\d{2})$/, '$1:00');
    const parsed = new Date(s);
    if (isNaN(parsed.getTime())) return true;
    // 60s skew so we refresh just before the API would reject the token.
    return Date.now() >= parsed.getTime() - 60_000;
  }

  // chat streaming ---------------------------------------------------------

  /** Stream a Glean chat completion for the caller as {content, thinking}
   *  deltas. Fetches a
   *  live token (accessToken), POSTs the prompt with stream:true, parses the
   *  NDJSON response line-by-line, and yields the answer text (messageType
   *  CONTENT) vs the agent's progress updates (everything else) split apart.
   *  Transport concerns (SSE framing, heartbeats) stay in the caller. */
  async *streamChat(owner: string, prompt: string, signal?: AbortSignal): AsyncGenerator<GleanChatDelta> {
    let [accessToken, base] = await this.accessToken(owner);
    if (!accessToken || !base) throw new GleanError('RECONNECT_REQUIRED', 'glean: no token');

    let res = await this.chatFetch(base, accessToken, prompt, signal);
    // Self-heal a token Glean rejects even though our clock thought it live:
    // force one refresh + retry before surfacing a reconnect. A still-401 after
    // a fresh token means the grant itself is no longer valid.
    if (res.status === 401 || res.status === 403) {
      this.log.warn(`glean.chat.reauth status=${res.status}`);
      [accessToken, base] = await this.forceRefresh(owner);
      res = await this.chatFetch(base, accessToken, prompt, signal);
    }

    if (!res.ok || !res.body) {
      const detail = await res.text().catch(() => '');
      this.log.warn(`glean.chat.failed status=${res.status}`);
      if (res.status === 401 || res.status === 403) {
        throw new GleanError('RECONNECT_REQUIRED', `glean: authorization rejected (${res.status})`, res.status);
      }
      throw new GleanError('TRANSIENT', `glean chat failed (${res.status}): ${detail.slice(0, 200)}`, res.status);
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      let nl: number;
      while ((nl = buf.indexOf('\n')) >= 0) {
        const delta = this.parseChatLine(buf.slice(0, nl));
        buf = buf.slice(nl + 1);
        if (delta.content || delta.thinking) yield delta;
      }
    }
    const tail = this.parseChatLine(buf);
    if (tail.content || tail.thinking) yield tail;
  }

  /** One POST to the tenant's chat endpoint with a given bearer. Kept separate
   *  so streamChat can retry it with a fresh token on a 401/403. */
  private chatFetch(base: string, token: string, prompt: string, signal?: AbortSignal): Promise<Response> {
    return fetch(`${base}/rest/api/v1/chat`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        accept: 'application/jsonl, application/x-ndjson, application/json',
      },
      body: JSON.stringify({
        messages: [{ author: 'USER', fragments: [{ text: prompt }] }],
        stream: true,
      }),
      signal,
    });
  }

  /** Classify one line of Glean's streamed NDJSON into {content, thinking};
   *  both '' if the line isn't JSON or carries no text. Tolerates partial lines. */
  private parseChatLine(line: string): GleanChatDelta {
    const s = line.trim();
    if (!s) return { content: '', thinking: '' };
    try {
      return this.classifyChat(JSON.parse(s));
    } catch {
      return { content: '', thinking: '' };
    }
  }

  /** Split one parsed Glean chat chunk into content (messageType CONTENT — the
   *  answer) vs thinking (UPDATE / anything else — progress the agent shouldn't
   *  leak into the body), skipping the echoed USER message. */
  private classifyChat(chunk: unknown): GleanChatDelta {
    const messages = (chunk as { messages?: unknown } | null)?.messages;
    let content = '';
    let thinking = '';
    if (!Array.isArray(messages)) return { content, thinking };
    for (const m of messages as Array<Record<string, unknown>>) {
      if (m?.['author'] === 'USER') continue;
      let text = '';
      const fragments = m?.['fragments'];
      if (Array.isArray(fragments)) {
        for (const f of fragments as Array<{ text?: unknown }>) {
          if (typeof f?.text === 'string') text += f.text;
        }
      }
      if (!text) continue;
      if (m?.['messageType'] === 'CONTENT') content += text;
      else thinking += text;
    }
    return { content, thinking };
  }

  // entities (people / avatars) --------------------------------------------

  /** All people in the Glean directory (FULL_DIRECTORY). */
  async listPeopleDirectory(base: string, token: string): Promise<Array<{ id: string; email: string | null; photoUrl: string | null; photoUrls: string[] }>> {
    const [status, doc] = await this.request('POST', `${base}/rest/api/v1/listentities`, {
      token,
      body: { entityType: 'PEOPLE', requestType: 'FULL_DIRECTORY' },
    });
    if (status !== 200) {
      throw new Error(`glean: listentities failed (${status}): ${this.errBody(doc)}`);
    }
    return this.parsePeople(doc);
  }

  /** Resolve one person by email (case-insensitive). */
  async findPersonByEmail(
    base: string,
    token: string,
    email: string,
  ): Promise<{ id: string; email: string | null; photoUrl: string | null; photoUrls: string[] } | null> {
    const norm = email.toLowerCase().trim();
    const [status, doc] = await this.request('POST', `${base}/rest/api/v1/listentities`, {
      token,
      body: {
        entityType: 'PEOPLE',
        filters: [{ field: 'email', relation: 'EQUALS', value: norm }],
      },
    });
    if (status === 200) {
      const people = this.parsePeople(doc);
      const hit = people.find((p) => (p.email || '').toLowerCase() === norm);
      if (hit) return hit;
    }
    const all = await this.listPeopleDirectory(base, token);
    return all.find((p) => (p.email || '').toLowerCase() === norm) ?? null;
  }

  /** Photo bytes from listentities URLs first, then Glean-hosted /people/{id}/photo.
   *  Hosted endpoint only serves photos stored in Glean; externally hosted photos
   *  (Slack/Google CDN) return 403/404 — docs say follow photoUrl instead.
   *  Skips tiny default silhouettes so callers keep trying other candidates. */
  async fetchPersonPhotoBytes(
    base: string,
    token: string,
    person: { id: string; photoUrl: string | null; photoUrls?: string[] },
  ): Promise<{ body: Uint8Array; contentType: string } | null> {
    const urls = uniqueHttpUrls([...(person.photoUrls ?? []), person.photoUrl]);
    const hosts = urls.map(photoHost).filter(Boolean);
    const hasExternalCdn = urls.some((u) => !isGleanHostedPhotoUrl(u, base));
    for (const url of urls) {
      const auth = isGleanHostedPhotoUrl(url, base) ? token : undefined;
      const got = await this.downloadExternalPhoto(url, auth);
      if (got.kind === 'ok') return got.bytes;
      this.log.log(
        `glean.external_photo_miss person=${person.id} host=${photoHost(url)} ` +
          `reason=${got.reason}${got.status != null ? ` status=${got.status}` : ''}` +
          `${got.bytes != null ? ` bytes=${got.bytes}` : ''}`,
      );
    }

    // Skip hosted when listentities already pointed at an external CDN — that
    // endpoint cannot serve Slack/Google photos and typically 403s (docs: 404).
    if (hasExternalCdn) {
      this.log.log(
        `glean.photo_miss person=${person.id} external_urls=${urls.length} ` +
          `hosts=${hosts.join(',') || '-'} hosted=skipped_external_cdn`,
      );
      return null;
    }

    const hosted = await this.fetchHostedPhoto(base, token, person.id);
    if (hosted.kind === 'ok') return hosted.bytes;
    this.log.log(
      `glean.photo_miss person=${person.id} external_urls=${urls.length} ` +
        `hosts=${hosts.join(',') || '-'} hosted=${hosted.reason}` +
        `${hosted.status != null ? ` status=${hosted.status}` : ''}` +
        `${hosted.bytes != null ? ` bytes=${hosted.bytes}` : ''}`,
    );
    return null;
  }

  private async fetchHostedPhoto(
    base: string,
    token: string,
    personId: string,
  ): Promise<PhotoAttempt> {
    const url = `${base}/rest/api/v1/people/${encodeURIComponent(personId)}/photo`;
    for (let attempt = 0; attempt < PHOTO_MAX_ATTEMPTS; attempt += 1) {
      try {
        const resp = await fetch(url, {
          headers: { Authorization: `Bearer ${token}`, Accept: 'image/*' },
          signal: AbortSignal.timeout(30_000),
        });
        // Docs: 404 when not Glean-hosted. In practice tenants often return 403
        // for the same case — treat both as "try photoUrl, don't retry".
        if (resp.status === 404 || resp.status === 403) {
          return { kind: 'miss', reason: 'not_glean_hosted', status: resp.status };
        }
        if (PHOTO_RETRYABLE.has(resp.status) && attempt + 1 < PHOTO_MAX_ATTEMPTS) {
          const wait = photoBackoffMs(attempt, resp.headers.get('retry-after'));
          this.log.log(`glean.photo_retry person=${personId} status=${resp.status} sleep=${wait}ms`);
          await sleep(wait);
          continue;
        }
        if (!resp.ok) return { kind: 'miss', reason: 'http', status: resp.status };
        const ct = resp.headers.get('content-type') || 'image/jpeg';
        const buf = new Uint8Array(await resp.arrayBuffer());
        if (!plausiblePhoto(buf)) return { kind: 'miss', reason: 'placeholder', status: 200, bytes: buf.length };
        return { kind: 'ok', bytes: { body: buf, contentType: ct } };
      } catch (e) {
        if (attempt + 1 >= PHOTO_MAX_ATTEMPTS) {
          return { kind: 'miss', reason: 'error' };
        }
        const wait = photoBackoffMs(attempt, null);
        this.log.log(`glean.photo_retry person=${personId} err=${String(e)} sleep=${wait}ms`);
        await sleep(wait);
      }
    }
    return { kind: 'miss', reason: 'error' };
  }

  async downloadExternalPhoto(
    url: string,
    token?: string,
  ): Promise<PhotoAttempt> {
    for (let attempt = 0; attempt < PHOTO_MAX_ATTEMPTS; attempt += 1) {
      try {
        const headers: Record<string, string> = { Accept: 'image/*' };
        if (token) headers.Authorization = `Bearer ${token}`;
        const resp = await fetch(url, { headers, signal: AbortSignal.timeout(30_000) });
        if (PHOTO_RETRYABLE.has(resp.status) && attempt + 1 < PHOTO_MAX_ATTEMPTS) {
          const wait = photoBackoffMs(attempt, resp.headers.get('retry-after'));
          this.log.log(`glean.external_photo_retry url=${url.slice(0, 80)} status=${resp.status} sleep=${wait}ms`);
          await sleep(wait);
          continue;
        }
        if (!resp.ok) return { kind: 'miss', reason: 'http', status: resp.status };
        const ct = resp.headers.get('content-type') || 'image/jpeg';
        if (!ct.startsWith('image/')) return { kind: 'miss', reason: 'not_image', status: resp.status };
        const buf = new Uint8Array(await resp.arrayBuffer());
        if (!plausiblePhoto(buf)) {
          return { kind: 'miss', reason: 'placeholder', status: resp.status, bytes: buf.length };
        }
        return { kind: 'ok', bytes: { body: buf, contentType: ct } };
      } catch (e) {
        if (attempt + 1 >= PHOTO_MAX_ATTEMPTS) {
          return { kind: 'miss', reason: 'error' };
        }
        const wait = photoBackoffMs(attempt, null);
        this.log.log(`glean.external_photo_retry url=${url.slice(0, 80)} err=${String(e)} sleep=${wait}ms`);
        await sleep(wait);
      }
    }
    return { kind: 'miss', reason: 'error' };
  }

  private parsePeople(doc: unknown): Array<{ id: string; email: string | null; photoUrl: string | null; photoUrls: string[] }> {
    const root = doc as Record<string, unknown> | null;
    const entities = (root?.['results'] ?? root?.['entities'] ?? root?.['people'] ?? doc) as unknown;
    if (!Array.isArray(entities)) return [];
    const out: Array<{ id: string; email: string | null; photoUrl: string | null; photoUrls: string[] }> = [];
    for (const raw of entities) {
      const p = this.shapePerson(raw);
      if (p) out.push(p);
    }
    return out;
  }

  private shapePerson(
    raw: unknown,
  ): { id: string; email: string | null; photoUrl: string | null; photoUrls: string[] } | null {
    if (!raw || typeof raw !== 'object') return null;
    const r = raw as Record<string, unknown>;
    const id = String(r['id'] ?? r['personId'] ?? r['obfuscatedId'] ?? '').trim();
    if (!id) return null;
    const meta = (r['metadata'] ?? r['profile'] ?? r) as Record<string, unknown>;
    const email =
      (typeof r['email'] === 'string' ? r['email'] : null) ??
      (typeof meta['email'] === 'string' ? meta['email'] : null) ??
      (typeof meta['primaryEmail'] === 'string' ? meta['primaryEmail'] : null);
    // Prefer Slack/Google originals — Glean's /api/v1/images URLs often 401.
    const candidates = [
      meta['uneditedPhotoUrl'],
      r['uneditedPhotoUrl'],
      meta['photoUrl'],
      r['photoUrl'],
      r['photo'],
    ];
    const photoUrls = [
      ...new Set(
        candidates.filter((u): u is string => typeof u === 'string' && u.startsWith('http')),
      ),
    ];
    return { id, email, photoUrl: photoUrls[0] ?? null, photoUrls };
  }
}
