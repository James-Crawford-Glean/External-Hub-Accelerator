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
