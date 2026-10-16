// A logo tile that falls back to initials when the logo cache has nothing.
import { useState } from 'react';

export function ItemLogo({ name, url, size = 28 }: { name: string; url: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const initials = name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
  const style = {
    width: size,
    height: size,
    borderRadius: 6,
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    background: 'var(--color-surface-sunken)',
    border: '1px solid var(--color-border-subtle)',
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--color-ink-muted)',
    flexShrink: 0,
    overflow: 'hidden',
  } as const;
  if (!url || broken) return <span style={style}>{initials}</span>;
  return (
    <span style={style}>
      <img src={url} alt="" width={size} height={size} style={{ objectFit: 'contain', display: 'block' }} onError={() => setBroken(true)} />
    </span>
  );
}
