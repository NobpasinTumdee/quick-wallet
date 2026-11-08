/**
 * Card layouts: the pure part, first format ("flow").
 *
 * Free placement (gridModel.ts) stores x, y, w and h per card. This file is
 * the format before it, which is still how a layout nobody has placed yet is
 * read and drawn — the default, and anything migrated from the old app's
 * `layout.home` — so those look exactly as they always did.
 *
 * A page that can be rearranged (desktop Home today, Analytics later) has a
 * registry of its cards and, per user, a saved layout: the cards in display
 * order, each with a width in grid columns (of 12) and a few flags. The grid
 * packs them in that order (no x/y in this format), so such a layout can
 * never overlap and reflows by itself at any width.
 *
 * Everything here is pure and has no React or DOM in it, so it runs in the
 * node tests (tests/layoutModel.test.mjs).
 *
 * The one rule that keeps every saved layout safe — written on another
 * version, edited by hand, half-written by a dying tab — is `sanitizeLayout`:
 * whatever comes in, what comes out is a complete, valid layout for the
 * registry as it is *now*.
 */

/** Grid width steps, in columns of 12. */
export type ColumnSpan = 3 | 4 | 6 | 8 | 12;
export const ALL_SPANS: readonly ColumnSpan[] = [3, 4, 6, 8, 12];
export const GRID_COLUMNS = 12;

/** Height steps. Height otherwise follows the content. */
export type HeightStep = 'normal' | 'tall';

export interface CardDef<Id extends string = string> {
  id: Id;
  /** Widths this card may be set to, ascending. Includes `defaultW`. */
  widths: readonly ColumnSpan[];
  /**
   * The narrowest the card may actually be drawn, in pixels, before its
   * content stops fitting. A chosen width that would come out narrower on
   * the current screen is drawn at the next allowed step that fits — see
   * `effectiveSpan`. Never more than the default width measures on the
   * narrowest desktop, so the default layout is never changed by it.
   */
  minPx: number;
  defaultW: ColumnSpan;
  /** Height steps, when the card has any; the first is the default. */
  heights?: readonly HeightStep[];
  /**
   * Another page's card that can be added here (an Analytics card on Home).
   * It is never part of the default, never inserted into a saved layout that
   * lacks it, and kept only where a saved layout already has it.
   */
  addable?: true;
  /**
   * An addable card that is one of the page's own optional cards (Home's
   * Favourites) rather than another page's: the editors list it under
   * "More cards", not "From Analytics". Behaves exactly like `addable`.
   */
  extra?: true;
}

export interface CardState<Id extends string = string> {
  id: Id;
  w: ColumnSpan;
  h?: HeightStep;
  collapsed?: boolean;
  hidden?: boolean;
}

export interface CardLayout<Id extends string = string> {
  v: 1;
  /** Milliseconds; 0 for the built-in default. Last write wins on sync. */
  updatedAt: number;
  /** Every card in the registry exactly once, in display order. */
  cards: CardState<Id>[];
  /**
   * Set on a layout that means "back to the default": what Reset saves, so a
   * device holding an older custom copy sees something newer and lets go of
   * it, rather than pushing its own copy back up.
   */
  reset?: true;
}

export const LAYOUT_VERSION = 1;

/** The page's own cards: the registry without the ones that can only be added. */
export function ownCards<D extends { addable?: true }>(registry: readonly D[]): readonly D[] {
  return registry.some((def) => def.addable) ? registry.filter((def) => !def.addable) : registry;
}

/** The registry's own layout: its order, its default sizes, nothing hidden. */
export function defaultLayout<Id extends string>(all: readonly CardDef<Id>[], updatedAt = 0): CardLayout<Id> {
  const registry = ownCards(all);
  return {
    v: 1,
    updatedAt,
    cards: registry.map((def) => (def.heights ? { id: def.id, w: def.defaultW, h: def.heights[0] } : { id: def.id, w: def.defaultW })),
  };
}

