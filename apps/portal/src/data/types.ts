// Client-side types mirroring backend/schema.graphql. Enums cross the wire in
// UPPER case and are kept that way here.

export type Role = 'ADMINISTRATOR' | 'EDITOR' | 'VIEWER';
export const ROLES: readonly Role[] = ['ADMINISTRATOR', 'EDITOR', 'VIEWER'];

export interface User {
  id: string;
  name: string;
  email: string;
  title: string | null;
  role: Role | null;
  isAdmin: boolean;
  isActive: boolean;
  initials: string;
  avatarUrl: string | null;
}

export type ApiKeyScope = 'READ' | 'WRITE' | 'ADMIN';
export type ApiKeyStatus = 'ACTIVE' | 'REVOKED';

export interface ApiKey {
  id: string;
  name: string;
  prefix: string;
  last4: string;
  scopes: ApiKeyScope[];
  status: ApiKeyStatus;
  createdAt: string;
  createdBy: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  revokedAt: string | null;
}

export interface RosterMember {
  email: string;
  name: string | null;
  role: Role;
  isAdmin: boolean;
}

export interface AccessRequest {
  email: string;
  name: string | null;
  attempts: number;
  firstSeen: string;
  lastSeen: string;
}

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

export interface IndexRun {
  id: string;
  type: string;
  status: string;
  startedAt: string;
  completedAt: string | null;
  processed: number | null;
}
