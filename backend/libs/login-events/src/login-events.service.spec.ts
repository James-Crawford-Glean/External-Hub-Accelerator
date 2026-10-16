import { AuroraService } from '@libs/aurora';
import { LoginEventsService } from './login-events.service';

function fakeAurora(): { aurora: AuroraService; execute: jest.Mock; query: jest.Mock } {
  const execute = jest.fn(async () => ({}));
  const query = jest.fn(async () => []);
  return { aurora: { execute, query } as unknown as AuroraService, execute, query };
}

const LIVE = 'arn:aws:rds:us-east-1:000000000000:cluster:test';

describe('LoginEventsService (offline)', () => {
  beforeEach(() => delete process.env.AURORA_CLUSTER_ARN);

  it('record is a no-op with no Aurora', async () => {
    const { aurora, execute } = fakeAurora();
    await new LoginEventsService(aurora).record('a@example.com', 'sub', 'UA');
    expect(execute).not.toHaveBeenCalled();
  });
  it('query helpers return empty with no Aurora', async () => {
    const { aurora, query } = fakeAurora();
    const svc = new LoginEventsService(aurora);
    expect(await svc.recent()).toEqual([]);
    expect(await svc.forEmail('a@example.com')).toEqual([]);
    expect(await svc.countForEmail('a@example.com')).toBe(0);
    expect(query).not.toHaveBeenCalled();
  });
});

describe('LoginEventsService (live)', () => {
  beforeEach(() => (process.env.AURORA_CLUSTER_ARN = LIVE));
  afterEach(() => delete process.env.AURORA_CLUSTER_ARN);

  it('record inserts with trimmed email, null-coalesced sub, capped UA', async () => {
    const { aurora, execute } = fakeAurora();
    await new LoginEventsService(aurora).record('  a@example.com ', undefined, '  Mozilla/5.0  ');
    const [sql, params] = execute.mock.calls[0];
    expect(sql).toContain('INSERT INTO app.login_events (email, sub, user_agent)');
    expect(params).toEqual({ email: 'a@example.com', sub: null, ua: 'Mozilla/5.0' });
  });

  it('record caps the user agent to 512 chars', async () => {
    const { aurora, execute } = fakeAurora();
    const long = 'x'.repeat(1000);
    await new LoginEventsService(aurora).record('a@example.com', 's', long);
    expect(execute.mock.calls[0][1].ua).toHaveLength(512);
  });

  it('record maps an empty user agent to null', async () => {
    const { aurora, execute } = fakeAurora();
    await new LoginEventsService(aurora).record('a@example.com', 's', '   ');
    expect(execute.mock.calls[0][1].ua).toBeNull();
  });

  it('record skips a blank email', async () => {
    const { aurora, execute } = fakeAurora();
    await new LoginEventsService(aurora).record('  ', 's', 'UA');
    expect(execute).not.toHaveBeenCalled();
  });

  it('recent selects newest-first with a limit', async () => {
    const { aurora, query } = fakeAurora();
    await new LoginEventsService(aurora).recent(25);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain('ORDER BY created_at DESC LIMIT :limit');
    expect(params).toEqual({ limit: 25 });
  });

  it('forEmail filters by lowercased email', async () => {
    const { aurora, query } = fakeAurora();
    await new LoginEventsService(aurora).forEmail(' A@Example.com ', 5);
    expect(query.mock.calls[0][0]).toContain('WHERE email = lower(:email)');
    expect(query.mock.calls[0][1]).toEqual({ email: 'A@Example.com', limit: 5 });
  });

  it('countForEmail returns the scalar count', async () => {
    const { aurora, query } = fakeAurora();
    query.mockResolvedValueOnce([{ n: 7 }]);
    expect(await new LoginEventsService(aurora).countForEmail('a@example.com')).toBe(7);
  });
});
