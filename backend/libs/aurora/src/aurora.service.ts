// Aurora access via the RDS Data API (HTTPS), no VPC attachment. Raw SQL with
// named params; retries ramp linearly on a Serverless v2 auto-pause resume and
// back off exponentially with jitter on Data API throttling. A single instance is shared across
// resolvers and workers; the client is constructor-injected so tests pass a fake.
import { Logger } from '@libs/log';
import { emitDuration, startTimer, requestProperties, currentContext } from '@libs/metrics';
import {
  RDSDataClient,
  ExecuteStatementCommand,
  BatchExecuteStatementCommand,
  BeginTransactionCommand,
  CommitTransactionCommand,
  RollbackTransactionCommand,
  type SqlParameter,
} from '@aws-sdk/client-rds-data';

// The Data API caps a single statement's *result set* at 1MB (independent of the caller's
// GraphQL selection — AppSync applies the selection after the Lambda already built the full
// result). Any query that fans a jsonb_agg/array_agg subquery out per row (a record's
// embedded related rows, a join rendered as an array per row) can cross that cap
// while looking fine in dev with small seed data — the byte cost scales with row count x
// subquery fan-out, not with anything the caller controls. Surfacing the raw SDK exception
// leaves the caller with no actionable next step and no server-side breadcrumb linking the
// failure to a specific query shape; this turns it into a typed, loggable, user-actionable
// error instead. See mappings.resolver.ts accountsById/leanAccountsById for the fix pattern
// (project only the columns the caller actually reads) once a query trips this.
export class DatasetTooLargeError extends Error {
  readonly name = 'DatasetTooLargeError';
  constructor(
    message: string,
    readonly context: { field?: string; requestId?: string; sqlPreview: string; paramCount: number },
  ) {
    super(message);
  }
}

function isUnsupportedResult(e: unknown): boolean {
  const err = e as { name?: string; __type?: string } | undefined;
  return err?.name === 'UnsupportedResultException' || err?.__type === 'UnsupportedResultException';
}

export interface AuroraConfig {
  resourceArn: string;
  secretArn: string;
  database: string;
}

export type ParamValue = string | number | boolean | null;
export type Params = Record<string, ParamValue>;

// Aurora config from env (set by Terraform, same vars as the Python lib). Read at
// container-build time, not module load, so importing this lib never requires the env.
export function auroraConfigFromEnv(): AuroraConfig {
  const resourceArn = process.env.AURORA_CLUSTER_ARN;
  const secretArn = process.env.AURORA_SECRET_ARN;
  if (!resourceArn || !secretArn) {
    throw new Error('AURORA_CLUSTER_ARN and AURORA_SECRET_ARN are required');
  }
  return { resourceArn, secretArn, database: process.env.AURORA_DATABASE || 'portal' };
}

