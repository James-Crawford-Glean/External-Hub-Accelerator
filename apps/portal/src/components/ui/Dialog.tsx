import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './Button';

interface DialogProps {
  open: boolean;
  title: string;
  subtitle?: string;
  onClose: () => void;
  /** Primary action button content. If omitted, only Close is shown. */
  primaryAction?: {
    label: string;
    onClick: () => void;
    variant?: 'primary' | 'brand' | 'accent' | 'danger';
    disabled?: boolean;
  };
  /** Cancel button label (defaults to "Cancel"). */
  cancelLabel?: string;
  /** Optional content under the footer's left edge — e.g. a secondary link. */
  footerHint?: React.ReactNode;
  /** Width override; defaults to ~480px. */
  width?: number | string;
  /** Height override; defaults to content height (capped by max-height). */
  height?: number | string;
  children: React.ReactNode;
}

/**
 * Modal dialog primitive. Centered card with backdrop, header, body,
 * and footer. Esc / click-outside / close button all dismiss.
 *
 * Designed to match the rest of the design system;
 * neutral surface, brand accent on focus, light shadow. Use sparingly
 * — most actions in the app should be inline.
 */
export function Dialog({
  open,
  title,
  subtitle,
  onClose,
  primaryAction,
  cancelLabel = 'Cancel',
  footerHint,
  width = 480,
  height,
  children,
}: DialogProps) {
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open, onClose]);

  // Lock body scroll while open.
  useEffect(() => {
    if (!open) return;
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, [open]);

  if (!open) return null;

  // Render through a portal at document.body so the fixed-position
  // backdrop is never trapped by an ancestor that establishes its own
  // containing block (transform / filter / backdrop-filter / will-change
  // all do that). Without this, opening a dialog from inside the
  // backdrop-filtered topbar squeezed the modal into the topbar's strip.
  return createPortal(
    <div
      className="ps-dialog__backdrop"
      role="presentation"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className="ps-dialog"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        style={{
          width: typeof width === 'number' ? `${width}px` : width,
          ...(height != null
            ? { height: typeof height === 'number' ? `${height}px` : height }
            : {}),
        }}
      >
        <header className="ps-dialog__header">
          <div>
            <h2 className="ps-dialog__title">{title}</h2>
            {subtitle && <p className="ps-dialog__subtitle">{subtitle}</p>}
          </div>
          <button
            type="button"
            className="ps-dialog__close"
            onClick={onClose}
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </header>
        <div className="ps-dialog__body">{children}</div>
        <footer className="ps-dialog__footer">
          <div className="ps-dialog__footer-hint">{footerHint}</div>
          <div className="ps-row" style={{ gap: 8 }}>
            <Button variant="ghost" onClick={onClose}>
              {cancelLabel}
            </Button>
            {primaryAction && (
              <Button
                variant={primaryAction.variant ?? 'primary'}
                onClick={primaryAction.onClick}
                disabled={primaryAction.disabled}
              >
                {primaryAction.label}
              </Button>
            )}
          </div>
        </footer>
      </div>
    </div>,
    document.body
  );
}
