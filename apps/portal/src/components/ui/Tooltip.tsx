import {
  type CSSProperties,
  type ElementType,
  type ReactNode,
  type RefObject,
  useCallback,
  useEffect,
  useRef,
  useState,
} from 'react';
import { createPortal } from 'react-dom';

// Hover tooltip that fixes the native `title`: no ~700ms delay-then-nothing, no help
// cursor, and it reliably re-appears. The tip is portaled to <body> so it escapes
// overflow-clipped containers (the home hero uses overflow: hidden), and positions
// itself above the trigger (flipping below when there isn't room).
//
// One tooltip shows at a time, and a shared open-window means sweeping across adjacent
// triggers reveals each tip instantly instead of re-waiting the open delay.

const OPEN_DELAY = 150;
const CLOSE_DELAY = 80;
const SKIP_WINDOW = 300;

let lastClosedAt = 0;
let activeToken: object | null = null;
let activeClose: (() => void) | null = null;

interface TooltipProps {
  content: ReactNode;
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
  /** Element rendered as the hover target. Defaults to a div (block wrapper). */
  as?: ElementType;
  /** Render the trigger element only — no hover behavior, no tip. Lets a caller
   *  keep the same element (and its ref) but surface a tip conditionally, e.g. a
   *  truncating label that only wants a tooltip when the text is actually clipped. */
  disabled?: boolean;
  /** Ref onto the trigger element (used as-is when provided) — e.g. so a caller
   *  can measure it for clip detection. */
  elementRef?: RefObject<HTMLElement | null>;
}

export function Tooltip({
  content,
  children,
  className,
  style,
  as = 'div',
  disabled = false,
  elementRef,
}: TooltipProps) {
  const internalRef = useRef<HTMLElement | null>(null);
  // Use the caller's ref directly when given, so their measurement + our
  // positioning read the same node without a merging callback ref.
  const triggerRef = elementRef ?? internalRef;
  const tipRef = useRef<HTMLDivElement>(null);
  const tokenRef = useRef<object>({});
  const showTimer = useRef<number | undefined>(undefined);
  const hideTimer = useRef<number | undefined>(undefined);
  const [open, setOpen] = useState(false);

  const close = useCallback(() => {
    window.clearTimeout(showTimer.current);
    window.clearTimeout(hideTimer.current);
    setOpen((wasOpen) => {
      if (wasOpen) lastClosedAt = Date.now();
      return false;
    });
    if (activeToken === tokenRef.current) {
      activeToken = null;
      activeClose = null;
    }
  }, []);

  const scheduleOpen = useCallback(() => {
    window.clearTimeout(hideTimer.current);
    const instant = activeClose !== null || Date.now() - lastClosedAt < SKIP_WINDOW;
    showTimer.current = window.setTimeout(
      () => {
        activeClose?.();
        activeToken = tokenRef.current;
        activeClose = close;
        setOpen(true);
      },
      instant ? 0 : OPEN_DELAY,
    );
  }, [close]);

  const scheduleClose = useCallback(() => {
    window.clearTimeout(showTimer.current);
    hideTimer.current = window.setTimeout(close, CLOSE_DELAY);
  }, [close]);

  // Position after paint so the opacity:0 start frame commits and the fade-in runs.
  useEffect(() => {
    if (!open) return;
    const trigger = triggerRef.current;
    const tip = tipRef.current;
    if (!trigger || !tip) return;
    let raf = 0;
    const place = () => {
      const t = trigger.getBoundingClientRect();
      const { offsetWidth: tw, offsetHeight: th } = tip;
      const above = t.top - th - 8 >= 8;
      tip.style.top = `${above ? t.top - th - 8 : t.bottom + 8}px`;
      tip.style.left = `${Math.max(8, Math.min(t.left + t.width / 2 - tw / 2, window.innerWidth - tw - 8))}px`;
      raf = requestAnimationFrame(() => tip.classList.add('ps-tooltip--visible'));
    };
    place();
    return () => cancelAnimationFrame(raf);
  }, [open, content, triggerRef]);

  // A stale fixed position after scroll/resize is worse than no tip — close it.
  useEffect(() => {
    if (!open) return;
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  // If the tip is disabled mid-hover (e.g. the label stops being clipped), drop it.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (disabled) close();
  }, [disabled, close]);

  useEffect(
    () => () => {
      window.clearTimeout(showTimer.current);
      window.clearTimeout(hideTimer.current);
      if (activeToken === tokenRef.current) {
        activeToken = null;
        activeClose = null;
      }
    },
    [],
  );

  const Trigger = as;
  if (disabled) {
    return (
      <Trigger ref={triggerRef} className={className} style={style}>
        {children}
      </Trigger>
    );
  }

  return (
    <Trigger
      ref={triggerRef}
      className={className}
      style={style}
      onMouseEnter={scheduleOpen}
      onMouseLeave={scheduleClose}
      onFocus={scheduleOpen}
      onBlur={scheduleClose}
    >
      {children}
      {open &&
        createPortal(
          <div ref={tipRef} role="tooltip" className="ps-tooltip">
            {content}
          </div>,
          document.body,
        )}
    </Trigger>
  );
}

/** Tooltip body as a title plus short bullets. A paragraph in a 260px box wraps into
 *  something nobody reads; a few scannable lines land. Keep each line a fragment, not a
 *  sentence — no trailing full stops.
 *
 *  A component rather than a helper returning JSX: a non-component export alongside
 *  Tooltip breaks Fast Refresh for this file (react-refresh/only-export-components). */
export function TipList({ title, lines }: { title: string; lines: string[] }) {
  return (
    <>
      <span className="ps-tooltip__title">{title}</span>
      <ul className="ps-tooltip__list">
        {lines.map((l) => (
          <li key={l}>{l}</li>
        ))}
      </ul>
    </>
  );
}
