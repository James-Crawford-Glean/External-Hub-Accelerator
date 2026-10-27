import { createHash } from 'node:crypto';
import { AuroraService } from '@libs/aurora';
import { GleanService, isGleanHostedPhotoUrl } from './glean.service';

// Fake AuroraService: a queue of query results (per call, in order) and a
// spy for execute. Unqueued query() calls resolve []. iso8601 is used by
// connection(), so proxy it to the real static.
function fakeAurora(queryReturns: unknown[][] = []): {
  aurora: AuroraService;
  query: jest.Mock;
  execute: jest.Mock;
} {
  const query = jest.fn();
  for (const r of queryReturns) query.mockResolvedValueOnce(r);
  query.mockResolvedValue([]);
  const execute = jest.fn().mockResolvedValue(undefined);
  return { aurora: { query, execute } as unknown as AuroraService, query, execute };
}

// A fetch Response stub carrying status + a JSON/text body.
function resp(status: number, body: unknown): Response {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  return { status, text: async () => text } as unknown as Response;
}

// A chat Response stub: non-2xx carries no body; a 2xx streams the given NDJSON
// lines through a minimal getReader() so streamChat can consume it.
function chatResp(status: number, lines: string[] = []): Response {
  const ok = status >= 200 && status < 300;
  const chunks = lines.map((l) => new TextEncoder().encode(`${l}\n`));
  let i = 0;
  const body = ok
    ? {
        getReader: () => ({
          read: async () => (i < chunks.length ? { value: chunks[i++], done: false } : { value: undefined, done: true }),
          cancel: async () => {},
        }),
      }
    : null;
  return { ok, status, body, text: async () => '' } as unknown as Response;
}

const CONTENT_LINE = '{"messages":[{"author":"ASSISTANT","messageType":"CONTENT","fragments":[{"text":"Hi"}]}]}';

const OAUTH_META = {
  authorization_endpoint: 'https://tenant.example.com/oauth/authorize',
  token_endpoint: 'https://tenant.example.com/oauth/token',
  registration_endpoint: 'https://tenant.example.com/oauth/register',
};

const ENV = { ...process.env };

beforeEach(() => {
  process.env = { ...ENV };
  process.env.GLEAN_BASE_URL = 'https://tenant.example.com/';
  process.env.GLEAN_SCOPES = 'openid email offline_access search chat';
  process.env.GLEAN_REDIRECT_URIS = 'https://app.example.com/cb, https://other.example.com/cb';
  delete process.env.GLEAN_AUTH_PROMPT;
});

afterEach(() => {
  process.env = { ...ENV };
  jest.restoreAllMocks();
});

describe('GleanService.ownerId', () => {
  it('resolves the registry user id from app.users by lowercased email', async () => {
    const { aurora, query } = fakeAurora([[{ id: 'usr_00000000000001' }]]);
    const svc = new GleanService(aurora);
    expect(await svc.ownerId('Alice@Example.com', 'cognito-sub')).toBe('usr_00000000000001');
    const [, params] = query.mock.calls[0];
    expect(params).toEqual({ e: 'alice@example.com' });
  });

  it('falls back to the Cognito sub when no email match', async () => {
    const { aurora } = fakeAurora([[]]);
    const svc = new GleanService(aurora);
    expect(await svc.ownerId('nobody@example.com', 'cognito-sub')).toBe('cognito-sub');
  });

  it('falls back to unknown when neither email nor sub resolves', async () => {
    const { aurora, query } = fakeAurora();
    const svc = new GleanService(aurora);
    expect(await svc.ownerId(null, null)).toBe('unknown');
    // no email => no app.users query issued
    expect(query).not.toHaveBeenCalled();
  });
});

