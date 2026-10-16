import type { ReactNode } from 'react';

interface Props {
  icon?: ReactNode;
  title: string;
  body?: ReactNode;
  action?: ReactNode;
}

export function EmptyState({ icon, title, body, action }: Props) {
  return (
    <div className="ps-empty">
      {icon && <div style={{ color: 'var(--color-ink-faint)' }}>{icon}</div>}
      <div className="ps-empty__title">{title}</div>
      {body && <div className="ps-empty__body">{body}</div>}
      {action && <div style={{ marginTop: 8 }}>{action}</div>}
    </div>
  );
}
