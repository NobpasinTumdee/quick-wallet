import { useSyncExternalStore } from 'react';

/**
 * Whether desktop Home is being customised.
 *
 * The Customize button lives in the top bar (AppShell) and the editor in the
 * page (DashboardPage); this one flag is all they share. The page turns it
 * off when it unmounts or the window drops below the sidebar breakpoint, so
 * it can never be left on for a page that is not there.
 */
let editing = false;
const listeners = new Set<() => void>();

export function setHomeEditing(next: boolean): void {
  if (editing === next) return;
  editing = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useHomeEditing(): boolean {
  return useSyncExternalStore(subscribe, () => editing, () => false);
}
