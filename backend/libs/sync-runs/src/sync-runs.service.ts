// One app.sync_runs row per scheduled-job execution, shared by every worker so
// the run-tracking rule lives in exactly one place. run(entity, kind, work):
// 'running' on entry, 'success' (+counts) on clean return, 'failed' on throw
// (re-raised). AuroraService is constructor-injected.
import { randomBytes } from 'node:crypto';
import { AuroraService } from '@libs/aurora';

// shared.ids.gen('run'): <prefix>_<urlsafe-base64 of 9 random bytes> (12 chars).
// Inlined (only prefix 'run' is needed here) to match secrets.token_urlsafe(9).
function genRunId(): string {
  const b64 = randomBytes(9).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `run_${b64}`;
}

export interface RunCounts {
  processed?: number;
  created?: number;
  updated?: number;
  deleted?: number;
  remaining?: number;
}

/** Accumulates counts for one app.sync_runs row, flushed on terminal status. */
export class RunTracker {
  readonly counts: RunCounts = {};
  constructor(readonly id: string) {}

  update(counts: RunCounts): void {
    Object.assign(this.counts, counts);
  }
}

export class SyncRunsService {
  constructor(private readonly aurora: AuroraService) {}

  /** 'running' on entry, 'success' (+counts) on clean return, 'failed' on throw
   *  (the error is re-raised so the caller still sees it). */
  async run<T>(entity: string, kind: string, work: (tracker: RunTracker) => Promise<T>): Promise<T> {
    const tracker = new RunTracker(genRunId());
    await this.aurora.execute(
      'INSERT INTO app.sync_runs (id, entity, type, status, started_at) ' +
        "VALUES (:id, :entity, :type, 'running', now())",
      { id: tracker.id, entity, type: kind },
    );
    let result: T;
    try {
      result = await work(tracker);
    } catch (e) {
      await this.aurora.execute(
        "UPDATE app.sync_runs SET status = 'failed', completed_at = now() WHERE id = :id",
        { id: tracker.id },
      );
      throw e;
    }
    await this.aurora.execute(
      "UPDATE app.sync_runs SET status = 'success', completed_at = now(), " +
        'records_processed = :processed, records_created = :created, records_updated = :updated, ' +
        'records_deleted = :deleted, records_remaining = :remaining WHERE id = :id',
      {
        id: tracker.id,
        processed: tracker.counts.processed ?? null,
        created: tracker.counts.created ?? null,
        updated: tracker.counts.updated ?? null,
        deleted: tracker.counts.deleted ?? null,
        remaining: tracker.counts.remaining ?? null,
      },
    );
    return result;
  }
}
