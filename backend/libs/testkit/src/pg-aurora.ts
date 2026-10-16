// Test-only: run the REAL AuroraService + resolvers against an embedded Postgres
// (pglite) instead of the RDS Data API. AuroraService takes a constructor-injected
// RDSDataClient, so a fake client that translates the Data API commands to pglite
// lets every resolver's production SQL execute unmodified — the strongest way to
// prove tile/filter calculations are correct on known fixtures.
import { PGlite } from '@electric-sql/pglite';
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm';
import { AuroraService } from '@libs/aurora';
import { MIGRATIONS } from '../../../apps/workers/migrate/src/migrations.generated';

// SqlParameter value -> JS. Mirrors the shapes AuroraService.params() emits.
function paramValue(v: Record<string, any>): unknown {
  if (v.isNull) return null;
  if (v.stringValue !== undefined) return v.stringValue;
  if (v.longValue !== undefined) return v.longValue;
  if (v.doubleValue !== undefined) return v.doubleValue;
  if (v.booleanValue !== undefined) return v.booleanValue;
  return null;
}

// :name -> $n. Negative lookbehind avoids matching the second ':' of a '::type'
// cast; repeated params reuse one placeholder index.
function bind(sql: string, params: Array<{ name?: string; value?: any }>): { text: string; values: unknown[] } {
  const byName = new Map<string, unknown>();
  for (const p of params) if (p.name) byName.set(p.name, paramValue(p.value ?? {}));
  const order: string[] = [];
  const text = sql.replace(/(?<!:):([a-zA-Z_][a-zA-Z0-9_]*)/g, (_m, name: string) => {
    let i = order.indexOf(name);
    if (i === -1) {
      order.push(name);
      i = order.length - 1;
    }
    return `$${i + 1}`;
  });
  return { text, values: order.map((n) => byName.get(n) ?? null) };
}

// Minimal RDSDataClient stand-in: handles the four commands AuroraService issues.
function fakeClient(db: PGlite): { send: (cmd: any) => Promise<any> } {
  return {
    async send(cmd: any) {
      const kind = cmd?.constructor?.name ?? '';
      const input = cmd?.input ?? {};
      if (kind === 'BeginTransactionCommand') return { transactionId: 'tx' };
      if (kind === 'CommitTransactionCommand' || kind === 'RollbackTransactionCommand') return { transactionStatus: 'ok' };
      if (kind === 'BatchExecuteStatementCommand') {
        for (const set of input.parameterSets ?? []) {
          const { text, values } = bind(input.sql, set);
          await db.query(text, values);
        }
        return {};
      }
      // ExecuteStatementCommand
      const { text, values } = bind(input.sql, input.parameters ?? []);
      const res = await db.query(text, values);
      if (input.formatRecordsAs === 'JSON') return { formattedRecords: JSON.stringify(res.rows ?? []) };
      return { numberOfRecordsUpdated: res.affectedRows ?? 0 };
    },
  };
}

export interface PgAurora {
  aurora: AuroraService;
  db: PGlite;
  /** Run raw SQL for fixture seeding. */
  exec: (sql: string) => Promise<void>;
  close: () => Promise<void>;
}

// Boot pglite, apply the real migrations, return a pglite-backed AuroraService.
export async function pgAurora(): Promise<PgAurora> {
  const db = await PGlite.create({ extensions: { pg_trgm } });
  for (const m of MIGRATIONS) {
    try {
      await db.exec(m.sql);
    } catch (e) {
      throw new Error(`migration ${m.file} failed on pglite: ${(e as Error).message}`);
    }
  }
  const aurora = new AuroraService(fakeClient(db) as never, {
    resourceArn: 'test',
    secretArn: 'test',
    database: 'test',
  });
  return { aurora, db, exec: (sql) => db.exec(sql).then(() => undefined), close: () => db.close() };
}
