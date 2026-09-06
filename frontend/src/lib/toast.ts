import { useSyncExternalStore } from 'react';

/**
 * Minimal toast store.
 *
 * Module-level rather than a React context so the data hooks can raise a toast
 * from inside a rollback, where there is no component to read a context from.
 */

export type ToastTone = 'error' | 'warning' | 'success' | 'info';

export interface Toast {
  id: number;
  tone: ToastTone;
  title?: string;
  message: string;
}

const DURATIONS: Record<ToastTone, number> = {
  // Errors need long enough to read and act on; confirmations don't.
  error: 7000,
  // Warnings are advisory rather than blocking — long enough to read a
  // sentence and glance at the tab it points to, then out of the way.
  warning: 6000,
  success: 3200,
  info: 4500,
};

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<() => void>();

function emit(): void {
  listeners.forEach((fn) => fn());
}

export function dismissToast(id: number): void {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

function push(tone: ToastTone, message: string, title?: string): number {
  const id = nextId++;
  // Cap the stack so a failing loop can't bury the screen.
  toasts = [...toasts, { id, tone, title, message }].slice(-4);
  emit();
  window.setTimeout(() => dismissToast(id), DURATIONS[tone]);
  return id;
}

export const toast = {
  error: (message: string, title?: string) => push('error', message, title),
  warning: (message: string, title?: string) => push('warning', message, title),
  success: (message: string, title?: string) => push('success', message, title),
  info: (message: string, title?: string) => push('info', message, title),
};

export function useToasts(): Toast[] {
  return useSyncExternalStore(
    (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
    () => toasts,
    () => toasts,
  );
}
