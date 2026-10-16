// Keep-alive warmer. EventBridge fires this on the schedule the warmer stack
// sets; it reads app.warmer_config (admin-editable) and, when enabled, fires
// `concurrency` parallel warmup pings at each request-path target (GraphQL
// dispatcher + glean-stream) so >=N sandboxes stay warm. No-ops when
// disabled. Targets short-circuit on {warmup:true} before any Aurora/auth work.
import { LambdaClient, InvokeCommand } from '@aws-sdk/client-lambda';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { once } from '@libs/di';
import { Logger } from '@libs/log';
import { AuroraService, auroraConfigFromEnv } from '@libs/aurora';

const log = new Logger('warmer');
const auroraOnce = once(() => new AuroraService(new RDSDataClient({}), auroraConfigFromEnv()));
let lambda: LambdaClient | null = null;
const client = (): LambdaClient => (lambda ??= new LambdaClient({}));

export async function handler(): Promise<Record<string, unknown>> {
  const aurora = auroraOnce();
  const rows = await aurora.query<Record<string, any>>('SELECT enabled, concurrency FROM app.warmer_config WHERE id = true');
  const cfg = rows[0] ?? { enabled: true, concurrency: 2 };
  if (!cfg.enabled) {
    log.log('warmer disabled — skipping');
    return { skipped: true };
  }
  const n = Math.max(0, Math.min(20, Number(cfg.concurrency ?? 2)));
  const targets = [process.env.APPSYNC_FN, process.env.STREAM_FN].filter(Boolean) as string[];
  const payload = Buffer.from(JSON.stringify({ warmup: true, source: 'portal.warmer' }));

  let ok = 0;
  let fail = 0;
  await Promise.all(
    targets.flatMap((fn) =>
      Array.from({ length: n }, () =>
        client()
          .send(new InvokeCommand({ FunctionName: fn, Payload: payload }))
          .then(() => {
            ok++;
          })
          .catch((e) => {
            fail++;
            log.warn(`warm ${fn} failed: ${String(e)}`);
          }),
      ),
    ),
  );
  log.log(`warmed targets=${targets.length} concurrency=${n} ok=${ok} fail=${fail}`);
  return { targets: targets.length, concurrency: n, ok, fail };
}
