import { GleanResolver } from './glean.resolver';
import type { WorkerService } from '@libs/worker';
import type { GleanService, GleanConnection } from '@libs/glean';
import type { AuthzService } from '@libs/authz';

const identity = { email: 'user@example.com', sub: 'sub-1' };

const connected: GleanConnection = {
  configured: true,
  connected: true,
  baseUrl: 'https://tenant.example.com',
  email: 'user@example.com',
  scopes: ['openid', 'search'],
  expiresAt: '2026-06-16T19:20:38.000Z',
};

function fakeWorker(): WorkerService & { invokeAsync: jest.Mock } {
  return {
    invokeAsync: jest.fn(async () => true),
  } as unknown as WorkerService & { invokeAsync: jest.Mock };
}

function fakeGlean(over: Partial<Record<string, jest.Mock>> = {}): GleanService & Record<string, jest.Mock> {
  return {
    ownerId: over.ownerId ?? jest.fn(async () => 'owner-1'),
    connection: over.connection ?? jest.fn(async () => connected),
    begin: over.begin ?? jest.fn(async () => 'https://tenant.example.com/oauth/authorize?x=1'),
    complete: over.complete ?? jest.fn(async () => connected),
    disconnect: over.disconnect ?? jest.fn(async () => undefined),
    setEndpoint: over.setEndpoint ?? jest.fn(async () => undefined),
    accessToken: over.accessToken ?? jest.fn(async () => ['live-token', 'https://tenant.example.com']),
  } as unknown as GleanService & Record<string, jest.Mock>;
}

function fakeAuthz(): AuthzService & { requireUser: jest.Mock; requireAdmin: jest.Mock } {
  return {
    requireUser: jest.fn(() => undefined),
    requireAdmin: jest.fn(async () => undefined),
    requirePartnerSide: jest.fn(async () => undefined),
  } as unknown as AuthzService & { requireUser: jest.Mock; requireAdmin: jest.Mock };
}

beforeEach(() => {
  jest.clearAllMocks();
  delete process.env.AVATAR_SYNC_FUNCTION;
});

describe('GleanResolver.gleanConnection', () => {
  it('gates a signed-in user and returns the connection for the owner', async () => {
    const glean = fakeGlean();
    const authz = fakeAuthz();
    const svc = new GleanResolver(glean, fakeWorker(), authz);
    const out = await svc.gleanConnection({}, null, identity);

    expect(authz.requireUser).toHaveBeenCalledWith(identity);
    expect(glean.ownerId).toHaveBeenCalledWith('user@example.com', 'sub-1');
    expect(glean.connection).toHaveBeenCalledWith('owner-1');
    expect(out).toBe(connected);
  });
});

describe('GleanResolver.gleanBeginConnect', () => {
  it('validates the redirect and returns the authorize url', async () => {
    const glean = fakeGlean();
    const authz = fakeAuthz();
    const svc = new GleanResolver(glean, fakeWorker(), authz);
    const out = await svc.gleanBeginConnect({ redirectUri: 'https://app/cb' }, null, identity);

    expect(authz.requireUser).toHaveBeenCalledWith(identity);
    expect(glean.begin).toHaveBeenCalledWith('owner-1', 'https://app/cb');
    expect(out).toEqual({ url: 'https://tenant.example.com/oauth/authorize?x=1' });
  });
});

describe('GleanResolver.gleanCompleteConnect', () => {
  it('exchanges the code/state and returns the connection', async () => {
    const glean = fakeGlean();
    const svc = new GleanResolver(glean, fakeWorker(), fakeAuthz());
    const out = await svc.gleanCompleteConnect({ code: 'c', state: 's' }, null, identity);

    expect(glean.complete).toHaveBeenCalledWith('owner-1', 'c', 's');
    expect(out).toBe(connected);
  });

  it('dispatches a self-only avatar sync to the worker without blocking connect', async () => {
    process.env.AVATAR_SYNC_FUNCTION = 'avatar-sync-example';
    const worker = fakeWorker();
    const glean = fakeGlean();
    const svc = new GleanResolver(glean, worker, fakeAuthz());
    await svc.gleanCompleteConnect({ code: 'c', state: 's' }, null, identity);

    expect(worker.invokeAsync).toHaveBeenCalledWith('avatar-sync-example', { ownerUserId: 'owner-1', self: true });
  });

  it('skips the avatar dispatch (no throw) when AVATAR_SYNC_FUNCTION is unset', async () => {
    const worker = fakeWorker();
    const svc = new GleanResolver(fakeGlean(), worker, fakeAuthz());
    const out = await svc.gleanCompleteConnect({ code: 'c', state: 's' }, null, identity);

    expect(worker.invokeAsync).not.toHaveBeenCalled();
    expect(out).toBe(connected);
  });
});

describe('GleanResolver.gleanDisconnect', () => {
  it('disconnects the owner and returns the refreshed connection', async () => {
    const glean = fakeGlean();
    const svc = new GleanResolver(glean, fakeWorker(), fakeAuthz());
    const out = await svc.gleanDisconnect({}, null, identity);

    expect(glean.disconnect).toHaveBeenCalledWith('owner-1');
    expect(glean.connection).toHaveBeenCalledWith('owner-1');
    expect(out).toBe(connected);
  });
});

describe('GleanResolver.gleanSetEndpoint', () => {
  it('requires admin and sets the endpoint with the caller email', async () => {
    const glean = fakeGlean();
    const authz = fakeAuthz();
    const svc = new GleanResolver(glean, fakeWorker(), authz);
    await svc.gleanSetEndpoint({ baseUrl: 'https://new.example.com' }, null, identity);

    expect(authz.requireAdmin).toHaveBeenCalledWith(identity);
    expect(glean.setEndpoint).toHaveBeenCalledWith('https://new.example.com', 'user@example.com');
  });
});

describe('GleanResolver.gleanToken (op:glean_token)', () => {
  it('resolves the owner then returns a live access_token + base', async () => {
    const glean = fakeGlean();
    const svc = new GleanResolver(glean, fakeWorker(), fakeAuthz());
    const out = await svc.gleanToken({ email: 'rpc@example.com', sub: 'rpc-sub' }, null, {});

    expect(glean.ownerId).toHaveBeenCalledWith('rpc@example.com', 'rpc-sub');
    expect(glean.accessToken).toHaveBeenCalledWith('owner-1');
    expect(out).toEqual({ access_token: 'live-token', base: 'https://tenant.example.com' });
  });
});
