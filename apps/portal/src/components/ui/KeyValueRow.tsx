export function KeyValueRow({
  icon,
  label,
  value,
}: {
  icon?: React.ReactNode;
  label: string;
  value: React.ReactNode;
}) {
  return (
    <div
      className="ps-row ps-row--between"
      style={{
        padding: '8px 10px',
        background: 'var(--color-surface-subtle)',
        borderRadius: 'var(--radius-sm)',
        fontSize: 13,
      }}
    >
      <span className="ps-row" style={{ gap: 8 }}>
        {icon}
        {label}
      </span>
      <span className="ps-text-subtle">{value}</span>
    </div>
  );
}