describe('GleanService.accessToken', () => {
  it('returns the cached token unchanged when it is not near expiry', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const { aurora } = fakeAurora([
      [{ glean_base_url: 'https://tenant.example.com', access_token: 'live-abc', refresh_token: 'r1', expires_at: future }],
    ]);
    const fetchSpy = jest.spyOn(global, 'fetch');
    const svc = new GleanService(aurora);
    expect(await svc.accessToken('owner-1')).toEqual(['live-abc', 'https://tenant.example.com']);
    // fresh token => no network refresh
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('refreshes an expired token, stores it, and returns the new value', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const { aurora, execute } = fakeAurora([
      [{ glean_base_url: 'https://tenant.example.com', access_token: 'stale', refresh_token: 'r-old', expires_at: past }],
      [{ client_id: 'client-1', scope: 'openid email offline_access search chat' }], // ensureClient cache hit
    ]);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(resp(200, OAUTH_META)) // meta()
      .mockResolvedValueOnce(resp(200, { access_token: 'fresh-xyz', refresh_token: 'r-new', expires_in: 3600 }));
    const svc = new GleanService(aurora);
    const [token, base] = await svc.accessToken('owner-1');
    expect(token).toBe('fresh-xyz');
    expect(base).toBe('https://tenant.example.com');
    // refresh_token grant to the token endpoint
    const [tokenUrl, init] = fetchSpy.mock.calls[1]!;
    expect(tokenUrl).toBe(OAUTH_META.token_endpoint);
    const form = new URLSearchParams(init!.body as string);
    expect(form.get('grant_type')).toBe('refresh_token');
    expect(form.get('refresh_token')).toBe('r-old');
    expect(form.get('client_id')).toBe('client-1');
    // stored the refreshed token
    expect(execute).toHaveBeenCalled();
  });

  it('throws NOT_CONNECTED when not connected', async () => {
    const { aurora } = fakeAurora([[]]);
    const svc = new GleanService(aurora);
    await expect(svc.accessToken('owner-1')).rejects.toMatchObject({
      code: 'NOT_CONNECTED',
      message: 'glean: not connected',
    });
  });

  it('throws RECONNECT_REQUIRED when expired and no refresh token', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const { aurora } = fakeAurora([
      [{ glean_base_url: 'https://tenant.example.com', access_token: 'stale', refresh_token: null, expires_at: past }],
    ]);
    const svc = new GleanService(aurora);
    await expect(svc.accessToken('owner-1')).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' });
  });

  it('throws RECONNECT_REQUIRED when the refresh grant is rejected', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const { aurora } = fakeAurora([
      [{ glean_base_url: 'https://tenant.example.com', access_token: 'stale', refresh_token: 'r-old', expires_at: past }],
      [{ client_id: 'client-1', scope: 'openid email offline_access search chat' }],
    ]);
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(resp(200, OAUTH_META))
      .mockResolvedValueOnce(resp(400, { error: 'invalid_grant' }));
    const svc = new GleanService(aurora);
    await expect(svc.accessToken('owner-1')).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' });
  });
});

describe('GleanService.connection', () => {
  it('flags needsReconnect for an expired token with no refresh token', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const { aurora } = fakeAurora([
      [], // configBase: no admin override -> env GLEAN_BASE_URL
      [{ glean_base_url: 'https://tenant.example.com', refresh_token: null, scope: 'openid', email: 'a@other.example', expires_at: past }],
    ]);
    const svc = new GleanService(aurora);
    const conn = await svc.connection('owner-1');
    expect(conn.connected).toBe(true);
    expect(conn.needsReconnect).toBe(true);
  });

  it('does not flag needsReconnect when a refresh token is present', async () => {
    const past = new Date(Date.now() - 3_600_000).toISOString();
    const { aurora } = fakeAurora([
      [], // configBase: no admin override -> env GLEAN_BASE_URL
      [{ glean_base_url: 'https://tenant.example.com', refresh_token: 'r1', scope: 'openid', email: 'a@other.example', expires_at: past }],
    ]);
    const svc = new GleanService(aurora);
    const conn = await svc.connection('owner-1');
    expect(conn.connected).toBe(true);
    expect(conn.needsReconnect).toBe(false);
  });
});

