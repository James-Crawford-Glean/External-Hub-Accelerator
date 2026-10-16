// UserPoolClients bound to the Cognito SDK. Every client minted here gets the same
// shape as the Terraform-managed `mcp` app client: code flow + PKCE, Google IdP only,
// refresh tokens allowed, revocation on, no implicit grant, no client-credentials.
import {
  CognitoIdentityProviderClient,
  CreateUserPoolClientCommand,
  DescribeUserPoolClientCommand,
  ListUserPoolClientsCommand,
  type UserPoolClientType,
} from '@aws-sdk/client-cognito-identity-provider';
import type { CreatePoolClientInput, PoolClient, PoolClientSummary, UserPoolClients } from './register';

export interface CognitoClientsOptions {
  userPoolId: string;
  identityProviders?: string[];
  accessTokenValidityMinutes?: number;
  idTokenValidityMinutes?: number;
  refreshTokenValidityDays?: number;
}

export class CognitoUserPoolClients implements UserPoolClients {
  constructor(
    private readonly opts: CognitoClientsOptions,
    private readonly sdk: CognitoIdentityProviderClient = new CognitoIdentityProviderClient({}),
  ) {}

  async list(): Promise<PoolClientSummary[]> {
    const out: PoolClientSummary[] = [];
    let nextToken: string | undefined;
    do {
      const page = await this.sdk.send(
        new ListUserPoolClientsCommand({ UserPoolId: this.opts.userPoolId, MaxResults: 60, NextToken: nextToken }),
      );
      for (const c of page.UserPoolClients ?? []) {
        if (c.ClientId && c.ClientName) out.push({ clientId: c.ClientId, clientName: c.ClientName });
      }
      nextToken = page.NextToken;
    } while (nextToken);
    return out;
  }

  async describe(clientId: string): Promise<PoolClient | null> {
    const resp = await this.sdk.send(
      new DescribeUserPoolClientCommand({ UserPoolId: this.opts.userPoolId, ClientId: clientId }),
    );
    return resp.UserPoolClient ? toPoolClient(resp.UserPoolClient) : null;
  }

  async create(input: CreatePoolClientInput): Promise<PoolClient> {
    const resp = await this.sdk.send(
      new CreateUserPoolClientCommand({
        UserPoolId: this.opts.userPoolId,
        ClientName: input.clientName,
        GenerateSecret: input.generateSecret,
        CallbackURLs: input.callbackUrls,
        AllowedOAuthFlows: ['code'],
        AllowedOAuthFlowsUserPoolClient: true,
        AllowedOAuthScopes: input.scopes,
        SupportedIdentityProviders: this.opts.identityProviders ?? ['Google'],
        ExplicitAuthFlows: ['ALLOW_REFRESH_TOKEN_AUTH'],
        PreventUserExistenceErrors: 'ENABLED',
        EnableTokenRevocation: true,
        AccessTokenValidity: this.opts.accessTokenValidityMinutes ?? 60,
        IdTokenValidity: this.opts.idTokenValidityMinutes ?? 60,
        RefreshTokenValidity: this.opts.refreshTokenValidityDays ?? 30,
        TokenValidityUnits: { AccessToken: 'minutes', IdToken: 'minutes', RefreshToken: 'days' },
      }),
    );
    if (!resp.UserPoolClient) throw new Error('CreateUserPoolClient returned no client');
    return toPoolClient(resp.UserPoolClient);
  }
}

function toPoolClient(c: UserPoolClientType): PoolClient {
  return {
    clientId: c.ClientId ?? '',
    clientName: c.ClientName ?? '',
    clientSecret: c.ClientSecret ?? null,
    callbackUrls: c.CallbackURLs ?? [],
    createdAt: c.CreationDate ?? null,
  };
}
