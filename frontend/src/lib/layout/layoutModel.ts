/**
 * Card layouts: the pure part.
 *
 * A page that can be rearranged (desktop Home today, Analytics later) has a
 * registry of its cards and, per user, a saved layout: the cards in display
 * order, each with a width in grid columns (of 12) and a few flags. The grid
 * packs them; nothing stores x/y coordinates, so a layout can never overlap,
 * reflows by itself at any width, and moves from the keyboard as simply as
 * from the mouse.
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

/** The registry's own layout: its order, its default sizes, nothing hidden. */
export function defaultLayout<Id extends string>(registry: readonly CardDef<Id>[], updatedAt = 0): CardLayout<Id> {
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

  /* Cards the saved layout never heard of, at their default spot. */
  registry.forEach((def, index) => {
    if (seen.has(def.id)) return;
    seen.add(def.id);
    const fresh: CardState<Id> = def.heights ? { id: def.id, w: def.defaultW, h: def.heights[0] } : { id: def.id, w: def.defaultW };
    let at = 0;
    for (let back = index - 1; back >= 0; back -= 1) {
      const position = cards.findIndex((card) => card.id === registry[back].id);
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

/** True when the layout is the registry default in every respect but its time. */
export function isDefaultLayout<Id extends string>(layout: CardLayout<Id>, registry: readonly CardDef<Id>[]): boolean {
  const base = defaultLayout(registry).cards;
  return (
    layout.cards.length === base.length &&
    layout.cards.every((card, index) => {
      const other = base[index];
      return (
        card.id === other.id &&
        card.w === other.w &&
        (card.h ?? null) === (other.h ?? null) &&
        !card.collapsed &&
        !card.hidden
      );
    })
  );
}

/** What gets stored: the cards, without anything that equals "unset". */
export function serializeLayout<Id extends string>(layout: CardLayout<Id>): string {
  const cards = layout.cards.map((card) => {
    const out: Record<string, unknown> = { id: card.id, w: card.w };
    if (card.h) out.h = card.h;
    if (card.collapsed) out.collapsed = true;
    if (card.hidden) out.hidden = true;
    return out;
  });
  return JSON.stringify(layout.reset ? { v: 1, updatedAt: layout.updatedAt, reset: true, cards: [] } : { v: 1, updatedAt: layout.updatedAt, cards });
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

/* ---- Edits (used by edit mode) ---- */

/** The same layout with new cards. Any edit is a custom layout again, so a
 *  reset marker does not survive it. */
function withCards<Id extends string>(layout: CardLayout<Id>, cards: CardState<Id>[]): CardLayout<Id> {
  return { v: layout.v, updatedAt: layout.updatedAt, cards };
}

/** Moves the card at `from` to index `to` (in the full list, hidden cards included). */
export function moveCard<Id extends string>(layout: CardLayout<Id>, from: number, to: number): CardLayout<Id> {
  if (from === to || from < 0 || from >= layout.cards.length) return layout;
  const cards = layout.cards.slice();
  const [card] = cards.splice(from, 1);
  cards.splice(Math.max(0, Math.min(cards.length, to)), 0, card);
  return withCards(layout, cards);
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

/**
 * Moves card `id` to just before (or after) card `targetId`. Positions are in
 * the full list, so hidden cards keep their place relative to their
 * neighbours and come back where they were.
 */
export function moveCardTo<Id extends string>(layout: CardLayout<Id>, id: Id, targetId: Id, after: boolean): CardLayout<Id> {
  if (id === targetId) return layout;
  const from = layout.cards.findIndex((card) => card.id === id);
  if (from === -1 || !layout.cards.some((card) => card.id === targetId)) return layout;
  const cards = layout.cards.slice();
  const [card] = cards.splice(from, 1);
  const at = cards.findIndex((item) => item.id === targetId) + (after ? 1 : 0);
  cards.splice(at, 0, card);
  if (cards.every((item, index) => item === layout.cards[index])) return layout;
  return withCards(layout, cards);
}

/** One step earlier (-1) or later (+1) among the visible cards: the keyboard move. */
export function moveCardBy<Id extends string>(layout: CardLayout<Id>, id: Id, delta: -1 | 1): CardLayout<Id> {
  const visible = layout.cards.filter((card) => !card.hidden);
  const index = visible.findIndex((card) => card.id === id);
  const target = visible[index + delta];
  if (index === -1 || !target) return layout;
  return moveCardTo(layout, id, target.id, delta > 0);
}

/* ---- Rows and gaps (what edit mode shows) ---- */

export interface PackedRow {
  ids: string[];
  /** Columns taken, of 12. `GRID_COLUMNS - used` is the empty space at its end. */
  used: number;
}

/**
 * How the grid lays the cards out when it keeps their order (a custom
 * layout): left to right, a card that does not fit in what is left of a row
 * starting the next one. This is CSS grid's own auto-placement for cards that
 * each take one row, so edit mode can show the empty space a row ends with.
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

/**
 * A size that would close a row's empty space: one card in the row widened
 * by exactly the gap to a width it allows. The row's last card is tried
 * first — it borders the gap — then the others from right to left. Null when
 * no single card can; only ever a suggestion, never applied by itself.
 */
export function gapSuggestion<Id extends string>(
  row: PackedRow,
  registry: readonly CardDef<Id>[],
  spans: Readonly<Record<string, ColumnSpan>>,
): { id: Id; w: ColumnSpan } | null {
  const gap = GRID_COLUMNS - row.used;
  if (gap <= 0) return null;
  for (let index = row.ids.length - 1; index >= 0; index -= 1) {
    const def = registry.find((item) => item.id === row.ids[index]);
    const current = spans[row.ids[index]];
    if (!def || !current) continue;
    const wanted = current + gap;
    const step = def.widths.find((width) => width === wanted);
    if (step) return { id: def.id, w: step };
  }
  return null;
}

/* ---- Sync between devices ---- */

/**
 * What to do with this device's layout and the copy stored on the server
 * (null when there is none). Last write wins on `updatedAt`:
 *  - `adopt`: the server's is newer — take it (a reset marker included);
 *  - `upload`: this device's is newer — an edit made offline, or before the
 *    server could store layouts — send it;
 *  - `none`: the same, or neither has ever been customised.
 */
export function reconcileLayouts(local: Pick<CardLayout, 'updatedAt'>, remote: Pick<CardLayout, 'updatedAt'> | null): 'adopt' | 'upload' | 'none' {
  const remoteAt = remote?.updatedAt ?? 0;
  if (remote && remoteAt > local.updatedAt) return 'adopt';
  if (local.updatedAt > remoteAt) return 'upload';
  return 'none';
}