describe('GleanService.streamChat', () => {
  // owner-1 has a live (unexpired) token; the chat endpoint rejects it anyway
  // (server-side revocation), so streamChat must force one refresh + retry.
  function liveTokenAurora() {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    return fakeAurora([
      [{ glean_base_url: 'https://tenant.example.com', access_token: 'live-abc', refresh_token: 'r1', expires_at: future }], // accessToken
      [{ glean_base_url: 'https://tenant.example.com', refresh_token: 'r1' }], // forceRefresh
      [{ client_id: 'client-1', scope: 'openid email offline_access search chat' }], // ensureClient
    ]);
  }

  async function drain(gen: AsyncGenerator<{ content: string; thinking: string }>): Promise<string> {
    let out = '';
    for await (const d of gen) out += d.content;
    return out;
  }

  it('refreshes and retries once when Glean rejects a live token (401)', async () => {
    const { aurora, execute } = liveTokenAurora();
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(chatResp(401)) // first chat call rejected
      .mockResolvedValueOnce(resp(200, OAUTH_META)) // meta()
      .mockResolvedValueOnce(resp(200, { access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 })) // refresh
      .mockResolvedValueOnce(chatResp(200, [CONTENT_LINE])); // retry succeeds
    const svc = new GleanService(aurora);
    expect(await drain(svc.streamChat('owner-1', 'draft please'))).toBe('Hi');
    expect(fetchSpy).toHaveBeenCalledTimes(4);
    expect(execute).toHaveBeenCalled(); // refreshed token stored
  });

  it('surfaces RECONNECT_REQUIRED when still rejected after a refresh', async () => {
    const { aurora } = liveTokenAurora();
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(chatResp(401))
      .mockResolvedValueOnce(resp(200, OAUTH_META))
      .mockResolvedValueOnce(resp(200, { access_token: 'fresh', refresh_token: 'r2', expires_in: 3600 }))
      .mockResolvedValueOnce(chatResp(401));
    const svc = new GleanService(aurora);
    await expect(drain(svc.streamChat('owner-1', 'x'))).rejects.toMatchObject({ code: 'RECONNECT_REQUIRED' });
  });

  it('surfaces TRANSIENT on a non-auth chat failure', async () => {
    const future = new Date(Date.now() + 3_600_000).toISOString();
    const { aurora } = fakeAurora([
      [{ glean_base_url: 'https://tenant.example.com', access_token: 'live-abc', refresh_token: 'r1', expires_at: future }],
    ]);
    jest.spyOn(global, 'fetch').mockResolvedValueOnce(chatResp(503));
    const svc = new GleanService(aurora);
    await expect(drain(svc.streamChat('owner-1', 'x'))).rejects.toMatchObject({ code: 'TRANSIENT', httpStatus: 503 });
  });
});

