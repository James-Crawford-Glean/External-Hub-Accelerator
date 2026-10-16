// Scheduled sync of the example domain from its upstream system. One
// app.sync_runs row per execution; upserts by external_id; resolves owners to
// registry ids by email so the upstream's user ids never enter the schema.
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { once } from '@libs/di';
import { Logger } from '@libs/log';
import { AuroraService, auroraConfigFromEnv } from '@libs/aurora';
import { IdentityService } from '@libs/identity';
import { ItemsService, type UpstreamItem } from '@libs/items';
import { SyncRunsService } from '@libs/sync-runs';
import { fetchUpstream } from './upstream';

const log = new Logger('item-sync');
const aurora = once(() => new AuroraService(new RDSDataClient({}), auroraConfigFromEnv()));

export interface SyncDeps {
  items: ItemsService;
  identity: IdentityService;
  runs: SyncRunsService;
  upstream: () => Promise<UpstreamItem[]>;
}

export async function syncItems(deps: SyncDeps): Promise<{ processed: number; created: number; updated: number }> {
  return deps.runs.run('items', 'full', async (tracker) => {
    const upstream = await deps.upstream();
    const owners = await deps.identity.bulkResolveByEmail(
      upstream.map((u) => u.ownerEmail),
      { source: 'sync' },
    );
    const { created, updated } = await deps.items.upsertFromUpstream(upstream, owners);
    tracker.update({ processed: upstream.length, created, updated });
    log.log(`item-sync processed=${upstream.length} created=${created} updated=${updated}`);
    return { processed: upstream.length, created, updated };
  });
}

export async function handler(): Promise<Record<string, unknown>> {
  const a = aurora();
  return syncItems({
    items: new ItemsService(a),
    identity: new IdentityService(a),
    runs: new SyncRunsService(a),
    upstream: () => fetchUpstream(),
  });
}
