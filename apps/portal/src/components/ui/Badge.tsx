import type { ReactNode } from 'react';

export type Tone =
  | 'neutral'
  | 'brand'
  | 'accent'
  | 'success'
  | 'warning'
  | 'danger'
  | 'info'
  | 'outline';

interface Props {
  tone?: Tone;
  withDot?: boolean;
  children: ReactNode;
}

export function Badge({ tone = 'neutral', withDot = false, children }: Props) {
  return (
    <span className={`ps-badge ps-badge--${tone}`}>
      {withDot && <span className="ps-badge__dot" />}
      {children}
    </span>
  );
}