/** The allowed width closest to `w`; on a tie the wider, so content never loses room. */
export function nearestWidth(def: Pick<CardDef, 'widths' | 'defaultW'>, w: unknown): ColumnSpan {
  const value = typeof w === 'number' && Number.isFinite(w) ? w : def.defaultW;
  let best = def.widths[0] ?? def.defaultW;
  for (const step of def.widths) {
    const gap = Math.abs(step - value);
    const bestGap = Math.abs(best - value);
    if (gap < bestGap || (gap === bestGap && step > best)) best = step;
  }
  return best;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Anything → a complete, valid layout for `registry`.
 *
 * - Not an object, wrong version, no card list, a `reset` marker: the default
 *   (keeping a valid `updatedAt`, so a reset still wins a sync).
 * - Unknown card ids are dropped, and so is every repeat of an id.
 * - A width that is not allowed becomes the nearest one that is; an unknown
 *   height, the card's default height; flags are only kept when `true`.
 * - A card the registry has but the layout does not — one added in a later
 *   version — goes in after the card that precedes it in the default order,
 *   so it appears where it would have by default rather than at the end.
 */
export function sanitizeLayout<Id extends string>(raw: unknown, registry: readonly CardDef<Id>[]): CardLayout<Id> {
  const input = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!isObject(input)) return defaultLayout(registry);

  const updatedAt =
    typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt) && input.updatedAt > 0
      ? Math.floor(input.updatedAt)
      : 0;
  if (input.v !== LAYOUT_VERSION || !Array.isArray(input.cards) || input.reset === true) {
    const fallback = defaultLayout(registry, updatedAt);
    return input.reset === true ? { ...fallback, reset: true } : fallback;
  }

  const byId = new Map(registry.map((def) => [def.id as string, def]));
  const seen = new Set<string>();
  const cards: CardState<Id>[] = [];

  for (const entry of input.cards) {
    if (!isObject(entry) || typeof entry.id !== 'string') continue;
    const def = byId.get(entry.id);
    if (!def || seen.has(entry.id)) continue;
    seen.add(entry.id);

    const card: CardState<Id> = { id: def.id, w: nearestWidth(def, entry.w) };
    if (def.heights) card.h = def.heights.includes(entry.h as HeightStep) ? (entry.h as HeightStep) : def.heights[0];
    if (entry.collapsed === true) card.collapsed = true;
    if (entry.hidden === true) card.hidden = true;
    cards.push(card);
  }

  /* Cards the saved layout never heard of, at their default spot (never an
     addable one: those are only ever there because they were added). */
  const own = ownCards(registry);
  own.forEach((def, index) => {
    if (seen.has(def.id)) return;
    seen.add(def.id);
    const fresh: CardState<Id> = def.heights ? { id: def.id, w: def.defaultW, h: def.heights[0] } : { id: def.id, w: def.defaultW };
    let at = 0;
    for (let back = index - 1; back >= 0; back -= 1) {
      const position = cards.findIndex((card) => card.id === own[back].id);
      if (position !== -1) {
        at = position + 1;
        break;
      }
    }
    cards.splice(at, 0, fresh);
  });

  return { v: 1, updatedAt, cards };
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/* ---- Widths on screen ---- */

/** Pixel width of `span` columns in a grid `container` px wide with `gap` px gaps. */
export function spanPixels(span: number, container: number, gap: number): number {
  const column = (container - gap * (GRID_COLUMNS - 1)) / GRID_COLUMNS;
  return column * span + gap * (span - 1);
}

/**
 * The width a card is actually drawn at: its chosen width, or the next
 * allowed step up when the chosen one would be narrower than `minPx` in a
 * grid this wide. Full width when nothing fits. Before the grid is measured
 * (`container` 0) the chosen width stands.
 */
export function effectiveSpan(def: Pick<CardDef, 'widths' | 'minPx'>, w: ColumnSpan, container: number, gap: number): ColumnSpan {
  if (!(container > 0)) return w;
  // A half-pixel of slack: grid tracks are fractional and rounding must not
  // bump a card that fits.
  const fits = (span: number) => spanPixels(span, container, gap) + 0.5 >= def.minPx;
  if (fits(w)) return w;
  for (const step of def.widths) if (step > w && fits(step)) return step;
  return 12;
}

/* ---- Edits (the Expand button on a collapsed card in this format) ---- */

/** The same layout with new cards. Any edit is a custom layout again, so a
 *  reset marker does not survive it. */
function withCards<Id extends string>(layout: CardLayout<Id>, cards: CardState<Id>[]): CardLayout<Id> {
  return { v: layout.v, updatedAt: layout.updatedAt, cards };
}

/** Changes one card's fields; anything not allowed for it is put right. */
export function updateCard<Id extends string>(
  layout: CardLayout<Id>,
  registry: readonly CardDef<Id>[],
  id: Id,
  patch: Partial<Omit<CardState<Id>, 'id'>>,
): CardLayout<Id> {
  const def = registry.find((item) => item.id === id);
  if (!def) return layout;
  const cards = layout.cards.map((card) => {
    if (card.id !== id) return card;
    const next: CardState<Id> = { ...card, ...patch, id };
    next.w = nearestWidth(def, next.w);
    if (def.heights) next.h = def.heights.includes(next.h as HeightStep) ? next.h : def.heights[0];
    else delete next.h;
    if (!next.collapsed) delete next.collapsed;
    if (!next.hidden) delete next.hidden;
    return next;
  });
  return withCards(layout, cards);
}

/* ---- Rows (where the grid puts cards in this format) ---- */

export interface PackedRow {
  ids: string[];
  /** Columns taken, of 12. `GRID_COLUMNS - used` is the empty space at its end. */
  used: number;
}

/**
 * How the grid lays the cards out when it keeps their order (a custom
 * layout): left to right, a card that does not fit in what is left of a row
 * starting the next one. This is CSS grid's own auto-placement for cards that
 * each take one row; free placement starts from it the first time a layout
 * in this format is edited (gridModel `placeFlowLayout`).
 */
export function packRows(items: readonly { id: string; span: number }[]): PackedRow[] {
  const rows: PackedRow[] = [];
  let row: PackedRow | null = null;
  for (const item of items) {
    const span = Math.min(GRID_COLUMNS, Math.max(1, item.span));
    if (!row || row.used + span > GRID_COLUMNS) {
      row = { ids: [], used: 0 };
      rows.push(row);
    }
    row.ids.push(item.id);
    row.used += span;
  }
  return rows;
}
