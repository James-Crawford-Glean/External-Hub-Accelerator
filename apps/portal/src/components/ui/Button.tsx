import type { ButtonHTMLAttributes, ReactNode } from 'react';

type Variant = 'primary' | 'brand' | 'accent' | 'secondary' | 'ghost' | 'danger';
type Size = 'sm' | 'md' | 'lg';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  iconLeft?: ReactNode;
  iconRight?: ReactNode;
  fullWidth?: boolean;
}

export function Button({
  variant = 'secondary',
  size = 'md',
  iconLeft,
  iconRight,
  fullWidth,
  className = '',
  children,
  ...rest
}: ButtonProps) {
  const classes = [
    'ps-btn',
    `ps-btn--${variant}`,
    size === 'sm' && 'ps-btn--sm',
    size === 'lg' && 'ps-btn--lg',
    fullWidth && 'ps-btn--block',
    !children && 'ps-btn--icon-only',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button className={classes} type={rest.type ?? 'button'} {...rest}>
      {iconLeft}
      {children}
      {iconRight}
    </button>
  );
}
