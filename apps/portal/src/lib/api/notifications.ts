// In-app notifications for the signed-in caller.
import { gql } from './graphql';

export interface AppNotification {
  id: string;
  title: string;
  body: string | null;
  href: string;
  createdAt: string | null;
}

export async function fetchNotifications(): Promise<AppNotification[]> {
  const data = await gql<{ notifications: AppNotification[] }>(`query Notifications { notifications(limit: 20) { id title body href createdAt } }`);
  return data.notifications;
}

export async function markNotificationRead(id: string): Promise<void> {
  await gql(`mutation MarkNotificationRead($id: ID!) { markNotificationRead(id: $id) }`, { id });
}
