import { AuroraService } from '@libs/aurora';
import { SyncRunsService, RunTracker } from './sync-runs.service';

function fakeAurora(): { aurora: AuroraService; execute: jest.Mock } {
  const execute = jest.fn(async () => ({}));
  return { aurora: { execute } as unknown as AuroraService, execute };
}

describe('SyncRunsService.run', () => {
  it("inserts 'running' then updates 'success' with accumulated counts", async () => {
    const { aurora, execute } = fakeAurora();
    const svc = new SyncRunsService(aurora);
    const out = await svc.run('accounts', 'scheduled', async (t) => {
      t.update({ processed: 10, created: 3 });
      t.update({ updated: 2 });
      return 'done';
    });
    expect(out).toBe('done');
    expect(execute).toHaveBeenCalledTimes(2);

    const [insertSql, insertParams] = execute.mock.calls[0];
    expect(insertSql).toContain('INSERT INTO app.sync_runs');
    expect(insertSql).toContain("'running'");
    expect(insertParams.entity).toBe('accounts');
    expect(insertParams.type).toBe('scheduled');
    expect(insertParams.id).toMatch(/^run_[A-Za-z0-9_-]{12}$/);

    const [okSql, okParams] = execute.mock.calls[1];
    expect(okSql).toContain("status = 'success'");
    expect(okParams).toEqual({
      id: insertParams.id,
      processed: 10,
      created: 3,
      updated: 2,
      deleted: null,
      remaining: null,
    });
  });

  it("marks 'failed' and re-raises on a thrown error", async () => {
    const { aurora, execute } = fakeAurora();
    const svc = new SyncRunsService(aurora);
    await expect(
      svc.run('logos', 'enrich', async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
    expect(execute).toHaveBeenCalledTimes(2);
    expect(execute.mock.calls[1][0]).toContain("status = 'failed'");
    // same run id threaded through insert + failure update
    expect(execute.mock.calls[1][1].id).toBe(execute.mock.calls[0][1].id);
  });

  it('defaults unset counts to null on success', async () => {
    const { aurora, execute } = fakeAurora();
    const svc = new SyncRunsService(aurora);
    await svc.run('accounts', 'scheduled', async () => undefined);
    expect(execute.mock.calls[1][1]).toMatchObject({
      processed: null,
      created: null,
      updated: null,
      deleted: null,
      remaining: null,
    });
  });

  it('RunTracker merges successive update() calls', () => {
    const t = new RunTracker('run_x');
    t.update({ processed: 1 });
    t.update({ processed: 5, created: 2 });
    expect(t.counts).toEqual({ processed: 5, created: 2 });
  });
});
