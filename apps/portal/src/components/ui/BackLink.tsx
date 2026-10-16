import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';

export function BackLink({ to, label }: { to: string; label: string }) {
  return (
    <Link
      to={to}
      className="ps-text-muted"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 500 }}
    >
      <ArrowLeft size={14} />
      {label}
    </Link>
  );
}
