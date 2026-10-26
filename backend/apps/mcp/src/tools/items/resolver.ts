// The example domain's resolver, built from the platform container's services
// so the MCP tools and the GraphQL API share one query path and one set of
// authorization checks.
import { once } from '@libs/di';
import { ItemsService } from '@libs/items';
import { ItemsResolver } from '../../../../api/src/items/items.resolver';
import { aurora, authz, identityService } from '../../container';

export const itemsResolver = once(() => new ItemsResolver(new ItemsService(aurora()), authz(), identityService(), aurora()));
