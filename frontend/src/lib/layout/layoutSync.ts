import { ApiError, api } from '../../api/client';
import { CardLayout, serializeLayout } from './layoutModel';

/**
 * Talking to the server about layouts (Code.gs `uiPrefs.list` / `uiPrefs.save`).
 *
 * Everything here is quiet: a failure never shows anything, because the
 * layout on this device keeps working whatever happens. The rules:
 *
 *  - A deployment without `uiPrefs` (the Code.gs from before this feature)
 *    answers 404 UNKNOWN_ACTION. Sync then switches off until the app is
 *    reloaded, and the layout is simply local — exactly as before syncing
 *    existed. After a redeploy, the next load picks it up by itself.
 *  - Offline, or any other error: nothing is lost. This device's copy is
 *    newer than the server's, so the next check (on load, when the browser
 *    comes back online, or when the tab is shown again) uploads it.
 */

/** Server values are capped at 20,000 characters (Code.gs UI_PREFS_VALUE_MAX_). */
export const MAX_LAYOUT_CHARS = 20000;
/** How often a load or a return to the tab may ask the server. */
export const PULL_INTERVAL_MS = 60_000;
/** A save is sent this long after the last change, so a burst is one request. */
export const UPLOAD_DELAY_MS = 2000;

export interface RemotePref {
  key: string;
  value: string;
  updatedAt: number;
}

let unavailable = false;
const lastPull = new Map<string, number>();

export function prefKey(page: string): string {
  return `layout.${page}`;
}

export function syncAvailable(): boolean {
  return !unavailable;
}

/** True when a check for this page and user is due; records it as made. */
export function takePullSlot(page: string, userId: string, force = false): boolean {
  const id = `${page}:${userId}`;
  const now = Date.now();
  const last = lastPull.get(id) ?? 0;
  if (!force && now - last < PULL_INTERVAL_MS) return false;
  lastPull.set(id, now);
  return true;
}

function noteFailure(error: unknown): void {
  if (error instanceof ApiError && error.status === 404 && error.code === 'UNKNOWN_ACTION') unavailable = true;
}

/** The stored copy, `null` when there is none, `undefined` when it could not be asked. */
export async function fetchRemoteLayout(page: string): Promise<RemotePref | null | undefined> {
  if (unavailable) return undefined;
  try {
    const result = await api.get<{ prefs?: RemotePref[] }>('/uiPrefs', { key: prefKey(page) });
    const pref = result?.prefs?.find((item) => item.key === prefKey(page));
    return pref && typeof pref.value === 'string' ? { ...pref, updatedAt: Number(pref.updatedAt) || 0 } : null;
  } catch (error) {
    noteFailure(error);
    return undefined;
  }
}

/**
 * Sends this device's layout. Answers what the server now holds when it kept
 * a newer copy (`accepted: false`), or `undefined` when it could not be sent.
 */
export async function uploadLayout(page: string, layout: CardLayout): Promise<{ accepted: boolean; pref?: RemotePref } | undefined> {
  if (unavailable || !(layout.updatedAt > 0)) return undefined;
  const value = serializeLayout(layout);
  if (value.length > MAX_LAYOUT_CHARS) return undefined;
  try {
    const result = await api.put<{ accepted?: boolean; pref?: RemotePref }>('/uiPrefs', {
      key: prefKey(page),
      value,
      updatedAt: layout.updatedAt,
    });
    return { accepted: result?.accepted !== false, pref: result?.pref };
  } catch (error) {
    noteFailure(error);
    return undefined;
  }
}
