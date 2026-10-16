// A single app-wide toast, held in module state and exposed through a hook.
// Auto-dismisses after 5s. Mutations call showToast on success and failure.
import { useSyncExternalStore } from 'react';

export type ToastTone = 'success' | 'info' | 'warning' | 'danger';

export interface Toast {
  id: number;
  message: string;
  tone: ToastTone;
  actionLabel?: string;
  onAction?: () => void;
}

let current: Toast | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

export function showToast(message: string, tone: ToastTone = 'success', action?: { label: string; onAction: () => void }): void {
  if (timer) clearTimeout(timer);
  current = { id: Date.now(), message, tone, actionLabel: action?.label, onAction: action?.onAction };
  emit();
  timer = setTimeout(dismissToast, 5000);
}

export function dismissToast(): void {
  if (timer) clearTimeout(timer);
  timer = null;
  current = null;
  emit();
}

export function useToast(): Toast | null {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => current,
  );
}
