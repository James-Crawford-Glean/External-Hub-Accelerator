// Paginated login-activity audit for the Session activity screen. Wraps
// fetchLoginActivity with the shared async-data lifecycle (loading/error/cancelled).

import { fetchLoginActivity, type LoginActivityPage } from './loginActivity';
import { useAsyncData } from './useAsyncData';

export interface UseLoginActivityOptions {
  search?: string;
  from?: string;
  to?: string;
  limit: number;
  offset: number;
  reloadKey?: number;
}

const INITIAL: LoginActivityPage = { items: [], total: 0 };

/** One page of the login-activity audit, re-fetched whenever opts change. */
export function useLoginActivity({ search, from, to, limit, offset, reloadKey = 0 }: UseLoginActivityOptions) {
  return useAsyncData<LoginActivityPage>(
    () => fetchLoginActivity({ search: search?.trim() || undefined, from, to, limit, offset }),
    [search, from, to, limit, offset, reloadKey],
    INITIAL,
  );
}
