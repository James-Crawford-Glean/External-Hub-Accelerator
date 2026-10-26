// Field -> resolver registry. The dispatcher looks up event.fieldName (or
// op:<name> for internal direct invokes) here. `key` indexes
// container.resolvers (typed ResolverKey, so a bad key is a compile error).
import { type ResolverKey } from './container';
import { domainFields } from './domain';

export interface RegistryEntry {
  key: ResolverKey;
  method: string;
}

const bind = (key: ResolverKey, methods: readonly string[]): Record<string, RegistryEntry> =>
  Object.fromEntries(methods.map((m) => [m, { key, method: m }]));

const bindAll = (fields: Partial<Record<ResolverKey, readonly string[]>>): Record<string, RegistryEntry> =>
  Object.assign({}, ...(Object.entries(fields) as [ResolverKey, readonly string[]][]).map(([key, methods]) => bind(key, methods)));

export const REGISTRY: Record<string, RegistryEntry> = {
  ...bind('UsersResolver', ['me', 'user', 'users']),
  ...bind('RosterResolver', ['accessRoster', 'updateRosterMember', 'removeRosterMember']),
  ...bind('AccessRequestsResolver', ['accessRequests', 'denyAccessRequest']),
  ...bind('LoginEventsResolver', ['recordLogin', 'loginActivity']),
  ...bind('ApiKeysResolver', ['createApiKey', 'revokeApiKey', 'deleteApiKey']),
  // field `apiKeys` -> method apiKeys_ avoids clashing with the injected service field
  apiKeys: { key: 'ApiKeysResolver', method: 'apiKeys_' },
  ...bind('GleanResolver', [
    'gleanConnection',
    'gleanBeginConnect',
    'gleanCompleteConnect',
    'gleanDisconnect',
    'gleanSetEndpoint',
  ]),
  ...bind('IndexingResolver', ['gleanIndexRuns', 'triggerGleanIndex']),
  ...bind('WarmerResolver', ['warmerConfig', 'setWarmerConfig']),
  ...bind('LogosResolver', ['fetchLogos']),
  ...bind('NotificationsResolver', ['notifications', 'markNotificationRead']),
  ...bindAll(domainFields),
  // internal direct-invoke RPC (the stream Lambda's token fetch)
  'op:glean_token': { key: 'GleanResolver', method: 'gleanToken' },
};
