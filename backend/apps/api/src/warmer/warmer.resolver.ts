// Keep-alive warmer runtime config, admin-editable. Single
// row in app.warmer_config; the scheduled warmer Lambda reads it each run and no-ops
// when disabled. enabled + concurrency are the only knobs.
//   warmerConfig     (Query)    current config (admin)
//   setWarmerConfig  (Mutation) update enabled/concurrency (admin)
import { Logger } from '@libs/log';
import { AuroraService } from '@libs/aurora';
import { AuthzService } from '@libs/authz';
import type { Identity } from '@libs/authz';

interface WarmerConfig {
  enabled: boolean;
  concurrency: number;
  updatedAt: string | null;
  updatedBy: string | null;
}

export class WarmerResolver {
  private readonly log = new Logger(WarmerResolver.name);

  constructor(
    private readonly aurora: AuroraService,
    private readonly authz: AuthzService,
  ) {}

  private async read(): Promise<WarmerConfig> {
    const rows = await this.aurora.query<Record<string, any>>(
      'SELECT enabled, concurrency, updated_at, updated_by FROM app.warmer_config WHERE id = true',
    );
    const r = rows[0] ?? {};
    return {
      enabled: r.enabled ?? true,
      concurrency: Number(r.concurrency ?? 2),
      updatedAt: AuroraService.iso8601(r.updated_at),
      updatedBy: r.updated_by ?? null,
    };
  }

  async warmerConfig(_args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<WarmerConfig> {
    await this.authz.requireAdmin(identity);
    return this.read();
  }

  async setWarmerConfig(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<WarmerConfig> {
    await this.authz.requireAdmin(identity);
    const enabled = args.enabled as boolean | null | undefined;
    const concurrency = args.concurrency as number | null | undefined;
    const by = (identity?.email as string) || (identity?.sub as string) || null;

    // COALESCE(:x, col) — only the provided knobs change. Concurrency clamped 0..20
    // (the CHECK also enforces it; clamp gives a friendly value not a 500).
    const clamped = concurrency == null ? null : Math.max(0, Math.min(20, Math.trunc(concurrency)));
    await this.aurora.execute(
      'UPDATE app.warmer_config SET ' +
        'enabled = COALESCE(:enabled, enabled), ' +
        'concurrency = COALESCE(:concurrency, concurrency), ' +
        'updated_at = now(), updated_by = :by WHERE id = true',
      { enabled: enabled ?? null, concurrency: clamped, by },
    );
    this.log.log(`setWarmerConfig enabled=${enabled ?? '(keep)'} concurrency=${clamped ?? '(keep)'} by=${by}`);
    return this.read();
  }
}
