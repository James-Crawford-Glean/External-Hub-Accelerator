// The signed-in caller and the access roster.
import { gql } from './graphql';
import type { AccessRequest, Role, RosterMember, User } from '../../data/types';
import { USER_AVATAR_GQL } from './avatarFields';

export type Me = User;

const USER_FIELDS = `id name email title role isAdmin isActive initials${USER_AVATAR_GQL}`;

export async function fetchMe(): Promise<Me | null> {
  const data = await gql<{ me: Me | null }>(`query Me { me { ${USER_FIELDS} } }`);
  return data.me ? { ...data.me, avatarUrl: data.me.avatarUrl ?? null } : null;
}

export async function recordLogin(): Promise<void> {
  await gql(`mutation RecordLogin($ua: String) { recordLogin(userAgent: $ua) }`, { ua: navigator.userAgent.slice(0, 500) });
}

export async function fetchUsers(search = '', limit = 50, offset = 0): Promise<{ items: User[]; total: number }> {
  const data = await gql<{ users: { items: User[]; total: number } }>(
    `query Users($search: String, $limit: Int, $offset: Int) { users(search: $search, limit: $limit, offset: $offset) { items { ${USER_FIELDS} } total } }`,
    { search: search || undefined, limit, offset },
  );
  return data.users;
}

export async function fetchAccessRoster(): Promise<RosterMember[]> {
  const data = await gql<{ accessRoster: RosterMember[] }>(`query Roster { accessRoster { email name role isAdmin } }`);
  return data.accessRoster;
}

export async function updateRosterMember(email: string, role: Role, isAdmin?: boolean): Promise<RosterMember> {
  const data = await gql<{ updateRosterMember: RosterMember }>(
    `mutation UpdateRosterMember($email: String!, $role: Role!, $isAdmin: Boolean) { updateRosterMember(email: $email, role: $role, isAdmin: $isAdmin) { email name role isAdmin } }`,
    { email, role, isAdmin },
  );
  return data.updateRosterMember;
}

export async function removeRosterMember(email: string): Promise<boolean> {
  const data = await gql<{ removeRosterMember: boolean }>(`mutation RemoveRosterMember($email: String!) { removeRosterMember(email: $email) }`, { email });
  return data.removeRosterMember;
}

export async function fetchAccessRequests(): Promise<AccessRequest[]> {
  const data = await gql<{ accessRequests: AccessRequest[] }>(`query AccessRequests { accessRequests { email name attempts firstSeen lastSeen } }`);
  return data.accessRequests;
}

export async function denyAccessRequest(email: string): Promise<void> {
  await gql(`mutation DenyAccessRequest($email: String!) { denyAccessRequest(email: $email) }`, { email });
}
