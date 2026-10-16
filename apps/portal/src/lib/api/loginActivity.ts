// Interactive sign-in audit (AppSync loginActivity). Admin only. One row per
// completed Cognito login — powers the Session activity admin screen.
import { type Connection, gql } from './graphql';

export interface LoginEvent {
  id: string;
  email: string;
  userAgent: string | null;
  createdAt: string;
}

export interface LoginActivityPage {
  items: LoginEvent[];
  total: number;
}

const QUERY = `query($search: String, $from: AWSDateTime, $to: AWSDateTime, $limit: Int, $offset: Int) {
  loginActivity(search: $search, from: $from, to: $to, limit: $limit, offset: $offset) {
    items { id email userAgent createdAt }
    total
  }
}`;

export async function fetchLoginActivity(opts: {
  search?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
}): Promise<LoginActivityPage> {
  const data = await gql<{ loginActivity: Connection<LoginEvent> }>(QUERY, {
    search: opts.search?.trim() || undefined,
    from: opts.from || undefined,
    to: opts.to || undefined,
    limit: opts.limit,
    offset: opts.offset,
  });
  return { items: data.loginActivity.items, total: data.loginActivity.total };
}