const RETRY_MAX = 6;
const RESUME_BACKOFF_S = 5; // linear ramp; covers the ~30s ACU resume
const THROTTLE_CODES = new Set([
  'ThrottlingException',
  'TooManyRequestsException',
  'ServiceUnavailableError',
  'RequestTimeout',
  'InternalServerErrorException',
]);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class AuroraService {
  private readonly log = new Logger(AuroraService.name);

  constructor(
    private readonly client: RDSDataClient,
    private readonly cfg: AuroraConfig,
  ) {}

  /** Data API timestamp ('2026-06-16 19:20:38.144955[+00]') -> AWSDateTime
   *  (ISO-8601 with a timezone designator). AppSync rejects the raw form. */
  static iso8601(ts?: string | null): string | null {
    if (!ts) return null;
    let s = ts.trim().replace(' ', 'T'); // Data API separates date/time with a space
    const timePart = s.slice(11);
    const hasTz = /([Zz]|[+-]\d{2}(:?\d{2})?)$/.test(timePart);
    if (!hasTz) s += 'Z';
    else s = s.replace(/([+-]\d{2})$/, '$1:00'); // pad bare +00 -> +00:00
    const d = new Date(s);
    return isNaN(d.getTime()) ? null : d.toISOString();
  }

  /** JS value -> Data API typed parameter. Timestamps are passed as strings and
   *  cast in SQL (`:x::timestamptz`). The Data API has no array type — callers
   *  expand IN-lists to scalar params (IN (:x0, :x1)). */
  private param(name: string, value: ParamValue): SqlParameter {
    if (value === null || value === undefined) return { name, value: { isNull: true } };
    if (typeof value === 'boolean') return { name, value: { booleanValue: value } };
    if (typeof value === 'number') {
      return Number.isInteger(value)
        ? { name, value: { longValue: value } }
        : { name, value: { doubleValue: value } };
    }
    return { name, value: { stringValue: String(value) } };
  }

  private params(d: Params): SqlParameter[] {
    return Object.entries(d).map(([k, v]) => this.param(k, v));
  }

  /** Retry on auto-pause resume (linear) and Data-API throttling (exponential +
   *  jitter). Anything else propagates immediately. */
  private async withRetry<T>(fn: () => Promise<T>): Promise<T> {
    let last: unknown;
    for (let attempt = 1; attempt <= RETRY_MAX; attempt++) {
      try {
        return await fn();
      } catch (e: any) {
        last = e;
        const code: string = e?.name || e?.Code || e?.__type || '';
        let wait: number;
        if (code.includes('DatabaseResuming') || String(e).includes('DatabaseResuming')) {
          wait = RESUME_BACKOFF_S * attempt;
        } else if ([...THROTTLE_CODES].some((c) => code.includes(c))) {
          wait = Math.min(2 ** attempt, 30);
        } else {
          throw e;
        }
        wait += Math.random() * (wait / 2);
        this.log.log(`aurora.retry code=${code || 'resuming'} attempt=${attempt} sleep=${wait.toFixed(1)}s`);
        await sleep(wait * 1000);
      }
    }
    throw last;
  }

  /** Time a DB call and emit AuroraCallDuration (best-effort). Duration includes retry/
   *  resume waits, which is the real client-observed DB latency. */
  private async timed<T>(kind: string, fn: () => Promise<T>): Promise<T> {
    const timer = startTimer();
    try {
      return await fn();
    } finally {
      emitDuration('AuroraCallDuration', timer.stop(), { kind }, requestProperties());
    }
  }

  /** Run one statement (DDL/DML). Pass `tx` to enroll it in a transaction. */
  async execute(sql: string, params?: Params, opts: { tx?: string } = {}): Promise<unknown> {
    return this.timed('execute', () =>
      this.withRetry(() =>
        this.client.send(
          new ExecuteStatementCommand({
            ...this.cfg,
            sql,
            ...(params ? { parameters: this.params(params) } : {}),
            ...(opts.tx ? { transactionId: opts.tx } : {}),
          }),
        ),
      ),
    );
  }

  /** SELECT -> row dicts. formatRecordsAs=JSON returns column names without
   *  hand-mapping columnMetadata. Translates the Data API's 1MB result-set cap into a typed,
   *  loggable error (see DatasetTooLargeError) instead of letting the raw SDK exception reach
   *  the caller — that cap is per-statement result bytes, unrelated to the GraphQL selection
   *  the client asked for, so a bare `errorMessage` gives neither the caller nor us-on-call
   *  anything to act on. */
  async query<T = Record<string, any>>(sql: string, params?: Params): Promise<T[]> {
    let resp: any;
    try {
      resp = await this.timed('query', () =>
        this.withRetry(() =>
          this.client.send(
            new ExecuteStatementCommand({
              ...this.cfg,
              sql,
              formatRecordsAs: 'JSON',
              ...(params ? { parameters: this.params(params) } : {}),
            }),
          ),
        ),
      );
    } catch (e) {
      if (!isUnsupportedResult(e)) throw e;
      const { field, requestId } = currentContext();
      const paramCount = params ? Object.keys(params).length : 0;
      const sqlPreview = sql.slice(0, 200);
      // ERROR (not warn): this always means a user-visible request failed, even though the
      // underlying data/work is very likely fine (the *write* already committed — this is a
      // read blowing the result cap, not a mutation rolling back).
      this.log.error(
        `aurora.result_too_large field=${field ?? 'unknown'} requestId=${requestId ?? 'none'} ` +
          `paramCount=${paramCount} sql=${JSON.stringify(sqlPreview)}`,
      );
      throw new DatasetTooLargeError(
        'This request returned more data than the platform can return in one response. ' +
          'Try narrowing the request (fewer ids, a smaller page, or added filters) and try again.',
        { field, requestId, sqlPreview, paramCount },
      );
    }
    return JSON.parse(resp?.formattedRecords || '[]');
  }

  /** Atomic unit of work: commits on clean return, rolls back on throw. */
  async transaction<T>(work: (tx: string) => Promise<T>): Promise<T> {
    const begun: any = await this.withRetry(() => this.client.send(new BeginTransactionCommand({ ...this.cfg })));
    const tx: string = begun.transactionId;
    try {
      const result = await work(tx);
      await this.client.send(
        new CommitTransactionCommand({ resourceArn: this.cfg.resourceArn, secretArn: this.cfg.secretArn, transactionId: tx }),
      );
      return result;
    } catch (e) {
      await this.client.send(
        new RollbackTransactionCommand({ resourceArn: this.cfg.resourceArn, secretArn: this.cfg.secretArn, transactionId: tx }),
      );
      throw e;
    }
  }

  /** BatchExecuteStatement for a parameterized upsert/delete. Every set must
   *  carry the same named params. Returns rows submitted. */
  async batch(sql: string, paramSets: Params[], chunk = 100, opts: { tx?: string } = {}): Promise<number> {
    return this.timed('batch', async () => {
      let n = 0;
      for (let i = 0; i < paramSets.length; i += chunk) {
        const window = paramSets.slice(i, i + chunk);
        await this.withRetry(() =>
          this.client.send(
            new BatchExecuteStatementCommand({
              ...this.cfg,
              sql,
              parameterSets: window.map((p) => this.params(p)),
              ...(opts.tx ? { transactionId: opts.tx } : {}),
            }),
          ),
        );
        n += window.length;
      }
      return n;
    });
  }
}
