// AppSync resolver Lambda. Event contract matches the appsync module's
// functions/dispatch.js: { typeName, fieldName | op, arguments, source, identity }.
import { emitDuration, startTimer, runWithContext, requestProperties } from '@libs/metrics';
import { resolvers } from './container';
import { REGISTRY } from './registry';

export interface AppSyncEvent {
  op?: string;
  typeName?: string;
  fieldName?: string;
  arguments?: Record<string, unknown>;
  source?: unknown;
  identity?: Record<string, unknown>;
  [k: string]: unknown;
}

export type ResolverFn = (
  args: Record<string, unknown>,
  source: unknown,
  identity: Record<string, unknown>,
) => unknown | Promise<unknown>;

// Testable core. Internal direct-invoke RPCs are keyed `op:<name>`; AppSync
// fields by fieldName. An unregistered field is a hard error, never a silent
// null: the schema and the registry must agree.
export async function dispatch(event: AppSyncEvent, lookup: (key: string) => ResolverFn | undefined): Promise<unknown> {
  const key = event.op ? `op:${event.op}` : event.fieldName || '';
  const fn = lookup(key);
  if (!fn) throw new Error(`no resolver registered for "${key}"`);
  return fn(event.arguments || {}, event.source, event.identity || {});
}

function lookup(key: string): ResolverFn | undefined {
  const entry = REGISTRY[key];
  if (!entry) return undefined;
  const svc = resolvers[entry.key]() as unknown as Record<string, ResolverFn>;
  return svc[entry.method].bind(svc);
}

function fieldKey(event: AppSyncEvent): string {
  return event.op ? `op:${event.op}` : event.fieldName || 'unknown';
}

// AppSync forwards request headers to the resolver event; the SPA sends a
// request id so client and server timings can be joined. Absent is fine.
function requestIdOf(event: AppSyncEvent): string | undefined {
  const headers = (event as { request?: { headers?: Record<string, string> } }).request?.headers;
  const raw = headers?.['x-request-id'] ?? headers?.['X-Request-Id'];
  return raw && raw.length <= 128 ? raw : undefined;
}

function timedLookup(key: string): ResolverFn | undefined {
  const fn = lookup(key);
  if (!fn) return undefined;
  return async (args, source, identity) => {
    const timer = startTimer();
    let ok = 'true';
    try {
      return await fn(args, source, identity);
    } catch (e) {
      ok = 'false';
      throw e;
    } finally {
      emitDuration('ResolverDuration', timer.stop(), { field: key, ok }, requestProperties());
    }
  };
}

export async function handler(event: AppSyncEvent): Promise<unknown> {
  // Keep-alive warmer ping: return before touching Aurora or auth.
  if ((event as { warmup?: boolean })?.warmup === true) return { warmed: true };
  return runWithContext({ requestId: requestIdOf(event), field: fieldKey(event) }, () =>
    dispatch(event, timedLookup),
  );
}
