// Composition root for the GraphQL dispatcher Lambda. Each service and
// resolver is a once()-memoized factory: lazy (only what a request touches is
// built), singleton across warm invokes, order-independent. Wiring is plain
// constructor calls, so a missing or mis-typed dependency is a compile error.
//
// Platform resolvers are built here. The domain's come from domain.ts, which
// receives the shared services and is the only file that names domain code.
import { once } from '@libs/di';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { AuroraService, auroraConfigFromEnv } from '@libs/aurora';
import { AuthzService } from '@libs/authz';
import { RosterService } from '@libs/roster';
import { IdentityService } from '@libs/identity';
import { AccessRequestsService } from '@libs/access-requests';
import { LoginEventsService } from '@libs/login-events';
import { GleanService } from '@libs/glean';
import { LogoService } from '@libs/logo';
import { AvatarService } from '@libs/avatar';
import { WorkerService } from '@libs/worker';
import { ApiKeyService, ApiKeyStore } from '@libs/credentials';

import { UsersResolver } from './users/users.resolver';
import { RosterResolver } from './roster/roster.resolver';
import { AccessRequestsResolver } from './access-requests/access-requests.resolver';
import { LoginEventsResolver } from './login-events/login-events.resolver';
import { ApiKeysResolver } from './api-keys/api-keys.resolver';
import { GleanResolver } from './glean/glean.resolver';
import { IndexingResolver } from './glean/indexing.resolver';
import { WarmerResolver } from './warmer/warmer.resolver';
import { LogosResolver } from './logos/logos.resolver';
import { NotificationsResolver } from './notifications/notifications.resolver';
import { domainResolvers } from './domain';

// Reads the HMAC pepper from Secrets Manager at runtime (never at import or apply).
function apiKeyPepper(): () => Promise<string> {
  const secrets = new SecretsManagerClient({});
  return async () => {
    const name = process.env.API_KEY_PEPPER_SECRET;
    if (!name) throw new Error('API_KEY_PEPPER_SECRET is unset');
    const resp = await secrets.send(new GetSecretValueCommand({ SecretId: name }));
    if (!resp.SecretString) throw new Error(`pepper secret ${name} has no value`);
    return resp.SecretString;
  };
}

// --- shared services (singletons) ---
export const aurora = once(() => new AuroraService(new RDSDataClient({}), auroraConfigFromEnv()));
export const worker = once(() => new WorkerService());
export const logo = once(() => new LogoService());
export const roster = once(() => new RosterService(aurora()));
export const identity = once(() => new IdentityService(aurora()));
export const accessRequests = once(() => new AccessRequestsService(aurora()));
export const loginEvents = once(() => new LoginEventsService(aurora()));
export const glean = once(() => new GleanService(aurora()));
export const avatar = once(() => new AvatarService(aurora(), glean()));
export const authz = once(() => new AuthzService(roster()));
export const apiKeys = once(() => new ApiKeyService(new ApiKeyStore(), apiKeyPepper()));

/** The shared services a domain's resolvers are built from. */
export const services = { aurora, worker, logo, roster, identity, accessRequests, loginEvents, glean, avatar, authz, apiKeys } as const;
export type Services = typeof services;

const platformResolvers = {
  UsersResolver: once(() => new UsersResolver(aurora(), authz(), identity(), roster(), accessRequests(), avatar())),
  RosterResolver: once(() => new RosterResolver(authz(), roster(), accessRequests())),
  AccessRequestsResolver: once(() => new AccessRequestsResolver(accessRequests(), authz())),
  LoginEventsResolver: once(() => new LoginEventsResolver(aurora(), loginEvents(), authz(), identity())),
  ApiKeysResolver: once(() => new ApiKeysResolver(apiKeys(), authz())),
  GleanResolver: once(() => new GleanResolver(glean(), worker(), authz())),
  IndexingResolver: once(() => new IndexingResolver(aurora(), worker(), authz())),
  WarmerResolver: once(() => new WarmerResolver(aurora(), authz())),
  LogosResolver: once(() => new LogosResolver(logo(), authz())),
  NotificationsResolver: once(() => new NotificationsResolver(aurora(), identity())),
} as const;

// --- resolvers (keyed by class name; the registry indexes this map) ---
export const resolvers = { ...platformResolvers, ...domainResolvers(services) } as const;

export type ResolverKey = keyof typeof resolvers;
