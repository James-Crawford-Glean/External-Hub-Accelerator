// Embedded Metric Format (EMF) emitter: one JSON line to stdout that CloudWatch parses into
// custom metrics — no CloudWatch SDK and no extra IAM (basic-exec `logs:PutLogEvents` covers
// it). Mirrors libs/log's "one console line = one CloudWatch event" convention.
//
// Every metric is stamped with release dimensions `env` + `version` (from APP_ENV/APP_VERSION,
// injected at deploy) so metrics are sliceable by release. Emission is best-effort and never
// throws: telemetry must not break a request. The namespace comes from PERF_METRICS_NAMESPACE
// and must match the observability stack's perf_metrics_namespace input.
import { performance } from 'node:perf_hooks';

export type Unit = 'Milliseconds' | 'Count' | 'Bytes' | 'None';

export const PERF_NAMESPACE = process.env.PERF_METRICS_NAMESPACE || 'Portal/Perf';

export interface Metric {
  name: string;
  value: number;
  unit?: Unit;
}

export interface EmfEvent {
  namespace: string;
  metrics: Metric[];
  /** Dimension key→value pairs; metrics are grouped by these. Keep low-cardinality. */
  dimensions?: Record<string, string>;
  /** Extra searchable fields that are NOT dimensions (e.g. requestId). */
  properties?: Record<string, string | number | boolean>;
  /** Epoch ms; injectable for tests. Defaults to Date.now(). */
  timestamp?: number;
}

// `env` is a metric DIMENSION so metrics filter/group by environment. `version` (git SHA) is
// emitted as a PROPERTY, not a dimension — it changes every deploy, and a per-release dimension
// would multiply CloudWatch custom-metric cardinality (billed per unique dimension combo,
// independent of traffic). As a property it stays searchable in Logs Insights and joinable, and
// RUM carries release separately.
function envDimension(): Record<string, string> {
  return { env: process.env.APP_ENV ?? 'unknown' };
}

function releaseProperties(): Record<string, string> {
  return { version: process.env.APP_VERSION ?? 'unknown' };
}

export function emitEmf(event: EmfEvent): void {
  try {
    const dimensions = { ...envDimension(), ...(event.dimensions ?? {}) };
    const properties = { ...releaseProperties(), ...(event.properties ?? {}) };
    const line: Record<string, unknown> = {
      _aws: {
        Timestamp: event.timestamp ?? Date.now(),
        CloudWatchMetrics: [
          {
            Namespace: event.namespace,
            Dimensions: [Object.keys(dimensions)],
            Metrics: event.metrics.map((m) => ({ Name: m.name, Unit: m.unit ?? 'None' })),
          },
        ],
      },
      ...dimensions,
      ...properties,
    };
    for (const m of event.metrics) line[m.name] = m.value;
    console.log(JSON.stringify(line));
  } catch {
    // best-effort: a metric that can't be serialized must not surface to the caller
  }
}

/** Convenience for the common case: a single duration metric in the perf namespace. */
export function emitDuration(
  name: string,
  ms: number,
  dimensions?: Record<string, string>,
  properties?: Record<string, string | number | boolean>,
): void {
  emitEmf({
    namespace: PERF_NAMESPACE,
    metrics: [{ name, value: Math.round(ms), unit: 'Milliseconds' }],
    dimensions,
    properties,
  });
}

export interface Timer {
  /** Elapsed milliseconds since the timer started (monotonic). */
  stop(): number;
}

export function startTimer(): Timer {
  const t0 = performance.now();
  return { stop: () => performance.now() - t0 };
}
