// Query.fetchLogos: domain-driven logo lookup through the logo cache (no
// entity record required). A fresh domain costs 1-2s (extract + S3 put); warm
// hits are cache-only.
import { LogoService } from '@libs/logo';
import { AuthzService, type Identity } from '@libs/authz';

export class LogosResolver {
  constructor(
    private readonly logos: LogoService,
    private readonly authz: AuthzService,
  ) {}

  async fetchLogos(
    args: Record<string, unknown>,
    _source: unknown,
    identity: Identity,
  ): Promise<Array<Record<string, unknown>>> {
    this.authz.requireRead(identity);
    const domains = (args.domains as string[] | null | undefined) ?? [];
    const out: Array<Record<string, unknown>> = [];
    for (const d of domains) {
      const m = await this.logos.getLogoManifest(d);
      out.push({
        domain: d,
        logoUrl: m ? m.logoUrl : null,
        logoIconUrl: m ? m.iconUrl : null,
        logoVariants: m ? m.variants : [],
      });
    }
    return out;
  }
}
