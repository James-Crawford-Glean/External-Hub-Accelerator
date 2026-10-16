import { useEffect, useRef, useState } from 'react';

interface Props {
  name: string;
  initials?: string;
  color?: string;
  size?: 'sm' | 'md' | 'lg' | 'xl';
  /** Profile photo URL (e.g. Google). Falls back to initials if missing or it fails to load. */
  image?: string | null;
}

const IMG_MAX_ATTEMPTS = 3;
const imgBackoffMs = (attempt: number) => Math.min(250 * 2 ** attempt, 2000);

function initialsOf(name: string) {
  const parts = name.trim().split(/\s+/).slice(0, 2);
  return parts.map((p) => p[0]?.toUpperCase() ?? '').join('') || '?';
}

export function Avatar({ name, initials, color, size = 'md', image }: Props) {
  const [attempt, setAttempt] = useState(0);
  const [imgOk, setImgOk] = useState(true);
  const [seenImage, setSeenImage] = useState(image);
  const retryTimer = useRef<number | null>(null);

  // A new image URL starts a fresh attempt sequence (state reset during render,
  // the React-sanctioned pattern for "derive from a changed prop").
  if (image !== seenImage) {
    setSeenImage(image);
    setAttempt(0);
    setImgOk(true);
  }
  useEffect(() => () => {
    if (retryTimer.current != null) window.clearTimeout(retryTimer.current);
  }, []);

  const sizeClass =
    size === 'sm'
      ? 'ps-avatar--sm'
      : size === 'lg'
      ? 'ps-avatar--lg'
      : size === 'xl'
      ? 'ps-avatar--xl'
      : '';
  const showImg = Boolean(image) && imgOk;

  const onImgError = () => {
    if (attempt + 1 < IMG_MAX_ATTEMPTS) {
      if (retryTimer.current != null) window.clearTimeout(retryTimer.current);
      retryTimer.current = window.setTimeout(() => setAttempt((n) => n + 1), imgBackoffMs(attempt));
      return;
    }
    setImgOk(false);
  };

  return (
    <span
      className={`ps-avatar ${sizeClass}`}
      style={color && !showImg ? { background: color } : undefined}
      title={name}
      aria-label={name}
    >
      {showImg ? (
        <img
          key={`${image}-${attempt}`}
          src={image as string}
          alt=""
          onError={onImgError}
          style={{ width: '100%', height: '100%', objectFit: 'cover', borderRadius: 'inherit', display: 'block' }}
        />
      ) : (
        initials ?? initialsOf(name)
      )}
    </span>
  );
}

export function AvatarStack({
  people,
  max = 4,
}: {
  people: Array<{ name: string; color?: string; initials?: string }>;
  max?: number;
}) {
  const visible = people.slice(0, max);
  const remaining = people.length - visible.length;
  return (
    <span className="ps-avatar-stack">
      {visible.map((p, i) => (
        <Avatar key={i} name={p.name} color={p.color} initials={p.initials} size="sm" />
      ))}
      {remaining > 0 && (
        <Avatar name={`+${remaining}`} initials={`+${remaining}`} size="sm" color="#1c1d2c" />
      )}
    </span>
  );
}
