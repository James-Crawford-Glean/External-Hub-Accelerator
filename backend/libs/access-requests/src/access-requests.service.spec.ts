import { AuroraService } from '@libs/aurora';
import { AccessRequestsService } from './access-requests.service';

function fakeAurora(): { aurora: AuroraService; execute: jest.Mock; query: jest.Mock } {
  const execute = jest.fn(async () => ({}));
  const query = jest.fn(async () => []);
  return { aurora: { execute, query } as unknown as AuroraService, execute, query };
}

const LIVE = 'arn:aws:rds:us-east-1:000000000000:cluster:test';

describe('AccessRequestsService (offline)', () => {
  beforeEach(() => delete process.env.AURORA_CLUSTER_ARN);

  it('record is a no-op with no Aurora', async () => {
    const { aurora, execute } = fakeAurora();
    await new AccessRequestsService(aurora).record('a@example.com', 'A', 'sub');
    expect(execute).not.toHaveBeenCalled();
  });
  it('pending returns [] with no Aurora', async () => {
    const { aurora, query } = fakeAurora();
    expect(await new AccessRequestsService(aurora).pending()).toEqual([]);
    expect(query).not.toHaveBeenCalled();
  });
  it('clear/deny are no-ops with no Aurora', async () => {
    const { aurora, execute } = fakeAurora();
    const svc = new AccessRequestsService(aurora);
    await svc.clear('a@example.com');
    await svc.deny('a@example.com');
    expect(execute).not.toHaveBeenCalled();
  });
});

describe('AccessRequestsService (live)', () => {
  beforeEach(() => (process.env.AURORA_CLUSTER_ARN = LIVE));
  afterEach(() => delete process.env.AURORA_CLUSTER_ARN);

  it('record upserts with trimmed email + null-coalesced name/sub', async () => {
    const { aurora, execute } = fakeAurora();
    await new AccessRequestsService(aurora).record('  a@example.com  ', undefined, undefined);
    expect(execute).toHaveBeenCalledTimes(1);
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('INSERT INTO app.access_requests');
    expect(sql).toContain('ON CONFLICT (email)');
    expect(params).toEqual({ email: 'a@example.com', name: null, sub: null });
  });

  it('record skips a blank/empty email', async () => {
    const { aurora, execute } = fakeAurora();
    const svc = new AccessRequestsService(aurora);
    await svc.record('   ', 'A', 's');
    await svc.record(null, 'A', 's');
    expect(execute).not.toHaveBeenCalled();
  });

  it('pending queries the not-in-roster set, newest first', async () => {
    const { aurora, query } = fakeAurora();
    query.mockResolvedValueOnce([{ email: 'a@example.com', name: 'A', attempts: 2, first_seen: 't', last_seen: 't' }]);
    const out = await new AccessRequestsService(aurora).pending();
    expect(out).toHaveLength(1);
    const [sql] = query.mock.calls[0];
    expect(sql).toContain('NOT IN (SELECT email FROM app.access_roster)');
    expect(sql).toContain('ORDER BY last_seen DESC');
  });

  it('clear and deny both delete by lowercased email', async () => {
    const { aurora, execute } = fakeAurora();
    const svc = new AccessRequestsService(aurora);
    await svc.clear('  A@Example.com ');
    await svc.deny('B@Example.com');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[0][0]).toContain('DELETE FROM app.access_requests WHERE email = lower(:email)');
    expect(execute.mock.calls[0][1]).toEqual({ email: 'A@Example.com' });
    expect(execute.mock.calls[1][1]).toEqual({ email: 'B@Example.com' });
  });
});
