// Composition root for the authorizer Lambda. Builds the CredentialService once
// (memoized across warm invokes): opaque keys resolve via ApiKeyService over the
// api_keys table (pepper from Secrets Manager), ID tokens via the Cognito verifier,
// and — when COGNITO_MCP_RESOURCE is set — MCP OAuth access tokens via the
// access-token verifier.
import { once } from '@libs/di';
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import {
  ApiKeyService,
  ApiKeyStore,
  CognitoAccessTokenVerifier,
  CognitoJwtVerifier,
  CredentialService,
} from '@libs/credentials';

/** Reads the HMAC pepper from Secrets Manager at runtime (never at build/apply). */
function pepperProvider(): () => Promise<string> {
  const secrets = new SecretsManagerClient({});
  return async () => {
    const name = process.env.API_KEY_PEPPER_SECRET;
    if (!name) throw new Error('API_KEY_PEPPER_SECRET is unset');
    const resp = await secrets.send(new GetSecretValueCommand({ SecretId: name }));
    if (!resp.SecretString) throw new Error(`pepper secret ${name} has no value`);
    return resp.SecretString;
  };
}

export const credentials = once(() => {
  const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}));
  const keys = new ApiKeyService(new ApiKeyStore(ddb), pepperProvider());
  const issuer = process.env.COGNITO_ISSUER ?? '';
  // Second layer behind the Cognito pre-sign-up gate: a token whose email is
  // outside ALLOWED_EMAIL_DOMAINS (comma-separated) is rejected here too. Unset
  // means any domain the pool admitted. Machine keys skip the JWT path entirely.
  const allowedEmailDomain = process.env.ALLOWED_EMAIL_DOMAINS || undefined;
  const idToken = new CognitoJwtVerifier({
    issuer,
    clientId: process.env.COGNITO_CLIENT_ID ?? '',
    allowedEmailDomain,
  });
  const resourceIdentifier = process.env.COGNITO_MCP_RESOURCE ?? '';
  const accessToken = resourceIdentifier
    ? new CognitoAccessTokenVerifier({ issuer, resourceIdentifier, allowedEmailDomain })
    : null;
  return new CredentialService(keys, idToken, accessToken);
});
