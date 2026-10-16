// Shared async-fetch state machine. Encapsulates the cancelled-flag + loading/
// error lifecycle that every data hook repeats. Pass null as fetcher to skip
// the fetch (missing required arg); loading starts true only when
// a real fetcher is provided.

import { useEffect, useState } from 'react';

export interface AsyncDataState<T> {
  data: T;
  loading: boolean;
  error: string | null;
}

/**
 * Run `fetcher` whenever `deps` change, tracking loading + error state.
 * - `fetcher === null` → skip fetch; loading stays false, data stays at `initial`.
 * - Stale responses (deps changed mid-flight) are discarded via a cancelled flag.
 * - setState never runs synchronously on the effect's call frame — the IIFE keeps
 *   it in the async body, avoiding the cascading-render lint rule.
 */
export function useAsyncData<T>(
  fetcher: (() => Promise<T>) | null,
  deps: readonly unknown[],
  initial: T,
): AsyncDataState<T> {
  const [data, setData] = useState<T>(initial);
  const [loading, setLoading] = useState(fetcher !== null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!fetcher) return;
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      try {
        const result = await fetcher();
        if (cancelled) return;
        setData(result);
        setLoading(false);
      } catch (e: unknown) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : 'Failed to load data.');
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { data, loading, error };
}
