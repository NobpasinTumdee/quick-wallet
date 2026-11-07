import { type AnalyticsCardId, ANALYTICS_CARDS, ANALYTICS_ORDER_PAGE } from './analyticsCards';
import type { CatalogCardId } from './cardCatalog';
import { HOME_BOARD_CARDS, HOME_ORDER_PAGE } from './homeCards';
import { type GridCardDef, type GridLayout, defaultGridLayout, migrateV1, sanitizeGridLayout, serializeGridLayout } from './gridModel';
import { type CardDef, type CardLayout, sanitizeLayout } from './layoutModel';
import type { RemotePref } from './layoutSync';
import { type CardOrder, type OrderCardDef, sanitizeOrder, serializeOrder } from './orderModel';

/**
 * The layouts that sync through UiPrefs, as formats for the shared sync core
 * (useSyncedLayout.ts): how each is read from this device and from the
 * server, and how it is written. Pure — no React, no requests — so the
 * tests load it directly.
 */

/** `qw.layout.<page>.<userId>` — one layout per page, per user, per device. */
export function layoutStorageKey(page: string, userId: string): string {
  return `qw.layout.${page}.${userId}`;
}

/** Anything with the time it was saved. */
export interface Stamped {
  updatedAt: number;
}

/** How one layout is read, compared and written. Keep it stable (memoised). */
export interface SyncedLayoutFormat<L extends Stamped> {
  /** The key this format writes: `qw.layout.<page>.<user>` here, `layout.<page>` on the server. */
  page: string;
  /** Older keys that are read (and migrated) but never written. */
  legacyPages?: readonly string[];
  /** This device's layout from what is stored under `page` and each legacy page (`null` = nothing stored). */
  readLocal(stored: Readonly<Record<string, string | null>>): L;
  /** A server copy of `page` or of a legacy page, in this format, stamped with the server's time. */
  fromRemote(pref: RemotePref, page: string): L;
  serialize(layout: L): string;
}

/** Of two copies, the newer; on a tie the first (the current format's own). */
export function newer<T extends Stamped>(a: T | null, b: T | null): T | null {
  if (!a) return b;
  if (!b) return a;
  return b.updatedAt > a.updatedAt ? b : a;
}

/* ---- Desktop Home: the grid (layout.home-grid, reading layout.home) ---- */

/** A first-version layout, in the current format. */
function fromLegacy<Id extends string>(raw: unknown, registry: readonly CardDef<Id>[]): GridLayout<Id> {
  return migrateV1(sanitizeLayout(raw, registry) as CardLayout<Id>);
}

/**
 * A page's desktop grid layout as a synced format: its own key, plus — for
 * Home — the first version's key, which is read and migrated (when it is the
 * newer copy, or the only one, so a layout saved before the update looks
 * exactly as it did) but never written: a PC still on that version keeps its
 * own copy. A page without a first version (Analytics) has no older key.
 */
export function gridLayoutFormat<Id extends string>(
  page: string,
  legacyPage: string | undefined,
  registry: readonly GridCardDef<Id>[],
): SyncedLayoutFormat<GridLayout<Id>> {
  return {
    page,
    legacyPages: legacyPage === undefined ? undefined : [legacyPage],
    readLocal(stored) {
      const own = stored[page] ?? null;
      const legacy = legacyPage === undefined ? null : (stored[legacyPage] ?? null);
      const current = own !== null ? sanitizeGridLayout(own, registry) : null;
      const migrated = legacy !== null ? fromLegacy(legacy, registry) : null;
      return newer(current, migrated) ?? defaultGridLayout(registry);
    },
    fromRemote(pref, from) {
      const layout = from === page ? sanitizeGridLayout(pref.value, registry) : fromLegacy(pref.value, registry);
      return { ...layout, updatedAt: pref.updatedAt };
    },
    serialize: serializeGridLayout,
  };
}

/* ---- Below 1000px: the card order (layout.<page>-mobile) ---- */

/** A page's phone order as a synced format: one key, nothing older to read. */
export function orderFormat<Id extends string>(
  page: string,
  registry: readonly OrderCardDef<Id>[],
): SyncedLayoutFormat<CardOrder<Id>> {
  return {
    page,
    readLocal: (stored) => sanitizeOrder(stored[page] ?? null, registry),
    fromRemote: (pref) => ({ ...sanitizeOrder(pref.value, registry), updatedAt: pref.updatedAt }),
    serialize: serializeOrder,
  };
}

/** Home's (layout.home-mobile): its own cards and any Analytics cards added to it. */
export const HOME_ORDER_FORMAT: SyncedLayoutFormat<CardOrder<CatalogCardId>> = orderFormat(HOME_ORDER_PAGE, HOME_BOARD_CARDS);

/** Analytics' (layout.analytics-mobile). */
export const ANALYTICS_ORDER_FORMAT: SyncedLayoutFormat<CardOrder<AnalyticsCardId>> = orderFormat(ANALYTICS_ORDER_PAGE, ANALYTICS_CARDS);

