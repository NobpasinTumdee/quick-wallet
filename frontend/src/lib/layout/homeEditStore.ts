import { useSyncExternalStore } from 'react';

/**
 * Which page's desktop layout is being customised, if any.
 *
 * The Customize button lives in the top bar (AppShell) and the editor in the
 * page; this one value is all they share. The page turns it off when it
 * unmounts or the window drops below the sidebar breakpoint, so it can never
 * be left on for a page that is not there.
 */
let editing: string | null = null;
const listeners = new Set<() => void>();

/** Starts (`on`) or ends editing `page`. Ending a page that is not being edited does nothing. */
export function setLayoutEditing(page: string, on: boolean): void {
  const next = on ? page : editing === page ? null : editing;
  if (editing === next) return;
  editing = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useLayoutEditing(page: string): boolean {
  return useSyncExternalStore(subscribe, () => editing === page, () => false);
}

/* Which pages have their cards on screen right now (the board is mounted),
   so the top bar offers Customize only where there is something to arrange. */
const available = new Set<string>();

export function setLayoutAvailable(page: string, on: boolean): void {
  if (available.has(page) === on) return;
  if (on) available.add(page);
  else available.delete(page);
  listeners.forEach((listener) => listener());
}

export function useLayoutAvailable(page: string): boolean {
  return useSyncExternalStore(subscribe, () => available.has(page), () => false);
}

/* Home's, by its old names. */
export const HOME_EDIT_PAGE = 'home';
export const ANALYTICS_EDIT_PAGE = 'analytics';
export function setHomeEditing(next: boolean): void {
  setLayoutEditing(HOME_EDIT_PAGE, next);
}
export function useHomeEditing(): boolean {
  return useLayoutEditing(HOME_EDIT_PAGE);
}
