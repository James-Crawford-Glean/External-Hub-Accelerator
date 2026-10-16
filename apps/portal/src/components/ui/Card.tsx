import type { HTMLAttributes, ReactNode } from 'react';

interface Props extends HTMLAttributes<HTMLDivElement> {
  padded?: boolean;
  interactive?: boolean;
  children: ReactNode;
}

export function Card({
  padded = false,
  interactive = false,
  className = '',
  children,
  ...rest
}: Props) {
  const classes = [
    'ps-card',
    padded && 'ps-card--padded',
    interactive && 'ps-card--interactive',
    className,
  ]
    .filter(Boolean)
    .join(' ');
  return (
    <div className={classes} {...rest}>
      {children}
    </div>
  );
}

interface CardHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
}

export function CardHeader({ title, subtitle, action }: CardHeaderProps) {
  return (
    <div className="ps-card__header">
      <div>
        <div className="ps-card__title">{title}</div>
        {subtitle && <div className="ps-card__subtitle">{subtitle}</div>}
      </div>
      {action && <div>{action}</div>}
    </div>
  );
}

export function CardBody({
  children,
  flush = false,
}: {
  children: ReactNode;
  flush?: boolean;
}) {
  return (
    <div className={`ps-card__body${flush ? ' ps-card__body--flush' : ''}`}>
      {children}
    </div>
  );
}
