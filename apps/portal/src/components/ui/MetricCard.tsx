import type { ReactNode } from 'react';
import { TrendingDown, TrendingUp } from 'lucide-react';

interface Props {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  delta?: { direction: 'up' | 'down' | 'flat'; label: string };
  accent?: boolean;
  loading?: boolean;
  /** Plain string, or structured content (e.g. a data breakdown). */
  tooltip?: ReactNode;
}

export function MetricCard({ label, value, hint, delta, accent, loading, tooltip }: Props) {
  const card = (
    <div className="ps-metric">
      {accent && <span className="ps-metric__accent-bar" />}
      <div className="ps-metric__label">{label}</div>
      <div className="ps-metric__value">{loading ? <span className="ps-shimmer ps-shimmer--value" /> : value}</div>
      <div className="ps-row" style={{ gap: 10 }}>
        {!loading && delta && (
          <span
            className={`ps-metric__delta ps-metric__delta--${
              delta.direction === 'down' ? 'down' : 'up'
            }`}
          >
            {delta.direction === 'down' ? (
              <TrendingDown size={12} />
            ) : (
              <TrendingUp size={12} />
            )}
            {delta.label}
          </span>
        )}
        {!loading && hint && <span className="ps-metric__hint">{hint}</span>}
      </div>
    </div>
  );

  if (!tooltip) return card;
  return (
    <div className="ps-metric-tip">
      {card}
      <div className="ps-metric-tip__pop" role="tooltip">
        {tooltip}
      </div>
    </div>
  );
}
