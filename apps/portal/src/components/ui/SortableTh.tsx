import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import type { SortDir, SortState } from '../../lib/tableSort';

/**
 * A sortable `<th>`. Renders the label plus an arrow that's faint when
 * inactive (signalling sortability) and solid in the active direction.
 */
export function SortableTh<K extends string>({
  columnKey,
  sort,
  onSort,
  align = 'left',
  initialDir = 'asc',
  children,
  style,
}: {
  columnKey: K;
  sort: SortState<K>;
  onSort: (key: K, initialDir?: SortDir) => void;
  align?: 'left' | 'right';
  initialDir?: SortDir;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  const active = sort.key === columnKey;
  return (
    <th
      className={`ps-th-sort${align === 'right' ? ' ps-table__num' : ''}${
        active ? ' ps-th-sort--active' : ''
      }`}
      aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}
      style={style}
    >
      <button
        type="button"
        className="ps-th-sort__btn"
        onClick={() => onSort(columnKey, initialDir)}
      >
        <span>{children}</span>
        <span className="ps-th-sort__icon" aria-hidden>
          {active ? (
            sort.dir === 'asc' ? (
              <ArrowUp size={12} />
            ) : (
              <ArrowDown size={12} />
            )
          ) : (
            <ArrowUpDown size={12} />
          )}
        </span>
      </button>
    </th>
  );
}
