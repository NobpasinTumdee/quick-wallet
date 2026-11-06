import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

import {
  GridCardDef,
  GridLayout,
  defaultGridLayout,
  isDefaultGridLayout,
  migrateV1,
  sanitizeGridLayout,
  serializeGridLayout,
} from './gridModel';
import { CardDef, CardLayout, ColumnSpan, effectiveSpan, sanitizeLayout } from './layoutModel';
import { RemotePref, UPLOAD_DELAY_MS, fetchRemotePrefs, prefKey, syncAvailable, takePullSlot, uploadLayout } from './layoutSync';

/** `qw.layout.<page>.<userId>` — one layout per page, per user, per device. */
export function layoutStorageKey(page: string, userId: string): string {
  return `qw.layout.${page}.${userId}`;
}

function readRaw(page: string, userId: string | undefined): string | null {
  if (!userId) return null;
  try {
    return window.localStorage.getItem(layoutStorageKey(page, userId));
  } catch {
    return null;
  }
}

/** Of two copies, the newer; on a tie the first (the current format's own). */
function newer<T extends { updatedAt: number }>(a: T | null, b: T | null): T | null {
  if (!a) return b;
  if (!b) return a;
  return b.updatedAt > a.updatedAt ? b : a;
}

/** A first-version layout, in the current format. */
function fromLegacy<Id extends string>(raw: unknown, registry: readonly CardDef<Id>[]): GridLayout<Id> {
  return migrateV1(sanitizeLayout(raw, registry) as CardLayout<Id>);
}

/**
 * This device's layout: its own copy in the current format, or the first
 * version's copy migrated when that is newer (or the only one) — so a layout
 * saved before the update looks exactly as it did. The default when there is
 * neither. The first version's copy is only read, never written.
 */
export function readLocalLayout<Id extends string>(
  page: string,
  legacyPage: string,
  userId: string | undefined,
  registry: readonly GridCardDef<Id>[],
): GridLayout<Id> {
  const own = readRaw(page, userId);
  const legacy = readRaw(legacyPage, userId);
  const current = own !== null ? sanitizeGridLayout(own, registry) : null;
  const migrated = legacy !== null ? fromLegacy(legacy, registry) : null;
  return newer(current, migrated) ?? defaultGridLayout(registry);
}

/** Writes this device's copy. Storage can be full or blocked; the layout still applies for this visit. */
export function writeLocalLayout<Id extends string>(page: string, userId: string | undefined, layout: GridLayout<Id>): void {
  if (!userId) return;
  try {
    window.localStorage.setItem(layoutStorageKey(page, userId), serializeGridLayout(layout));
  } catch {
    /* Private mode or quota: nothing to do but keep going. */
  }
}

/**
 * The page's layout, read before the first paint so a saved arrangement
 * never flashes the default first.
 *
 * Sync (always quiet, see layoutSync.ts) compares three copies: this
 * device's, the server's in the current format and the server's from the
 * first version. The newest wins — last write wins, as before — and a
 * first-version copy that wins is migrated. Only the current format is ever
 * uploaded, and only when this device's copy is newer than both, so a
 * migration of a copy the server already has is not sent back.
 */
export function useCardLayout<Id extends string>(
  page: string,
  legacyPage: string,
  userId: string | undefined,
  registry: readonly GridCardDef<Id>[],
  /** Talk to the server at all. Off where the layout does not apply (below
   *  the sidebar breakpoint), so phones and tablets make no extra request. */
  syncEnabled = true,
) {
  const [layout, setLayout] = useState(() => readLocalLayout(page, legacyPage, userId, registry));

  /* Another account signing in on this device has its own layout. */
  const [forUser, setForUser] = useState(userId);
  if (forUser !== userId) {
    setForUser(userId);
    setLayout(readLocalLayout(page, legacyPage, userId, registry));
  }

  const latest = useRef(layout);
  latest.current = layout;

  /* ---- Sync with the server ---- */

  /** Takes a copy from the server as this device's own. */
  const adopt = useCallback(
    (next: GridLayout<Id>) => {
      writeLocalLayout(page, userId, next);
      latest.current = next;
      setLayout(next);
    },
    [page, userId],
  );

  const fromRemote = useCallback(
    (pref: RemotePref): GridLayout<Id> => ({ ...sanitizeGridLayout(pref.value, registry), updatedAt: pref.updatedAt }),
    [registry],
  );

  const push = useCallback(async () => {
    if (!userId) return;
    const current = latest.current;
    const result = await uploadLayout(page, serializeGridLayout(current), current.updatedAt);
    /* The server kept a newer copy (another device saved after this one):
       that one wins, here too. */
    if (result && !result.accepted && result.pref) {
      const stored = fromRemote(result.pref);
      if (stored.updatedAt > latest.current.updatedAt) adopt(stored);
    }
  }, [page, userId, fromRemote, adopt]);

  /** Compares with the server: takes the newest copy, sends ours if ours is. */
  const check = useCallback(
    async (force: boolean) => {
      if (!syncEnabled || !userId || !syncAvailable() || !takePullSlot(page, userId, force)) return;
      const prefs = await fetchRemotePrefs();
      if (prefs === undefined) return;
      const ownPref = prefs[prefKey(page)];
      const legacyPref = prefs[prefKey(legacyPage)];
      const remote = ownPref ? fromRemote(ownPref) : null;
      const legacy = legacyPref ? { ...fromLegacy(legacyPref.value, registry), updatedAt: legacyPref.updatedAt } : null;
      const best = newer(remote, legacy);
      if (best && best.updatedAt > latest.current.updatedAt) adopt(best);
      else if (latest.current.updatedAt > Math.max(remote?.updatedAt ?? 0, legacy?.updatedAt ?? 0)) await push();
    },
    [syncEnabled, page, legacyPage, userId, registry, fromRemote, adopt, push],
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
    (next: GridLayout<Id>) => {
      const stamped: GridLayout<Id> = { ...next, updatedAt: Math.max(Date.now(), latest.current.updatedAt + 1) };
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
  const reset = useCallback(() => save({ ...defaultGridLayout(registry), reset: true }), [save, registry]);

  /* The same account customising Home in another tab (or, for the first
     version's key, a tab still running that version). */
  useEffect(() => {
    if (!userId) return undefined;
    const keys = [layoutStorageKey(page, userId), layoutStorageKey(legacyPage, userId)];
    const onStorage = (event: StorageEvent) => {
      if (!event.key || !keys.includes(event.key)) return;
      const next = readLocalLayout(page, legacyPage, userId, registry);
      if (next.updatedAt === latest.current.updatedAt && serializeGridLayout(next) === serializeGridLayout(latest.current)) return;
      latest.current = next;
      setLayout(next);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, [page, legacyPage, userId, registry]);

  const isCustom = useMemo(() => !isDefaultGridLayout(layout, registry), [layout, registry]);
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
