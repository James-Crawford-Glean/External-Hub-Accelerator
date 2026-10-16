// Read-through DynamoDB cache with stale-while-revalidate, for projections of
// slow upstream systems.
//
// Per-facet TTL (table below). First request for a (entity, id, facet) tuple blocks
// on the loader (the upstream call); subsequent requests within the fresh window return
// immediately. Beyond fresh but within stale, returns cached data and kicks off an
// async refresh (CACHE_REFRESH_FN — unset leaves cold starts and stale revalidation
// both feeling real). Status: 'fresh' (within ttl), 'stale' (within ttl*4), 'miss'
// (blocked). Surfaced via X-Cache-Status in REST and a top-level extension in GraphQL.
//
// The DynamoDBDocumentClient is constructor-injected so tests pass a fake; the table
// prefix is read lazily inside methods (DDB_TABLE_PREFIX), never at module load.
import { Logger } from '@libs/log';
import { GetCommand, PutCommand, DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { WorkerService } from '@libs/worker';

// unit: seconds. add new entries as facets land.
export const TTL: Record<string, number> = {
  'sf_accounts.core': 86400, // name/domain/industry/employees/segment — daily-ish
  'sf_accounts.ownership': 3600, // ae_id, manager_id — hourly-ish
  'sf_accounts.rollups': 300, // open$, closedWon$, oppCount — 5min baseline
  'sf_accounts.lastActivityAt': 300,
  'sf_opportunities.full': 300, // active deals
  'sf_opportunities.closed': 86400, // frozen historical
  'sf_user_directory.core': 86400, // ae/manager directory
  'enrichment_cache.logo': 2592000, // 30d
  'enrichment_cache.website': 2592000,
};
export const DEFAULT_TTL = 300;
export const STALE_MULTIPLIER = 4;

export const FRESH = 'fresh';
export const STALE = 'stale';
export const MISS = 'miss';
export type CacheStatus = typeof FRESH | typeof STALE | typeof MISS;

type Row = Record<string, any>;

export class CacheService {
  private readonly log = new Logger(CacheService.name);

  constructor(
    private readonly ddb: DynamoDBDocumentClient = DynamoDBDocumentClient.from(new DynamoDBClient({})),
    private readonly worker: WorkerService,
  ) {}

  private tableName(entity: string): string {
    const prefix = process.env.DDB_TABLE_PREFIX || 'portal-local';
    return `${prefix}-${entity}`;
  }

  /** Read-through cache. Returns [data, status]. */
  async cachedGet(
    entity: string,
    itemId: string,
    facet: string,
    loader: () => Promise<Record<string, any> | null>,
  ): Promise<[Record<string, any> | null, CacheStatus]> {
    const ttl = TTL[`${entity}.${facet}`] ?? DEFAULT_TTL;
    const now = Math.floor(Date.now() / 1000);

    const row = await this.read(entity, itemId, facet);
    if (row) {
      const age = now - Number(row.cached_at ?? 0);
      const cached = this.decode(row.data);
      if (age <= ttl) return [cached, FRESH];
      if (age <= ttl * STALE_MULTIPLIER) {
        await this.asyncRefresh(entity, itemId, facet);
        return [cached, STALE];
      }
    }

    const data = await loader();
    if (data != null) await this.write(entity, itemId, facet, data, now, ttl);
    return [data, MISS];
  }

  /** `data` is stored as a JSON string (see write); parse it back. */
  private decode(raw: any): Record<string, any> | null {
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return null;
      }
    }
    return raw ?? null;
  }

  private async read(entity: string, itemId: string, facet: string): Promise<Row | null> {
    try {
      const resp: any = await this.ddb.send(
        new GetCommand({ TableName: this.tableName(entity), Key: { id: itemId, facet } }),
      );
      return resp?.Item ?? null;
    } catch (e) {
      this.log.error(`cache.read_error entity=${entity} id=${itemId} facet=${facet}`, e as Error);
      return null;
    }
  }

  private async write(
    entity: string,
    itemId: string,
    facet: string,
    data: Record<string, any>,
    cachedAt: number,
    ttl: number,
  ): Promise<void> {
    try {
      await this.ddb.send(
        new PutCommand({
          TableName: this.tableName(entity),
          Item: {
            id: itemId,
            facet,
            // JSON string, not a map: the projection carries floats (rollups,
            // amounts); a string round-trips cleanly without number coercion.
            data: JSON.stringify(data),
            cached_at: cachedAt,
            expires_at: cachedAt + ttl * STALE_MULTIPLIER, // ddb prunes well after our stale window
          },
        }),
      );
    } catch (e) {
      this.log.error(`cache.write_error entity=${entity} id=${itemId} facet=${facet}`, e as Error);
    }
  }

  /** Kick off the refresh Lambda; noop when CACHE_REFRESH_FN is unset. */
  private async asyncRefresh(entity: string, itemId: string, facet: string): Promise<void> {
    const fn = process.env.CACHE_REFRESH_FN || '';
    if (!fn) return;
    try {
      await this.worker.invokeAsync(fn, { entity, id: itemId, facet });
    } catch (e) {
      this.log.error(`cache.refresh_invoke_error entity=${entity} id=${itemId} facet=${facet}`, e as Error);
    }
  }
}
