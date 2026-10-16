import { useCallback, useMemo, useState } from 'react';

export type SortDir = 'asc' | 'desc';

export interface SortState<K extends string> {
  key: K;
  dir: SortDir;
}

/** A comparable cell value. Numbers sort numerically; strings naturally. */
export type SortValue = string | number;

/**
 * Owns the active sort column + direction for one table. Clicking the active
 * column flips direction; clicking a new column adopts its preferred initial
 * direction (text defaults to asc, numbers usually want desc-first).
 */
export function useTableSort<K extends string>(
  defaultKey: K,
  defaultDir: SortDir = 'asc'
) {
  const [sort, setSort] = useState<SortState<K>>({
    key: defaultKey,
    dir: defaultDir,
  });
  const toggle = useCallback((key: K, initialDir: SortDir = 'asc') => {
    setSort((prev) =>
      prev.key === key
        ? { key, dir: prev.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: initialDir }
    );
  }, []);
  /** Imperatively anchor the sort, e.g. to a tab's natural default order. */
  const setSortTo = useCallback((key: K, dir: SortDir) => {
    setSort({ key, dir });
  }, []);
  return { sort, toggle, setSortTo };
}

function compareValues(a: SortValue, b: SortValue, dir: SortDir): number {
  let cmp: number;
  if (typeof a === 'number' && typeof b === 'number') {
    cmp = a - b;
  } else {
    cmp = String(a).localeCompare(String(b), undefined, {
      numeric: true,
      sensitivity: 'base',
    });
  }
  return dir === 'asc' ? cmp : -cmp;
}

/** Stable, non-mutating sort driven by per-column accessor functions. */
export function useSortedRows<T, K extends string>(
  rows: T[],
  accessors: Record<K, (row: T) => SortValue>,
  sort: SortState<K>
): T[] {
  return useMemo(() => {
    const accessor = accessors[sort.key];
    if (!accessor) return rows;
    return rows
      .map((row, i) => ({ row, i }))
      .sort((a, b) => {
        const cmp = compareValues(accessor(a.row), accessor(b.row), sort.dir);
        return cmp !== 0 ? cmp : a.i - b.i;
      })
      .map((entry) => entry.row);
    // `accessors` is rebuilt each render but stable in shape; recomputing only
    // on row/sort changes avoids needless re-sorts. When the upstream data the
    // accessors close over changes, `rows` changes too and the memo refreshes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, sort.key, sort.dir]);
}
