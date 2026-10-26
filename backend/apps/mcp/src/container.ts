// Composition root for the MCP Lambda. Mirrors the subset of apps/api's
// container the platform tools need, reusing the same resolver classes and
// libs so query logic (and its fixes) lives in one place: no SQL in the MCP
// handler. once()-memoized: lazy and singleton across warm invokes. Domain
// tools build their own resolvers from the exported services (see domain.ts).
import { once } from '@libs/di';
import { RDSDataClient } from '@aws-sdk/client-rds-data';
import { AuroraService, auroraConfigFromEnv } from '@libs/aurora';
import { GleanService } from '@libs/glean';
import { AvatarService } from '@libs/avatar';
import { LogoService } from '@libs/logo';
import { RosterService } from '@libs/roster';
import { AuthzService } from '@libs/authz';
import { IdentityService } from '@libs/identity';
import { AccessRequestsService } from '@libs/access-requests';
import { CognitoAccessTokenVerifier, CognitoJwtVerifier, CredentialService } from '@libs/credentials';
import { UsersResolver } from '../../api/src/users/users.resolver';
import { oauthConfigFromEnv } from './auth/config';
import { CognitoUserPoolClients } from './auth/cognito-clients';

// Test/demo seam: point the container at a pglite-backed AuroraService so the
// real tools and handleRpc run with no AWS. once() is lazy, so this only takes
// effect when set before the first resolve.
let auroraOverride: AuroraService | undefined;
export function setAuroraForLocal(a: AuroraService): void {
  auroraOverride = a;
}

export const aurora = once(() => auroraOverride ?? new AuroraService(new RDSDataClient({}), auroraConfigFromEnv()));
const glean = once(() => new GleanService(aurora()));
const avatar = once(() => new AvatarService(aurora(), glean()));
const accessRequests = once(() => new AccessRequestsService(aurora()));
export const logos = once(() => new LogoService());
export const roster = once(() => new RosterService(aurora()));
export const authz = once(() => new AuthzService(roster()));
export const identityService = once(() => new IdentityService(aurora()));

export const resolvers = {
  users: once(() => new UsersResolver(aurora(), authz(), identityService(), roster(), accessRequests(), avatar())),
} as const;

// OAuth resource-server config (RFC 9728 / 7591). Null only when OAUTH_PUBLIC_URL
// is unset, in which case the Lambda relies entirely on the gateway authorizer.
export const oauth = once(() => oauthConfigFromEnv());

// In-Lambda bearer verification for Cognito JWTs (ID or access). Opaque keys are
// not resolved here; they arrive through the gateway authorizer's context.
export const credentials = once(() => {
  const cfg = oauth();
  if (!cfg) return null;
  const idToken = new CognitoJwtVerifier({
    issuer: cfg.issuer,
    clientId: process.env.COGNITO_CLIENT_ID ?? '',
    allowedEmailDomain: cfg.allowedEmailDomain,
  });
  const accessToken = new CognitoAccessTokenVerifier({
    issuer: cfg.issuer,
    resourceIdentifier: cfg.resourceIdentifier,
    allowedEmailDomain: cfg.allowedEmailDomain,
  });
  return new CredentialService(null, idToken, accessToken);
});

export const poolClients = once(() => new CognitoUserPoolClients({ userPoolId: oauth()?.userPoolId ?? '' }));
