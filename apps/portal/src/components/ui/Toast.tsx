import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';
import { dismissToast, useToast } from '../../state/toast';

/**
 * Global toast root. Rendered once near the App root so any action
 * creator can call {@link showToast} without threading a context.
 *
 * Auto-dismisses after 5s (timer lives in the toast state). The optional
 * action button lets toasts carry an Undo or Reconnect affordance.
 */
export function ToastRoot() {
  const toast = useToast();

  // Allow Esc to dismiss.
  useEffect(() => {
    if (!toast) return;
    function handler(e: KeyboardEvent) {
      if (e.key === 'Escape') dismissToast();
    }
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [toast]);

  if (!toast) return null;

  const Icon =
    toast.tone === 'success'
      ? CheckCircle2
      : toast.tone === 'danger'
      ? XCircle
      : toast.tone === 'warning'
      ? AlertTriangle
      : Info;

  // Portal to body so the toast escapes any ancestor that establishes a
  // containing block for fixed-positioned descendants (transform,
  // filter, backdrop-filter — used by the topbar's frosted-glass look).
  return createPortal(
    <div className="ps-toast-wrap" role="status" aria-live="polite">
      <div className={`ps-toast ps-toast--${toast.tone}`}>
        <Icon size={16} className="ps-toast__icon" aria-hidden="true" />
        <span className="ps-toast__message">{toast.message}</span>
        {toast.onAction && (
          <button
            type="button"
            className="ps-toast__action"
            onClick={() => {
              toast.onAction?.();
              dismissToast();
            }}
          >
            {toast.actionLabel}
          </button>
        )}
        <button
          type="button"
          className="ps-toast__dismiss"
          aria-label="Dismiss"
          onClick={dismissToast}
        >
          <X size={14} />
        </button>
      </div>
    </div>,
    document.body
  );
}
