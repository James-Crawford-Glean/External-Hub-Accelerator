// The domain seam for the GraphQL API: the one file that names your domain's
// resolvers. container.ts builds them from the shared services and registry.ts
// binds their fields; nothing else under apps/api imports domain code. To
// replace the example, delete items/ and rewrite this file (an empty
// registration is `domainResolvers = () => ({})` and `domainFields = {}`).
import { once } from '@libs/di';
import { ItemsService } from '@libs/items';
import type { Services } from './container';
import { ItemsResolver } from './items/items.resolver';

/** Resolver factories keyed by class name. */
export const domainResolvers = (s: Services) =>
  ({
    ItemsResolver: once(() => new ItemsResolver(new ItemsService(s.aurora()), s.authz(), s.identity(), s.aurora())),
  }) as const;

/** The Query and Mutation fields each domain resolver serves (method name = field name). */
export const domainFields: Record<keyof ReturnType<typeof domainResolvers>, readonly string[]> = {
  ItemsResolver: ['items', 'item', 'itemCategories', 'createItem', 'updateItem', 'archiveItem', 'approveItem', 'rejectItem'],
};
