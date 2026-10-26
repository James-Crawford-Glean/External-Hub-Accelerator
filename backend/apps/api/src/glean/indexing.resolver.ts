// Admin surface for the Hub -> Glean push: recent runs and an on-demand full
// re-index (which also registers the datasource). Platform code: it knows the
// indexing worker only by its run-log entity and by GLEAN_INDEX_FUNCTION (set
// by the appsync stack); unset, the trigger reports false and nothing runs.
import { AuroraService } from '@libs/aurora';
import { AuthzService, type Identity } from '@libs/authz';
import { WorkerService } from '@libs/worker';

export interface IndexRun {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  processed: number | null;
}

export class IndexingResolver {
  constructor(
    private readonly aurora: AuroraService,
    private readonly worker: WorkerService,
    private readonly authz: AuthzService,
  ) {}

  async gleanIndexRuns(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<IndexRun[]> {
    await this.authz.requireAdmin(identity);
    const limit = Math.max(1, Math.min(Number(args.limit ?? 20), 100));
    const rows = await this.aurora.query<Record<string, unknown>>(
      "SELECT id, type, status, started_at, completed_at, records_processed FROM app.sync_runs WHERE entity = 'glean-index' " +
        'ORDER BY started_at DESC LIMIT :lim',
      { lim: limit },
    );
    return rows.map((r) => ({
      id: String(r.id),
      type: String(r.type),
      status: String(r.status),
      startedAt: String(r.started_at),
      completedAt: (r.completed_at as string | null) ?? null,
      processed: r.records_processed == null ? null : Number(r.records_processed),
    }));
  }

  async triggerGleanIndex(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<boolean> {
    await this.authz.requireAdmin(identity);
    const fn = process.env.GLEAN_INDEX_FUNCTION ?? '';
    if (!fn) return false;
    return this.worker.invokeAsync(fn, { full: args.full !== false });
  }
}
