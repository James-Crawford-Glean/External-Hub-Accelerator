// Aurora schema-migration worker. Invoked by the aurora-migrate stack on
// `terragrunt apply` (aws_lambda_invocation, triggered by the package hash).
// Runs every migration's statements in filename order; idempotent
// (CREATE ... IF NOT EXISTS), so re-running is a no-op.
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { once } from '@libs/di';
import { Logger } from '@libs/log';
import { AuroraService, auroraConfigFromEnv } from '@libs/aurora';
import { MIGRATIONS } from './migrations.generated';

const auroraOnce = once(() => new AuroraService(new RDSDataClient({}), auroraConfigFromEnv()));

/** Split DDL into statements on top-level ';', after stripping block and line
 *  comments. Migrations are plain DDL (no dollar-quoted function bodies). */
export function split(sql: string): string[] {
  const noBlock = sql.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock
    .split('\n')
    .map((line) => line.split('--', 1)[0] ?? '')
    .join('\n');
  return noLine
    .split(';')
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export async function handler(): Promise<{ migrations: { file: string; statements: number }[] }> {
  const log = new Logger('migrate');
  const aurora = auroraOnce();
  const applied: { file: string; statements: number }[] = [];
  for (const { file, sql } of MIGRATIONS) {
    const statements = split(sql);
    for (const stmt of statements) {
      await aurora.execute(stmt);
    }
    log.log(`migrate.applied file=${file} statements=${statements.length}`);
    applied.push({ file, statements: statements.length });
  }
  return { migrations: applied };
}
