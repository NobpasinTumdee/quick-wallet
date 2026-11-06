import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  CardDef,
  CardLayout,
  ColumnSpan,
  defaultLayout,
  effectiveSpan,
  isDefaultLayout,
  reconcileLayouts,
  sanitizeLayout,
  serializeLayout,
} from './layoutModel';
import { RemotePref, UPLOAD_DELAY_MS, fetchRemoteLayout, syncAvailable, takePullSlot, uploadLayout } from './layoutSync';

/** `qw.layout.<page>.<userId>` — one layout per page, per user, per device. */
export function layoutStorageKey(page: string, userId: string): string {
  return `qw.layout.${page}.${userId}`;
}

/** This device's copy, sanitised; the default when there is none or it is unreadable. */
export function readLocalLayout<Id extends string>(
  page: string,
  userId: string | undefined,
  registry: readonly CardDef<Id>[],
): CardLayout<Id> {
  let raw: string | null = null;
  if (userId) {
    try {
      raw = window.localStorage.getItem(layoutStorageKey(page, userId));
    } catch {
      raw = null;
    }
  }
  return sanitizeLayout(raw, registry);
}

/** Writes this device's copy. Storage can be full or blocked; the layout still applies for this visit. */
export function writeLocalLayout<Id extends string>(page: string, userId: string | undefined, layout: CardLayout<Id>): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(layoutStorageKey(page, userId), serializeLayout(layout));
  } catch {
    /* Private mode or quota: nothing to do but keep going. */
  }
}

/**
 * The page's layout, read before the first paint so a saved arrangement
 * never flashes the default first.
 */
export function useCardLayout<Id extends string>(
  page: string,
  userId: string | undefined,
  registry: readonly CardDef<Id>[],
  /** Talk to the server at all. Off where the layout does not apply (below
   *  the sidebar breakpoint), so phones and tablets make no extra request. */
  syncEnabled = true,
) {
  const [layout, setLayout] = useState(() => readLocalLayout(page, userId, registry));

  /* Another account signing in on this device has its own layout. */
  const [forUser, setForUser] = useState(userId);
  if (forUser !== userId) {
    setForUser(userId);
    setLayout(readLocalLayout(page, userId, registry));
  }

  const latest = useRef(layout);
  latest.current = layout;

  /* ---- Sync with the server (see layoutSync.ts; always quiet) ---- */

  /** Takes a copy from the server as this device's own. */
  const adopt = useCallback(
    (next: CardLayout<Id>) => {
      writeLocalLayout(page, userId, next);
      latest.current = next;
      setLayout(next);
    },
    [page, userId],
  );

  const fromRemote = useCallback(
    (pref: RemotePref): CardLayout<Id> => ({ ...sanitizeLayout(pref.value, registry), updatedAt: pref.updatedAt }),
    [registry],
  );

  const push = useCallback(async () => {
    if (!userId) return;
    const result = await uploadLayout(page, latest.current);
    /* The server kept a newer copy (another device saved after this one):
       that one wins, here too. */
    if (result && !result.accepted && result.pref) {
      const stored = fromRemote(result.pref);
      if (stored.updatedAt > latest.current.updatedAt) adopt(stored);
    }
  }, [page, userId, fromRemote, adopt]);

  /** Compares with the server: takes its copy if newer, sends ours if ours is. */
  const check = useCallback(
    async (force: boolean) => {
      if (!syncEnabled || !userId || !syncAvailable() || !takePullSlot(page, userId, force)) return;
      const remote = await fetchRemoteLayout(page);
      if (remote === undefined) return;
      const remoteLayout = remote ? fromRemote(remote) : null;
      const action = reconcileLayouts(latest.current, remoteLayout);
      if (action === 'adopt' && remoteLayout) adopt(remoteLayout);
      else if (action === 'upload') await push();
    },
    [syncEnabled, page, userId, fromRemote, adopt, push],
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
    (next: CardLayout<Id>) => {
      const stamped: CardLayout<Id> = { ...next, updatedAt: Math.max(Date.now(), latest.current.updatedAt + 1) };
      writeLocalLayout(page, userId, stamped);
      latest.current = stamped;
      setLayout(stamped);
      scheduleUpload();
    },
    [page, userId, scheduleUpload],
  );

  /** Back to the default. Saved as a marker rather than deleted — here and on
   *  the server — so this newer "reset" wins over an older custom copy on
   *  another device, which then lets go of it too. */
  const reset = useCallback(() => save({ ...defaultLayout(registry), reset: true }), [save, registry]);

  /* The same account customising Home in another tab. */
  useEffect(() => {
    if (!userId) return undefined;
    const key = layoutStorageKey(page, userId);
    const onStorage = (event: StorageEvent) => {
      if (event.key !== key) return;
      const next = sanitizeLayout(event.newValue, registry);
      latest.current = next;
      setLayout(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [page, userId, registry]);

  const isCustom = useMemo(() => !isDefaultLayout(layout, registry), [layout, registry]);
  return { layout, save, reset, isCustom };
}

/**
 * The grid's content width and column gap, kept current. Takes the element
 * itself (from a callback ref), because the grid mounts only once the page
 * has data. Measured in a layout effect, so the first paint already uses it.
 */
export function useGridMetrics(element: HTMLElement | null, active: boolean): { width: number; gap: number } {
  const [metrics, setMetrics] = useState({ width: 0, gap: 0 });

  useLayoutEffect(() => {
    if (!active || !element) return undefined;
    const measure = () => {
      const style = getComputedStyle(element);
      const width = element.clientWidth - parseFloat(style.paddingLeft || '0') - parseFloat(style.paddingRight || '0');
      const gap = parseFloat(style.columnGap || '0') || 0;
      setMetrics((current) => (current.width === width && current.gap === gap ? current : { width, gap }));
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, [element, active]);

  return metrics;
}

/** Each card's drawn width for this grid. */
export function useEffectiveSpans<Id extends string>(
  layout: CardLayout<Id>,
  registry: readonly CardDef<Id>[],
  metrics: { width: number; gap: number },
): Record<string, ColumnSpan> {
  return useMemo(() => {
    const spans: Record<string, ColumnSpan> = {};
    for (const card of layout.cards) {
      const def = registry.find((item) => item.id === card.id);
      spans[card.id] = def ? effectiveSpan(def, card.w, metrics.width, metrics.gap) : card.w;
    }
    return spans;
  }, [layout, registry, metrics.width, metrics.gap]);
}