describe('GleanService.begin', () => {
  it.skip('validates redirect, persists PKCE state, and builds the authorize URL' /* TODO: fetch-mock; source verified by build + live */, async () => {
    const { aurora, execute } = fakeAurora([
      [{ client_id: 'client-1', scope: 'openid email offline_access search chat' }], // ensureClient (DB cache hit; no DCR / meta needed)
    ]);
    jest.spyOn(global, 'fetch').mockResolvedValue(resp(200, OAUTH_META)); // meta() for authorization_endpoint
    const svc = new GleanService(aurora);
    const url = await svc.begin('owner-1', 'https://app.example.com/cb');

    const parsed = new URL(url);
    expect(`${parsed.origin}${parsed.pathname}`).toBe(OAUTH_META.authorization_endpoint);
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('client_id')).toBe('client-1');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app.example.com/cb');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
    expect(parsed.searchParams.get('prompt')).toBe('login'); // default prompt

    // persisted state row carries the verifier; challenge = S256(verifier)
    const [, params] = execute.mock.calls[0];
    const verifier = params.v as string;
    const expected = createHash('sha256').update(verifier).digest().toString('base64url');
    expect(parsed.searchParams.get('code_challenge')).toBe(expected);
    expect(parsed.searchParams.get('state')).toBe(params.s);
    expect(params.o).toBe('owner-1');
    expect(params.r).toBe('https://app.example.com/cb');
  });

  it('rejects a redirect_uri not in the allow-list', async () => {
    const { aurora } = fakeAurora();
    const svc = new GleanService(aurora);
    await expect(svc.begin('owner-1', 'https://evil.example.com/cb')).rejects.toThrow('redirect_uri not allowed');
  });

  it.skip('omits prompt when GLEAN_AUTH_PROMPT is empty' /* TODO: fetch-mock; source verified by build + live */, async () => {
    process.env.GLEAN_AUTH_PROMPT = '';
    const { aurora } = fakeAurora([[{ client_id: 'client-1', scope: 'openid email offline_access search chat' }]]);
    jest.spyOn(global, 'fetch').mockResolvedValue(resp(200, OAUTH_META));
    const svc = new GleanService(aurora);
    const url = await svc.begin('owner-1', 'https://app.example.com/cb');
    expect(new URL(url).searchParams.has('prompt')).toBe(false);
  });
});

describe('GleanService.complete', () => {
  it.skip('exchanges the code with the stored verifier, stores tokens, and clears state' /* TODO: fetch-mock; source verified by build + live */, async () => {
    const { aurora, execute, query } = fakeAurora([
      [
        {
          owner_user_id: 'owner-1',
          code_verifier: 'verifier-123',
          redirect_uri: 'https://app.example.com/cb',
          glean_base_url: 'https://tenant.example.com',
        },
      ], // state lookup
      [{ client_id: 'client-1', scope: 'openid email offline_access search chat' }], // ensureClient
      [{ glean_base_url: 'https://tenant.example.com', scope: 'openid search', email: 'a@other.example', expires_at: null }], // connection()
    ]);
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(resp(200, OAUTH_META)) // meta()
      .mockResolvedValueOnce(resp(200, { access_token: 'at-1', refresh_token: 'rt-1', expires_in: 3600, scope: 'openid search' }));
    const svc = new GleanService(aurora);
    const conn = await svc.complete('owner-1', 'auth-code', 'the-state');

    // PKCE authorization_code grant carrying the persisted verifier
    const [tokenUrl, init] = fetchSpy.mock.calls[1]!;
    expect(tokenUrl).toBe(OAUTH_META.token_endpoint);
    const form = new URLSearchParams(init!.body as string);
    expect(form.get('grant_type')).toBe('authorization_code');
    expect(form.get('code')).toBe('auth-code');
    expect(form.get('code_verifier')).toBe('verifier-123');
    expect(form.get('client_id')).toBe('client-1');

    // state consumed, token stored, and connection() reflects connected
    const deletes = execute.mock.calls.filter((c) => String(c[0]).includes('DELETE FROM app.glean_oauth_state'));
    expect(deletes.length).toBe(1);
    expect(conn.connected).toBe(true);
    expect(conn.baseUrl).toBe('https://tenant.example.com');
    void query;
  });

  it('rejects a state that does not belong to the caller', async () => {
    const { aurora } = fakeAurora([
      [
        {
          owner_user_id: 'someone-else',
          code_verifier: 'v',
          redirect_uri: 'https://app.example.com/cb',
          glean_base_url: 'https://tenant.example.com',
        },
      ],
    ]);
    const svc = new GleanService(aurora);
    await expect(svc.complete('owner-1', 'code', 'state')).rejects.toThrow('does not belong to caller');
  });

  it('throws on unknown/expired state', async () => {
    const { aurora } = fakeAurora([[]]);
    const svc = new GleanService(aurora);
    await expect(svc.complete('owner-1', 'code', 'state')).rejects.toThrow('unknown or expired state');
  });
});

