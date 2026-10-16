// Inline loading indicator for live fetches in flight. In live mode we show this
// (or an empty/error state) instead of flashing stale data.
interface Props {
  label?: string;
  size?: number;
}

export function Spinner({ label = 'Loading…', size = 18 }: Props) {
  return (
    <div className="ps-spinner" role="status" aria-live="polite">
      <span className="ps-spinner__ring" style={{ width: size, height: size }} />
      {label && <span className="ps-spinner__label">{label}</span>}
    </div>
  );
}
