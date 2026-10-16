// Shimmer placeholders shown while live data loads, so the page keeps its
// shape instead of flashing blank or zeroed content.

interface BlockProps {
  width?: number | string;
  height?: number | string;
  radius?: number | string;
  className?: string;
  style?: React.CSSProperties;
}

/** A single shimmering block. */
export function Skeleton({ width, height, radius, className, style }: BlockProps) {
  return (
    <span
      className={`ps-skeleton${className ? ` ${className}` : ''}`}
      style={{ width, height, borderRadius: radius, ...style }}
      aria-hidden="true"
    />
  );
}

/** Four metric-card placeholders matching the top KPI row. */
export function MetricCardsSkeleton({ count = 4 }: { count?: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, i) => (
        <div className="ps-metric" key={i}>
          <Skeleton width={96} height={12} radius="var(--radius-xs)" />
          <div style={{ marginTop: 10 }}>
            <Skeleton width={72} height={26} radius="var(--radius-xs)" />
          </div>
          <div style={{ marginTop: 12 }}>
            <Skeleton width={120} height={11} radius="var(--radius-xs)" />
          </div>
        </div>
      ))}
    </>
  );
}

/** Month-grid placeholder for the activity calendar (weekday row + 6x7 cells). */
export function CalendarSkeleton() {
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return (
    <div className="cal cal--skeleton" role="status" aria-busy="true" aria-label="Loading calendar">
      <div className="cal__header">
        <div>
          <Skeleton width={150} height={20} radius="var(--radius-xs)" />
          <div style={{ marginTop: 8 }}>
            <Skeleton width={96} height={12} radius="var(--radius-xs)" />
          </div>
        </div>
        <Skeleton width={220} height={30} radius="var(--radius-sm)" />
      </div>
      <div className="cal__grid" aria-hidden="true">
        {DOW.map((d) => (
          <div className="cal__dow" key={d}>
            {d}
          </div>
        ))}
        {Array.from({ length: 42 }, (_, i) => (
          <div className="cal__cell cal__cell--skeleton" key={i}>
            <Skeleton width={18} height={18} radius="var(--radius-pill)" />
            {i % 3 === 0 && (
              <Skeleton width="80%" height={16} radius="var(--radius-xs)" style={{ marginTop: 6 }} />
            )}
            {i % 5 === 0 && (
              <Skeleton width="60%" height={16} radius="var(--radius-xs)" style={{ marginTop: 4 }} />
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