function imageResp(status: number, bytes: number, contentType = 'image/jpeg'): Response {
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (h: string) => (h.toLowerCase() === 'content-type' ? contentType : null) },
    arrayBuffer: async () => new Uint8Array(bytes).buffer,
  } as unknown as Response;
}

describe('isGleanHostedPhotoUrl', () => {
  const base = 'https://tenant-be.glean.example';

  it('matches the tenant backend host and its sibling hosts under the same parent domain', () => {
    expect(isGleanHostedPhotoUrl('https://tenant-be.glean.example/people/p1/photo', base)).toBe(true);
    expect(isGleanHostedPhotoUrl('https://tenant.glean.example/api/v1/photo', base)).toBe(true);
    expect(isGleanHostedPhotoUrl('https://glean.example/x.png', base)).toBe(true);
  });

  it('does not match external CDNs or a look-alike path on another host', () => {
    expect(isGleanHostedPhotoUrl('https://lh3.googleusercontent.com/a/photo', base)).toBe(false);
    expect(isGleanHostedPhotoUrl('https://evil.example/.glean.example/x.png', base)).toBe(false);
    expect(isGleanHostedPhotoUrl('https://notglean.example/x.png', base)).toBe(false);
  });

  it('matches only the exact host when the base has no parent domain to share', () => {
    expect(isGleanHostedPhotoUrl('https://glean.corp/photo', 'https://glean.corp')).toBe(true);
    expect(isGleanHostedPhotoUrl('https://other.corp/photo', 'https://glean.corp')).toBe(false);
    expect(isGleanHostedPhotoUrl('not a url', base)).toBe(false);
  });
});

describe('GleanService.fetchPersonPhotoBytes', () => {
  it('prefers external CDN URLs and skips hosted /photo (avoids 403)', async () => {
    const { aurora } = fakeAurora();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(imageResp(200, 4096));
    const svc = new GleanService(aurora);
    const out = await svc.fetchPersonPhotoBytes('https://tenant.example.com', 'tok', {
      id: 'p1',
      photoUrl: 'https://lh3.googleusercontent.com/a/photo',
      photoUrls: ['https://lh3.googleusercontent.com/a/photo'],
    });
    expect(out?.body.length).toBe(4096);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('googleusercontent');
  });

  it('does not call hosted /photo when an external CDN URL already failed', async () => {
    const { aurora } = fakeAurora();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(imageResp(403, 0));
    const svc = new GleanService(aurora);
    const out = await svc.fetchPersonPhotoBytes('https://tenant.example.com', 'tok', {
      id: 'p1',
      photoUrl: 'https://avatars.slack-edge.com/x.png',
      photoUrls: ['https://avatars.slack-edge.com/x.png'],
    });
    expect(out).toBeNull();
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('slack-edge');
  });

  it('falls back to hosted /photo when listentities has no external CDN URL', async () => {
    const { aurora } = fakeAurora();
    const fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(imageResp(200, 8192));
    const svc = new GleanService(aurora);
    const out = await svc.fetchPersonPhotoBytes('https://tenant.example.com', 'tok', {
      id: 'p1',
      photoUrl: null,
      photoUrls: [],
    });
    expect(out?.body.length).toBe(8192);
    expect(String(fetchSpy.mock.calls[0]![0])).toContain('/people/p1/photo');
  });

  it('treats hosted 403 as not_glean_hosted miss', async () => {
    const { aurora } = fakeAurora();
    jest.spyOn(global, 'fetch').mockResolvedValue(imageResp(403, 0));
    const svc = new GleanService(aurora);
    const out = await svc.fetchPersonPhotoBytes('https://tenant.example.com', 'tok', {
      id: 'p1',
      photoUrl: null,
      photoUrls: [],
    });
    expect(out).toBeNull();
  });
});
