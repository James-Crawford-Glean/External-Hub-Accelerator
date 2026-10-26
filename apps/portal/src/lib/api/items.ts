// Example domain: items.
import { cleanFilter, gql, type Connection } from './graphql';
import type { Role, User } from '../../data/types';

/** DRAFT and REJECTED are the review states of an assistant-initiated create; ACTIVE and ARCHIVED are live. */
export type ItemStatus = 'DRAFT' | 'ACTIVE' | 'ARCHIVED' | 'REJECTED';

export interface Item {
  id: string;
  externalId: string | null;
  name: string;
  category: string | null;
  status: ItemStatus;
  description: string | null;
  website: string | null;
  owner: Pick<User, 'id' | 'email' | 'name'> | null;
  visibilityRole: Role | null;
  source: string | null;
  syncedAt: string | null;
  indexedAt: string | null;
  reviewedAt: string | null;
  reviewedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ItemInput {
  name?: string;
  category?: string | null;
  description?: string | null;
  website?: string | null;
  ownerUserId?: string | null;
  visibilityRole?: Role | null;
  status?: ItemStatus;
}

export interface ItemFilter {
  search?: string;
  status?: ItemStatus[];
  category?: string[];
  ownerId?: string;
  /** The review queue: DRAFT rows only. Overrides `status`. */
  draftsOnly?: boolean;
}

const ITEM_FIELDS = `id externalId name category status description website owner { id email name } visibilityRole source syncedAt indexedAt reviewedAt reviewedBy createdAt updatedAt`;

export async function fetchItems(filter: ItemFilter, limit = 50, offset = 0): Promise<Connection<Item>> {
  const data = await gql<{ items: Connection<Item> }>(
    `query Items($filter: ItemFilter, $limit: Int, $offset: Int) { items(filter: $filter, limit: $limit, offset: $offset) { items { ${ITEM_FIELDS} } total } }`,
    { filter: cleanFilter(filter), limit, offset },
  );
  return data.items;
}

export async function fetchItem(id: string): Promise<Item | null> {
  const data = await gql<{ item: Item | null }>(`query Item($id: ID!) { item(id: $id) { ${ITEM_FIELDS} } }`, { id });
  return data.item;
}

export async function fetchItemCategories(): Promise<string[]> {
  const data = await gql<{ itemCategories: string[] }>(`query ItemCategories { itemCategories }`);
  return data.itemCategories;
}

export async function createItem(input: ItemInput): Promise<Item> {
  const data = await gql<{ createItem: Item }>(`mutation CreateItem($input: ItemInput!) { createItem(input: $input) { ${ITEM_FIELDS} } }`, { input });
  return data.createItem;
}

export async function updateItem(id: string, input: ItemInput): Promise<Item> {
  const data = await gql<{ updateItem: Item }>(`mutation UpdateItem($id: ID!, $input: ItemInput!) { updateItem(id: $id, input: $input) { ${ITEM_FIELDS} } }`, {
    id,
    input,
  });
  return data.updateItem;
}

export async function archiveItem(id: string): Promise<Item> {
  const data = await gql<{ archiveItem: Item }>(`mutation ArchiveItem($id: ID!) { archiveItem(id: $id) { ${ITEM_FIELDS} } }`, { id });
  return data.archiveItem;
}

/** DRAFT -> ACTIVE. A no-op on any other status; the server returns the row unchanged. */
export async function approveItem(id: string): Promise<Item> {
  const data = await gql<{ approveItem: Item }>(`mutation ApproveItem($id: ID!) { approveItem(id: $id) { ${ITEM_FIELDS} } }`, { id });
  return data.approveItem;
}

/** DRAFT -> REJECTED. A no-op on any other status. */
export async function rejectItem(id: string): Promise<Item> {
  const data = await gql<{ rejectItem: Item }>(`mutation RejectItem($id: ID!) { rejectItem(id: $id) { ${ITEM_FIELDS} } }`, { id });
  return data.rejectItem;
}
