// Hub -> Glean push: indexes the example domain's items into a custom Glean
// datasource so they appear in Glean search and as chat context. Runs on a
// schedule (incremental: rows changed since the last successful push) and on
// demand from the admin screen with { full: true } (bulk replace, which also
// registers the datasource).
//
// Permissions: items with a NULL visibility role are visible to every user of
// the datasource; role-restricted items are indexed for their owner only, so
// Glean never shows a restricted record to someone the portal would not.
// DRAFT and REJECTED rows are never indexed; a row that leaves the live states
// is deleted from the index on the next incremental run.
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { once } from '@libs/di';
import { Logger } from '@libs/log';
import { AuroraService, auroraConfigFromEnv } from '@libs/aurora';
import { GleanIndexClient, type DocumentPermissions, type IndexDocument } from '@libs/glean-index';
import { ItemsService, LIVE_STATUSES, type ItemRow } from '@libs/items';
import { SyncRunsService } from '@libs/sync-runs';

const log = new Logger('glean-index');
const OBJECT_TYPE = 'Item';

const aurora = once(() => new AuroraService(new RDSDataClient({}), auroraConfigFromEnv()));
const secrets = once(() => new SecretsManagerClient({}));

async function indexingToken(): Promise<string> {
  const id = process.env.GLEAN_INDEXING_TOKEN_SECRET;
  if (!id) throw new Error('GLEAN_INDEXING_TOKEN_SECRET is unset');
  const resp = await secrets().send(new GetSecretValueCommand({ SecretId: id }));
  return resp.SecretString ?? '';
}

export interface IndexConfig {
  datasource: string;
  displayName: string;
  portalUrl: string; // https://<spa_domain>/<app>
}

export function configFromEnv(env: NodeJS.ProcessEnv = process.env): IndexConfig {
  const datasource = env.GLEAN_DATASOURCE ?? '';
  const portalUrl = (env.PORTAL_APP_URL ?? '').replace(/\/+$/, '');
  if (!datasource) throw new Error('GLEAN_DATASOURCE is unset');
  if (!portalUrl) throw new Error('PORTAL_APP_URL is unset');
  return { datasource, displayName: env.PORTAL_NAME || 'Portal', portalUrl };
}

const isLive = (r: ItemRow): boolean => LIVE_STATUSES.includes(r.status);

export function toDocument(item: ItemRow, cfg: IndexConfig): IndexDocument {
  const permissions: DocumentPermissions =
    item.visibility_role == null
      ? { allowAllDatasourceUsersAccess: true }
      : { allowedUsers: item.owner_email ? [{ email: item.owner_email }] : [] };
  const lines = [
    item.description ?? '',
    item.category ? `Category: ${item.category}` : '',
    item.status !== 'ACTIVE' ? `Status: ${item.status}` : '',
    item.owner_name ? `Owner: ${item.owner_name}` : '',
    item.website ? `Website: ${item.website}` : '',
  ].filter(Boolean);
  return {
    id: item.id,
    objectType: OBJECT_TYPE,
    title: item.name,
    body: lines.join('\n'),
    viewUrl: `${cfg.portalUrl}/items/${item.id}`,
    permissions,
    updatedAt: new Date(item.updated_at),
    createdAt: new Date(item.created_at),
    ...(item.owner_email ? { owner: { email: item.owner_email } } : {}),
    customProperties: [
      ...(item.category ? [{ name: 'category', value: item.category }] : []),
      { name: 'status', value: item.status },
    ],
  };
}

export interface PushDeps {
  items: ItemsService;
  runs: SyncRunsService;
  client: GleanIndexClient;
  cfg: IndexConfig;
  lastSuccess: () => Promise<string | null>;
}

export async function pushItems(deps: PushDeps, opts: { full?: boolean } = {}): Promise<{ indexed: number; mode: string }> {
  return deps.runs.run('glean-index', opts.full ? 'full' : 'incremental', async (tracker) => {
    if (opts.full) {
      await deps.client.addDatasource({
        name: deps.cfg.datasource,
        displayName: deps.cfg.displayName,
        urlRegex: `${deps.cfg.portalUrl.replaceAll('.', '\\.')}/items/.*`,
        homeUrl: deps.cfg.portalUrl,
        objectTypes: [{ name: OBJECT_TYPE }],
      });
      const rows = (await deps.items.changedSince(null)).filter((r) => isLive(r));
      const indexed = await deps.client.bulkIndexDocuments(rows.map((r) => toDocument(r, deps.cfg)));
      await deps.items.markIndexed(rows.map((r) => r.id));
      tracker.update({ processed: rows.length, updated: indexed });
      log.log(`glean-index full indexed=${indexed}`);
      return { indexed, mode: 'full' };
    }
    const rows = await deps.items.changedSince(await deps.lastSuccess());
    const live = rows.filter((r) => isLive(r));
    const gone = rows.filter((r) => !isLive(r));
    for (const r of live) await deps.client.indexDocument(toDocument(r, deps.cfg));
    for (const r of gone) await deps.client.deleteDocument(OBJECT_TYPE, r.id);
    await deps.items.markIndexed(live.map((r) => r.id));
    tracker.update({ processed: rows.length, updated: live.length, deleted: gone.length });
    log.log(`glean-index incremental indexed=${live.length} removed=${gone.length}`);
    return { indexed: live.length, mode: 'incremental' };
  });
}

async function lastSuccessfulPush(a: AuroraService): Promise<string | null> {
  const rows = await a.query<{ started_at: string }>(
    "SELECT started_at FROM app.sync_runs WHERE entity = 'glean-index' AND status = 'success' ORDER BY started_at DESC LIMIT 1",
  );
  return rows[0]?.started_at ?? null;
}

export async function handler(event?: { full?: boolean }): Promise<Record<string, unknown>> {
  const a = aurora();
  const cfg = configFromEnv();
  const origin = (process.env.GLEAN_BASE_URL ?? '').replace(/\/+$/, '');
  if (!origin) throw new Error('GLEAN_BASE_URL is unset');
  return pushItems(
    {
      items: new ItemsService(a),
      runs: new SyncRunsService(a),
      client: new GleanIndexClient({ origin, datasource: cfg.datasource, token: indexingToken }),
      cfg,
      lastSuccess: () => lastSuccessfulPush(a),
    },
    { full: event?.full === true },
  );
}
