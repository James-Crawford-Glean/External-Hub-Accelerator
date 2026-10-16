import type { CSSProperties } from 'react';
import { PORTAL_NAME } from '../../lib/api/config';

type Props = {
  size?: number;
  variant?: 'mark' | 'full';
  style?: CSSProperties;
};

/**
 * Brand lockup: the Glean mark plus the portal name when `variant="full"`.
 * Swap the image and PORTAL_NAME to brand your portal.
 */
export function GleanLogo({ size = 28, variant = 'full', style }: Props) {
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 10,
        color: 'var(--color-ink-strong)',
        ...style,
      }}
      aria-label={PORTAL_NAME}
    >
      <img
        src={`${import.meta.env.BASE_URL}glean-mark.png`}
        width={size}
        height={size}
        alt=""
        aria-hidden="true"
        style={{ display: 'block', borderRadius: '50%' }}
      />
      {variant === 'full' && (
        <span
          style={{
            fontWeight: 600,
            fontSize: 16,
            letterSpacing: '-0.02em',
            display: 'inline-flex',
            alignItems: 'baseline',
            gap: 6,
          }}
        >
          <span>Glean</span>
          <span
            style={{
              fontWeight: 500,
              color: 'var(--color-ink-muted)',
              fontSize: 14,
            }}
          >
            {PORTAL_NAME}
          </span>
        </span>
      )}
    </span>
  );
}
