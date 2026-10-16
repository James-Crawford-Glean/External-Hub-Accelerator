import { GetCommand, PutCommand, type DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { WorkerService } from '@libs/worker';
import { CacheService, FRESH, STALE, MISS } from './cache.service';

// Fake DDB document client: a queue of GetCommand results, capturing all sends.
function fakeDdb(getItems: (Record<string, any> | null)[]): {
  ddb: DynamoDBDocumentClient;
  send: jest.Mock;
} {
  let i = 0;
  const send = jest.fn(async (cmd: any) => {
    if (cmd instanceof GetCommand) return { Item: getItems[i++] ?? null };
    return {};
  });
  return { ddb: { send } as unknown as DynamoDBDocumentClient, send };
}

function fakeWorker(): { worker: WorkerService; invokeAsync: jest.Mock } {
  const invokeAsync = jest.fn(async () => true);
  return { worker: { invokeAsync } as unknown as WorkerService, invokeAsync };
}

const nowSec = () => Math.floor(Date.now() / 1000);

describe('CacheService.cachedGet', () => {
  it('MISS on empty cache: calls loader and writes through', async () => {
    const { ddb, send } = fakeDdb([null]);
    const { worker } = fakeWorker();
    const svc = new CacheService(ddb, worker);
    const loader = jest.fn(async () => ({ name: 'Acme' }));
    const [data, status] = await svc.cachedGet('sf_accounts', 'acc_1', 'core', loader);
    expect(status).toBe(MISS);
    expect(data).toEqual({ name: 'Acme' });
    expect(loader).toHaveBeenCalledTimes(1);
    const put = send.mock.calls.find((c) => c[0] instanceof PutCommand)![0];
    expect(put.input.Item.id).toBe('acc_1');
    expect(put.input.Item.facet).toBe('core');
    expect(put.input.Item.data).toBe(JSON.stringify({ name: 'Acme' }));
    // rollups TTL is 300; expires_at = cached_at + 300*4
    expect(put.input.Item.expires_at - put.input.Item.cached_at).toBe(86400 * 4);
  });

  it('does not write through when the loader returns null', async () => {
    const { ddb, send } = fakeDdb([null]);
    const { worker } = fakeWorker();
    const svc = new CacheService(ddb, worker);
    const [data, status] = await svc.cachedGet('sf_accounts', 'acc_1', 'core', async () => null);
    expect([data, status]).toEqual([null, MISS]);
    expect(send.mock.calls.some((c) => c[0] instanceof PutCommand)).toBe(false);
  });

  it('FRESH within ttl: returns decoded data, no loader call', async () => {
    const row = { data: JSON.stringify({ name: 'Fresh Co' }), cached_at: nowSec() - 10 };
    const { ddb } = fakeDdb([row]);
    const { worker } = fakeWorker();
    const svc = new CacheService(ddb, worker);
    const loader = jest.fn(async () => ({ name: 'X' }));
    // rollups ttl = 300, age 10 -> fresh
    const [data, status] = await svc.cachedGet('sf_accounts', 'acc_1', 'rollups', loader);
    expect(status).toBe(FRESH);
    expect(data).toEqual({ name: 'Fresh Co' });
    expect(loader).not.toHaveBeenCalled();
  });

  it('STALE beyond ttl but within ttl*4: returns cached and fires async refresh', async () => {
    const row = { data: JSON.stringify({ name: 'Stale Co' }), cached_at: nowSec() - 600 };
    const { ddb } = fakeDdb([row]);
    const { worker, invokeAsync } = fakeWorker();
    process.env.CACHE_REFRESH_FN = 'refresh-fn';
    const svc = new CacheService(ddb, worker);
    const loader = jest.fn(async () => ({ name: 'X' }));
    // rollups ttl = 300, age 600 -> within 300*4=1200 -> stale
    const [data, status] = await svc.cachedGet('sf_accounts', 'acc_1', 'rollups', loader);
    expect(status).toBe(STALE);
    expect(data).toEqual({ name: 'Stale Co' });
    expect(loader).not.toHaveBeenCalled();
    expect(invokeAsync).toHaveBeenCalledWith('refresh-fn', { entity: 'sf_accounts', id: 'acc_1', facet: 'rollups' });
    delete process.env.CACHE_REFRESH_FN;
  });

  it('STALE with no CACHE_REFRESH_FN: no invoke (noop refresh)', async () => {
    const row = { data: JSON.stringify({ name: 'Stale Co' }), cached_at: nowSec() - 600 };
    const { ddb } = fakeDdb([row]);
    const { worker, invokeAsync } = fakeWorker();
    delete process.env.CACHE_REFRESH_FN;
    const svc = new CacheService(ddb, worker);
    const [, status] = await svc.cachedGet('sf_accounts', 'acc_1', 'rollups', async () => null);
    expect(status).toBe(STALE);
    expect(invokeAsync).not.toHaveBeenCalled();
  });

  it('expired beyond stale window: treated as MISS, reloads', async () => {
    const row = { data: JSON.stringify({ name: 'Old' }), cached_at: nowSec() - 5000 };
    const { ddb } = fakeDdb([row]);
    const { worker } = fakeWorker();
    const svc = new CacheService(ddb, worker);
    const loader = jest.fn(async () => ({ name: 'Reloaded' }));
    // rollups ttl 300, stale window 1200; age 5000 -> miss
    const [data, status] = await svc.cachedGet('sf_accounts', 'acc_1', 'rollups', loader);
    expect(status).toBe(MISS);
    expect(data).toEqual({ name: 'Reloaded' });
    expect(loader).toHaveBeenCalledTimes(1);
  });

  it('uses DEFAULT_TTL for an unknown facet', async () => {
    const row = { data: JSON.stringify({ v: 1 }), cached_at: nowSec() - 100 };
    const { ddb } = fakeDdb([row]);
    const { worker } = fakeWorker();
    const svc = new CacheService(ddb, worker);
    // unknown facet -> DEFAULT_TTL 300; age 100 -> fresh
    const [, status] = await svc.cachedGet('sf_accounts', 'acc_1', 'unknown', async () => null);
    expect(status).toBe(FRESH);
  });

  it('read error is swallowed -> falls through to loader (MISS)', async () => {
    const send = jest.fn(async (cmd: any) => {
      if (cmd instanceof GetCommand) throw new Error('ddb down');
      return {};
    });
    const ddb = { send } as unknown as DynamoDBDocumentClient;
    const { worker } = fakeWorker();
    const svc = new CacheService(ddb, worker);
    const [data, status] = await svc.cachedGet('sf_accounts', 'acc_1', 'core', async () => ({ ok: true }));
    expect([data, status]).toEqual([{ ok: true }, MISS]);
  });

  it('honors DDB_TABLE_PREFIX in the table name', async () => {
    const { ddb, send } = fakeDdb([null]);
    const { worker } = fakeWorker();
    process.env.DDB_TABLE_PREFIX = 'portal-test';
    const svc = new CacheService(ddb, worker);
    await svc.cachedGet('sf_accounts', 'acc_1', 'core', async () => null);
    const get = send.mock.calls[0][0];
    expect(get.input.TableName).toBe('portal-test-sf_accounts');
    delete process.env.DDB_TABLE_PREFIX;
  });
});
