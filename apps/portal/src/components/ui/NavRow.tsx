import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NavRow({
  to,
  icon,
  title,
  description,
}: {
  to: string;
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <Link
      to={to}
      className="ps-row ps-row--between"
      style={{
        padding: '14px 18px',
        borderTop: '1px solid var(--color-border-subtle)',
        gap: 12,
        color: 'inherit',
      }}
    >
      <span className="ps-row" style={{ gap: 12, minWidth: 0 }}>
        {icon}
        <span style={{ minWidth: 0 }}>
          <span style={{ display: 'block', fontWeight: 600, fontSize: 13 }}>{title}</span>
          <span style={{ display: 'block', fontSize: 12, color: 'var(--color-ink-muted)', marginTop: 2 }}>
            {description}
          </span>
        </span>
      </span>
      <ChevronRight size={16} color="var(--color-ink-faint)" />
    </Link>
  );
}
