// Admin surface for opaque API keys. All fields are admin-only. The GraphQL layer
// speaks UPPER-case enums (READ/WRITE/ADMIN, ACTIVE/REVOKED); the store speaks the
// lower-case Scope/status the authorizer uses — this resolver is the boundary that
// maps between them. The secret is returned exactly once, from createApiKey.
//   apiKeys       (Query)    list all keys (no secret)
//   createApiKey  (Mutation) mint a key; returns { apiKey, secret }
//   revokeApiKey  (Mutation) soft-revoke (kept for audit)
//   deleteApiKey  (Mutation) hard-delete
import { ApiKeyService, type ApiKeyRecord, type Principal, type Scope } from '@libs/credentials';
import { AuthzService, type Identity } from '@libs/authz';

interface GqlApiKey extends Omit<ApiKeyRecord, 'scopes' | 'status'> {
  scopes: string[];
  status: string;
}

export class ApiKeysResolver {
  constructor(
    private readonly apiKeys: ApiKeyService,
    private readonly authz: AuthzService,
  ) {}

  async apiKeys_(_args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<GqlApiKey[]> {
    await this.authz.requireAdmin(identity);
    return (await this.apiKeys.list()).map(toGql);
  }

  async createApiKey(
    args: Record<string, unknown>,
    _source: unknown,
    identity: Identity,
  ): Promise<{ apiKey: GqlApiKey; secret: string }> {
    await this.authz.requireAdmin(identity);
    const input = (args.input as { name?: string; scopes?: string[]; expiresAt?: string | null }) ?? {};
    const { record, secret } = await this.apiKeys.create(
      {
        name: input.name ?? '',
        scopes: (input.scopes ?? []).map(toScope),
        expiresAt: input.expiresAt ?? null,
      },
      actorOf(identity),
    );
    return { apiKey: toGql(record), secret };
  }

  async revokeApiKey(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<GqlApiKey> {
    await this.authz.requireAdmin(identity);
    return toGql(await this.apiKeys.revoke(String(args.id)));
  }

  async deleteApiKey(args: Record<string, unknown>, _source: unknown, identity: Identity): Promise<boolean> {
    await this.authz.requireAdmin(identity);
    await this.apiKeys.remove(String(args.id));
    return true;
  }
}

/** GraphQL field name is `apiKeys`; the method is suffixed to avoid clashing with the
 *  injected `apiKeys` service field. The registry maps the field to this method. */
export const API_KEYS_QUERY_METHOD = 'apiKeys_';

function toGql(r: ApiKeyRecord): GqlApiKey {
  return { ...r, scopes: r.scopes.map((s) => s.toUpperCase()), status: r.status.toUpperCase() };
}

function toScope(s: string): Scope {
  return s.toLowerCase() as Scope;
}

function actorOf(identity: Identity): Principal {
  return {
    kind: 'user',
    email: (identity?.email ?? '').toLowerCase(),
    sub: identity?.sub ?? '',
    name: (identity?.name as string | undefined) ?? null,
  };
}
