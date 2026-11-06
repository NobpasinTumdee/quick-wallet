import { useCallback, useEffect, useRef, useState } from 'react';

import { UPLOAD_DELAY_MS, fetchRemotePrefs, prefKey, syncAvailable, takePullSlot, uploadLayout } from './layoutSync';
import { type Stamped, type SyncedLayoutFormat, layoutStorageKey, newer } from './layoutFormats';

export { type Stamped, type SyncedLayoutFormat, layoutStorageKey, newer } from './layoutFormats';

/**
 * A layout kept on this device and synced through UiPrefs — the part every
 * layout shares, whatever its format: desktop Home's grid (`layout.home-grid`,
 * which also reads the first version's `layout.home`) and the phone's card
 * order (`layout.home-mobile`).
 *
 *  - Read from this device before the first paint, so a saved arrangement
 *    never flashes the default first.
 *  - Sync is quiet (see layoutSync.ts). It compares this device's copy with
 *    the server's copies of the format's own key and of any older keys it
 *    reads; the newest wins (last write wins). Only the format's own key is
 *    ever written, and only when this device's copy is newer than all of
 *    them, so a copy the server already has is not sent back.
 *  - A save is stamped newer than anything before it and goes up ~2s later;
 *    leaving the page sends it at once.
 *  - Another tab of the same account saving updates this one.
 */

export function readRaw(page: string, userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    return window.localStorage.getItem(layoutStorageKey(page, userId));
  } catch {
    return null;
  }
}

function pagesOf(format: SyncedLayoutFormat<Stamped>): string[] {
  return [format.page, ...(format.legacyPages ?? [])];
}

/** This device's layout in the given format. */
export function readSyncedLayout<L extends Stamped>(format: SyncedLayoutFormat<L>, userId: string | undefined): L {
  const stored: Record<string, string | null> = {};
  for (const page of pagesOf(format)) stored[page] = readRaw(page, userId);
  return format.readLocal(stored);
}

/** Writes this device's copy. Storage can be full or blocked; the layout still applies for this visit. */
export function writeSyncedLayout<L extends Stamped>(format: SyncedLayoutFormat<L>, userId: string | undefined, layout: L): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(layoutStorageKey(format.page, userId), format.serialize(layout));
  } catch {
    /* Private mode or quota: nothing to do but keep going. */
  }
}

export function useSyncedLayout<L extends Stamped>(
  format: SyncedLayoutFormat<L>,
  userId: string | undefined,
  /** Talk to the server at all. Off where the layout does not apply, so a
   *  screen only ever asks about the layout it shows. */
  syncEnabled = true,
) {
  const { page } = format;
  const [layout, setLayout] = useState(() => readSyncedLayout(format, userId));

  /* Another account signing in on this device has its own layout. */
  const [forUser, setForUser] = useState(userId);
  if (forUser !== userId) {
    setForUser(userId);
    setLayout(readSyncedLayout(format, userId));
  }

  const latest = useRef(layout);
  latest.current = layout;

  /* ---- Sync with the server ---- */

  /** Takes a copy from the server as this device's own. */
  const adopt = useCallback(
    (next: L) => {
      writeSyncedLayout(format, userId, next);
      latest.current = next;
      setLayout(next);
    },
    [format, userId],
  );

  const push = useCallback(async () => {
    if (!userId) return;
    const current = latest.current;
    const result = await uploadLayout(page, format.serialize(current), current.updatedAt);
    /* The server kept a newer copy (another device saved after this one):
       that one wins, here too. */
    if (result && !result.accepted && result.pref) {
      const stored = format.fromRemote(result.pref, page);
      if (stored.updatedAt > latest.current.updatedAt) adopt(stored);
    }
  }, [page, format, userId, adopt]);

  /** Compares with the server: takes the newest copy, sends ours if ours is. */
  const check = useCallback(
    async (force: boolean) => {
      if (!syncEnabled || !userId || !syncAvailable() || !takePullSlot(page, userId, force)) return;
      const prefs = await fetchRemotePrefs();
      if (prefs === undefined) return;
      let best: L | null = null;
      let newestRemote = 0;
      for (const each of pagesOf(format)) {
        const pref = prefs[prefKey(each)];
        if (!pref) continue;
        const copy = format.fromRemote(pref, each);
        best = newer(best, copy);
        newestRemote = Math.max(newestRemote, copy.updatedAt);
      }
      if (best && best.updatedAt > latest.current.updatedAt) adopt(best);
      else if (latest.current.updatedAt > newestRemote) await push();
    },
    [syncEnabled, page, format, userId, adopt, push],
  );

  /* On load (at most once a minute), when the browser is back online, and
     when the tab is shown again after being in the background. */
  useEffect(() => {
    void check(false);
    const onOnline = () => void check(true);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check(false);
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [check]);

  /* A save goes up ~2s after the last change; leaving the page sends it now. */
  const uploadTimer = useRef<number | null>(null);
  const pushRef = useRef(push);
  pushRef.current = push;
  const scheduleUpload = useCallback(() => {
    if (uploadTimer.current !== null) window.clearTimeout(uploadTimer.current);
    uploadTimer.current = window.setTimeout(() => {
      uploadTimer.current = null;
      void pushRef.current();
    }, UPLOAD_DELAY_MS);
  }, []);
  useEffect(
    () => () => {
      if (uploadTimer.current === null) return;
      window.clearTimeout(uploadTimer.current);
      uploadTimer.current = null;
      void pushRef.current();
    },
    [],
  );

  /** Saves a layout as the user's own, newer than anything saved before. */
  const save = useCallback(
    (next: L) => {
      const stamped: L = { ...next, updatedAt: Math.max(Date.now(), latest.current.updatedAt + 1) };
      writeSyncedLayout(format, userId, stamped);
      latest.current = stamped;
      setLayout(stamped);
      scheduleUpload();
    },
    [format, userId, scheduleUpload],
  );

  /* The same account saving in another tab (or, for a legacy key, a tab
     still running the version that writes it). */
  useEffect(() => {
    if (!userId) return undefined;
    const keys = pagesOf(format).map((each) => layoutStorageKey(each, userId));
    const onStorage = (event: StorageEvent) => {
      if (!event.key || !keys.includes(event.key)) return;
      const next = readSyncedLayout(format, userId);
      if (next.updatedAt === latest.current.updatedAt && format.serialize(next) === format.serialize(latest.current)) return;
      latest.current = next;
      setLayout(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [format, userId]);

  return { layout, save };
}
