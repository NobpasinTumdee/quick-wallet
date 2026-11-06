/**
 * Card layouts on a grid of cells: the pure part.
 *
 * The grid is 12 columns wide and made of rows `ROW_PX` tall (with the page's
 * usual gap between them). A layout comes in one of two forms:
 *
 *  - **Flow** — cards in order, each with a width and nothing else, packed by
 *    CSS grid exactly as the first version of this feature did, heights
 *    following the content. The default layout, and every layout saved by
 *    that first version, is a flow layout. That is what makes the update
 *    invisible: a flow layout is drawn by the same code as before.
 *  - **Placed** — every card with x, y, w and h in cells, as edit mode leaves
 *    it. Cards never overlap and always rest as high as they can (vertical
 *    compaction, always on), so gaps close by themselves.
 *
 * A layout is placed when its cards carry `h`, flow when none does.
 *
 * Stored as `{ v: 1, format: 2, updatedAt, cards }` under its own key
 * (`layout.home-grid`). `v` stays 1 because the server accepts nothing else;
 * the new key is what keeps the first version's saved value (`layout.home`)
 * untouched, so a PC still running it keeps working on its own copy.
 *
 * Everything here is pure and node-tested (tests/gridModel.test.mjs).
 */

import type { CardDef, CardLayout, CardState, HeightStep } from './layoutModel';
import { GRID_COLUMNS, defaultLayout, nearestWidth, packRows, sanitizeLayout, spanPixels } from './layoutModel';

export const GRID_FORMAT = 2;
/** One grid row, in pixels. A card h rows tall is h·ROW_PX + (h−1)·gap. */
export const ROW_PX = 40;
/** No card is placed lower than this; anything below is clamped (bad data only). */
const MAX_Y = 2000;

export interface GridCardDef<Id extends string = string> extends CardDef<Id> {
  /** Narrowest, in columns. The pixel minimum (`minPx`) still applies on top. */
  minW: number;
  /** Shortest and tallest, in rows. */
  minH: number;
  maxH: number;
  /** Size when added from the widget panel or placed fresh. */
  defaultH: number;
}

export interface GridCard<Id extends string = string> {
  id: Id;
  w: number;
  /** Placed layouts only. */
  x?: number;
  y?: number;
  h?: number;
  /** Flow layouts only: the first version's "Tall" height step. */
  tall?: true;
  collapsed?: true;
  hidden?: true;
}

export interface GridLayout<Id extends string = string> {
  v: 1;
  format: 2;
  updatedAt: number;
  cards: GridCard<Id>[];
  reset?: true;
}

/** A placed card's resolved geometry. */
export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeParse(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function int(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.round(value) : fallback;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function isPlaced(layout: Pick<GridLayout, 'cards'>): boolean {
  return layout.cards.some((card) => typeof card.h === 'number');
}

/* ---- The first version's layouts ---- */

/**
 * A first-version layout (order, width, height step) as a flow layout: the
 * same cards in the same order at the same widths, so it draws identically.
 * Its time and a reset marker are kept, so sync still compares it fairly.
 */
export function migrateV1<Id extends string>(old: CardLayout<Id>): GridLayout<Id> {
  const cards = old.cards.map((card) => {
    const out: GridCard<Id> = { id: card.id, w: card.w };
    if (card.h === 'tall') out.tall = true;
    if (card.collapsed) out.collapsed = true;
    if (card.hidden) out.hidden = true;
    return out;
  });
  const layout: GridLayout<Id> = { v: 1, format: 2, updatedAt: old.updatedAt, cards };
  if (old.reset) {
    layout.reset = true;
  }
  return layout;
}

/**
 * The layout in the first version's terms — what the flow renderer and the
 * order-and-width editor work with. A placed layout comes out in reading
 * order (top to bottom, left to right) at the nearest width step.
 */
export function toCardLayout<Id extends string>(layout: GridLayout<Id>, registry: readonly CardDef<Id>[]): CardLayout<Id> {
  const ordered = isPlaced(layout)
    ? layout.cards
        .map((card, index) => ({ card, index }))
        .sort((a, b) => (a.card.y ?? 0) - (b.card.y ?? 0) || (a.card.x ?? 0) - (b.card.x ?? 0) || a.index - b.index)
        .map((item) => item.card)
    : layout.cards;
  const cards: CardState<Id>[] = [];
  for (const card of ordered) {
    const def = registry.find((item) => item.id === card.id);
    if (!def) continue;
    const out: CardState<Id> = { id: card.id, w: nearestWidth(def, card.w) };
    if (def.heights) out.h = card.tall && def.heights.includes('tall') ? 'tall' : (def.heights[0] as HeightStep);
    if (card.collapsed) out.collapsed = true;
    if (card.hidden) out.hidden = true;
    cards.push(out);
  }
  const result: CardLayout<Id> = { v: 1, updatedAt: layout.updatedAt, cards };
  if (layout.reset) result.reset = true;
  return result;
}

/** The registry default: a flow layout, drawn exactly like Home always was. */
export function defaultGridLayout<Id extends string>(registry: readonly CardDef<Id>[], updatedAt = 0): GridLayout<Id> {
  return migrateV1(defaultLayout(registry, updatedAt));
}

/* ---- Cleaning up anything that comes in ---- */

/**
 * Anything → a complete, valid layout for `registry`.
 *
 * - Not this format, or a reset marker: the default (keeping a valid time,
 *   so a reset still wins a sync).
 * - Unknown ids and repeats are dropped.
 * - Flow: the first version's rules (nearest width step, missing cards at
 *   their default position).
 * - Placed: sizes clamped to each card's min/max, x kept inside the grid,
 *   missing cards added at the first free spot at their default size, then
 *   overlaps pushed down and everything floated up.
 */
export function sanitizeGridLayout<Id extends string>(raw: unknown, registry: readonly GridCardDef<Id>[]): GridLayout<Id> {
  const input = typeof raw === 'string' ? safeParse(raw) : raw;
  if (!isObject(input)) return defaultGridLayout(registry);

  const updatedAt =
    typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt) && input.updatedAt > 0 ? Math.floor(input.updatedAt) : 0;
  if (input.v !== 1 || input.format !== GRID_FORMAT || !Array.isArray(input.cards) || input.reset === true) {
    const fallback = defaultGridLayout(registry, updatedAt);
    return input.reset === true ? { ...fallback, reset: true } : fallback;
  }

  const byId = new Map(registry.map((def) => [def.id as string, def]));
  const seen = new Set<string>();
  const entries: { def: GridCardDef<Id>; raw: Record<string, unknown> }[] = [];
  for (const entry of input.cards) {
    if (!isObject(entry) || typeof entry.id !== 'string') continue;
    const def = byId.get(entry.id);
    if (!def || seen.has(entry.id)) continue;
    seen.add(entry.id);
    entries.push({ def, raw: entry });
  }

  const placed = entries.some((entry) => typeof entry.raw.h === 'number' && Number.isFinite(entry.raw.h));

  if (!placed) {
    /* The first version's rules, through its own sanitiser. */
    const asV1 = {
      v: 1,
      updatedAt,
      cards: entries.map(({ raw: entry }) => ({
        id: entry.id,
        w: entry.w,
        h: entry.tall === true ? 'tall' : undefined,
        collapsed: entry.collapsed,
        hidden: entry.hidden,
      })),
    };
    return migrateV1(sanitizeLayout(asV1, registry));
  }

  const cards: GridCard<Id>[] = entries.map(({ def, raw: entry }) => {
    const w = clamp(int(entry.w, def.defaultW), Math.min(def.minW, GRID_COLUMNS), GRID_COLUMNS);
    const card: GridCard<Id> = {
      id: def.id,
      x: clamp(int(entry.x, 0), 0, GRID_COLUMNS - w),
      y: clamp(int(entry.y, 0), 0, MAX_Y),
      w,
      h: clamp(int(entry.h, def.defaultH), def.minH, def.maxH),
    };
    if (entry.collapsed === true) card.collapsed = true;
    if (entry.hidden === true) card.hidden = true;
    return card;
  });

  let next = settle(cards);
  for (const def of registry) {
    if (seen.has(def.id)) continue;
    const w = Math.min(def.defaultW, GRID_COLUMNS);
    const spot = firstFreeSpot(next, w, def.defaultH);
    next = settle([...next, { id: def.id, x: spot.x, y: spot.y, w, h: def.defaultH }]);
  }
  return { v: 1, format: 2, updatedAt, cards: next };
}

/** True when the layout is the registry default in every respect but its time. */
export function isDefaultGridLayout<Id extends string>(layout: GridLayout<Id>, registry: readonly GridCardDef<Id>[]): boolean {
  if (isPlaced(layout)) return false;
  const base = defaultGridLayout(registry).cards;
  return (
    layout.cards.length === base.length &&
    layout.cards.every(
      (card, index) => card.id === base[index].id && card.w === base[index].w && !card.tall && !card.collapsed && !card.hidden,
    )
  );
}

/** What gets stored: only what is set. */
export function serializeGridLayout<Id extends string>(layout: GridLayout<Id>): string {
  if (layout.reset) return JSON.stringify({ v: 1, format: GRID_FORMAT, updatedAt: layout.updatedAt, reset: true, cards: [] });
  const placed = isPlaced(layout);
  const cards = layout.cards.map((card) => {
    const out: Record<string, unknown> = { id: card.id };
    if (placed) {
      out.x = card.x ?? 0;
      out.y = card.y ?? 0;
      out.w = card.w;
      out.h = card.h;
    } else {
      out.w = card.w;
      if (card.tall) out.tall = true;
    }
    if (card.collapsed) out.collapsed = true;
    if (card.hidden) out.hidden = true;
    return out;
  });
  return JSON.stringify({ v: 1, format: GRID_FORMAT, updatedAt: layout.updatedAt, cards });
}

/* ---- Geometry of placed cards ---- */

/** Rows a card takes: one while collapsed, its height otherwise. */
export function rowsOf(card: Pick<GridCard, 'h' | 'collapsed'>): number {
  return card.collapsed ? 1 : Math.max(1, card.h ?? 1);
}

function boxOf(card: GridCard): Box {
  return { x: card.x ?? 0, y: card.y ?? 0, w: card.w, h: rowsOf(card) };
}

export function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/**
 * How the card being moved or resized ranks against the others.
 *  - `before`: on a tie (same top row) it goes first — moving up, dropping in.
 *  - `after`: on a tie it goes after — moving down, so it swaps with a card
 *    once its top reaches that card's top.
 *  - `push`: it goes first, and every card it now overlaps goes after it —
 *    resizing or expanding, so the card keeps its place and pushes the
 *    others down instead of jumping below them.
 */
export type SettleRank = 'before' | 'after' | 'push';

/**
 * Overlaps resolved and gaps closed, in one pass.
 *
 * Visible cards are taken in reading order (by top row, then column). Each
 * is dropped into its own columns and comes to rest just below the cards
 * already placed there — as high as it can go without passing through one.
 * So nothing ever overlaps, nothing floats with space above it, and what is
 * above what follows the order of the cards' tops. A card dropped on another
 * pushes it down; a card dragged below another's top swaps with it.
 *
 * Hidden cards keep their last position and take no space.
 */
export function settle<Id extends string>(
  cards: readonly GridCard<Id>[],
  priority?: { id: Id; rank: SettleRank },
): GridCard<Id>[] {
  const visible = cards
    .map((card, index) => ({ card, index, key: card.y ?? 0, tie: 0 }))
    .filter((item) => !item.card.hidden && typeof item.card.h === 'number');

  const lead = priority ? visible.find((item) => item.card.id === priority.id) : undefined;
  if (lead && priority) {
    lead.tie = priority.rank === 'after' ? 1 : -1;
    if (priority.rank === 'push') {
      const leadBox = boxOf(lead.card);
      for (const item of visible) {
        if (item !== lead && overlaps(boxOf(item.card), leadBox)) {
          item.key = Math.max(item.key, lead.key);
          item.tie = 1;
        }
      }
    }
  }

  visible.sort((a, b) => a.key - b.key || a.tie - b.tie || (a.card.x ?? 0) - (b.card.x ?? 0) || a.index - b.index);

  const placedBoxes: Box[] = [];
  const result = new Map<number, GridCard<Id>>();
  for (const item of visible) {
    const box = boxOf(item.card);
    box.x = clamp(box.x, 0, GRID_COLUMNS - Math.min(box.w, GRID_COLUMNS));
    let y = 0;
    for (const other of placedBoxes) {
      if (box.x < other.x + other.w && other.x < box.x + box.w) y = Math.max(y, other.y + other.h);
    }
    placedBoxes.push({ ...box, y });
    result.set(item.index, { ...item.card, x: box.x, y });
  }
  return cards.map((card, index) => result.get(index) ?? card);
}

/** The top-most, then left-most, spot where a w × h card fits among the visible cards. */
export function firstFreeSpot(cards: readonly GridCard[], w: number, h: number): { x: number; y: number } {
  const width = clamp(w, 1, GRID_COLUMNS);
  const boxes = cards.filter((card) => !card.hidden && typeof card.h === 'number').map(boxOf);
  const bottom = boxes.reduce((max, box) => Math.max(max, box.y + box.h), 0);
  for (let y = 0; y <= bottom; y += 1) {
    for (let x = 0; x + width <= GRID_COLUMNS; x += 1) {
      const box = { x, y, w: width, h };
      if (!boxes.some((other) => overlaps(box, other))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

/* ---- Edits on placed layouts ---- */

function withCards<Id extends string>(layout: GridLayout<Id>, cards: GridCard<Id>[]): GridLayout<Id> {
  return { v: 1, format: 2, updatedAt: layout.updatedAt, cards };
}

function defOf<Id extends string>(registry: readonly GridCardDef<Id>[], id: Id): GridCardDef<Id> | undefined {
  return registry.find((item) => item.id === id);
}

/** Puts card `id` with its top-left at (x, y); the others make room and everything settles. */
export function moveGridCard<Id extends string>(layout: GridLayout<Id>, id: Id, x: number, y: number): GridLayout<Id> {
  const card = layout.cards.find((item) => item.id === id);
  if (!card || card.hidden) return layout;
  const nx = clamp(Math.round(x), 0, GRID_COLUMNS - card.w);
  const ny = clamp(Math.round(y), 0, MAX_Y);
  const rank: SettleRank = ny > (card.y ?? 0) ? 'after' : 'before';
  const cards = layout.cards.map((item) => (item.id === id ? { ...item, x: nx, y: ny } : item));
  return withCards(layout, settle(cards, { id, rank }));
}

/** Changes card `id`'s size, within its limits; the others make room. */
export function resizeGridCard<Id extends string>(
  layout: GridLayout<Id>,
  registry: readonly GridCardDef<Id>[],
  id: Id,
  w: number,
  h: number,
): GridLayout<Id> {
  const def = defOf(registry, id);
  const card = layout.cards.find((item) => item.id === id);
  if (!def || !card || card.hidden) return layout;
  const nw = clamp(Math.round(w), Math.min(def.minW, GRID_COLUMNS), GRID_COLUMNS);
  const nh = clamp(Math.round(h), def.minH, def.maxH);
  const nx = clamp(card.x ?? 0, 0, GRID_COLUMNS - nw);
  const cards = layout.cards.map((item) => (item.id === id ? { ...item, x: nx, w: nw, h: nh } : item));
  return withCards(layout, settle(cards, { id, rank: 'push' }));
}

/** Collapse, expand or hide a placed card; the rest settles. */
export function setGridCardFlags<Id extends string>(
  layout: GridLayout<Id>,
  id: Id,
  flags: { collapsed?: boolean; hidden?: boolean },
): GridLayout<Id> {
  const cards = layout.cards.map((item) => {
    if (item.id !== id) return item;
    const next: GridCard<Id> = { ...item };
    if (flags.collapsed !== undefined) {
      if (flags.collapsed) next.collapsed = true;
      else delete next.collapsed;
    }
    if (flags.hidden !== undefined) {
      if (flags.hidden) next.hidden = true;
      else delete next.hidden;
    }
    return next;
  });
  const growing = flags.collapsed === false || flags.hidden === false;
  return withCards(layout, settle(cards, growing ? { id, rank: 'push' } : undefined));
}

/**
 * The size a hidden card comes back at: the size it had when it was hidden,
 * or its default if it never had one (hidden before it was ever placed).
 */
export function showSize(card: GridCard, def: GridCardDef): { w: number; h: number } {
  const placed = typeof card.h === 'number';
  return {
    w: clamp(placed ? card.w : def.defaultW, Math.min(def.minW, GRID_COLUMNS), GRID_COLUMNS),
    h: clamp(placed ? (card.h as number) : def.defaultH, def.minH, def.maxH),
  };
}

/**
 * Shows a hidden card at its `showSize` (or `size`, when the screen needs it
 * wider): at (x, y) when given — a drop from the widget panel — otherwise at
 * the first spot where it fits.
 */
export function showGridCard<Id extends string>(
  layout: GridLayout<Id>,
  registry: readonly GridCardDef<Id>[],
  id: Id,
  at?: { x: number; y: number },
  size?: { w: number; h: number },
): GridLayout<Id> {
  const def = defOf(registry, id);
  const card = layout.cards.find((item) => item.id === id);
  if (!def || !card) return layout;
  const base = size ?? showSize(card, def);
  const w = clamp(Math.round(base.w), Math.min(def.minW, GRID_COLUMNS), GRID_COLUMNS);
  const h = clamp(Math.round(base.h), def.minH, def.maxH);
  const others = layout.cards.filter((item) => item.id !== id);
  const spot = at ? { x: clamp(Math.round(at.x), 0, GRID_COLUMNS - w), y: Math.max(0, Math.round(at.y)) } : firstFreeSpot(others, w, h);
  const shown: GridCard<Id> = { id, x: spot.x, y: spot.y, w, h };
  const cards = layout.cards.map((item) => (item.id === id ? shown : item));
  return withCards(layout, settle(cards, { id, rank: 'before' }));
}

/* ---- Narrow desktop screens ---- */

/** Fewest columns that are at least `minPx` wide in this grid. */
export function minColumnsFor(minPx: number, container: number, gap: number): number {
  if (!(container > 0)) return 1;
  for (let span = 1; span <= GRID_COLUMNS; span += 1) {
    if (spanPixels(span, container, gap) + 0.5 >= minPx) return span;
  }
  return GRID_COLUMNS;
}

/**
 * The layout as drawn in a grid this wide: a card narrower than its pixel
 * minimum is widened (moved left if it would run off the edge), and the rest
 * reflows. Drawing only — never saved — so a layout made at 1920px is
 * untouched there. Flow layouts and an unmeasured grid come back as they are.
 */
export function fitGridToWidth<Id extends string>(
  layout: GridLayout<Id>,
  registry: readonly GridCardDef<Id>[],
  container: number,
  gap: number,
): GridLayout<Id> {
  if (!isPlaced(layout) || !(container > 0)) return layout;
  let changed = false;
  const cards = layout.cards.map((card) => {
    const def = defOf(registry, card.id);
    if (!def || card.hidden) return card;
    const w = Math.max(card.w, minColumnsFor(def.minPx, container, gap));
    if (w === card.w) return card;
    changed = true;
    return { ...card, w, x: Math.min(card.x ?? 0, GRID_COLUMNS - w) };
  });
  return changed ? withCards(layout, settle(cards)) : layout;
}

/* ---- From flow to placed (opening edit mode) ---- */

/** Rows for a height in pixels, rounded to the nearest whole row. */
export function rowsForPixels(px: number, gap: number): number {
  return Math.max(1, Math.round((px + gap) / (ROW_PX + gap)));
}

/** Pixel height of h rows. */
export function rowsPixels(h: number, gap: number): number {
  return h * ROW_PX + Math.max(0, h - 1) * gap;
}

/**
 * A flow layout as a placed one, from what is on screen: each card where the
 * flow put it (`spans`, the widths as drawn) and as tall as it measures,
 * rounded to whole rows and kept within its limits. A collapsed card keeps
 * its default height for when it is expanded. Placed layouts pass through.
 */
export function placeFlowLayout<Id extends string>(
  layout: GridLayout<Id>,
  registry: readonly GridCardDef<Id>[],
  spans: Readonly<Record<string, number>>,
  heights: Readonly<Record<string, number>>,
  gap: number,
): GridLayout<Id> {
  if (isPlaced(layout)) return layout;
  const visible = layout.cards.filter((card) => !card.hidden);
  const rows = packRows(visible.map((card) => ({ id: card.id, span: spans[card.id] ?? card.w })));
  const position = new Map<string, { x: number; y: number }>();
  let top = 0;
  const sizes = new Map<string, number>();
  for (const card of layout.cards) {
    const def = defOf(registry, card.id);
    if (!def) continue;
    const measured = heights[card.id];
    const h = card.collapsed || card.hidden || !(measured > 0) ? def.defaultH : rowsForPixels(measured, gap);
    sizes.set(card.id, clamp(h, def.minH, def.maxH));
  }
  for (const row of rows) {
    let x = 0;
    let tallest = 1;
    for (const id of row.ids) {
      const card = visible.find((item) => item.id === id)!;
      position.set(id, { x, y: top });
      x += spans[id] ?? card.w;
      tallest = Math.max(tallest, rowsOf({ h: sizes.get(id), collapsed: card.collapsed }));
    }
    top += tallest;
  }
  const cards = layout.cards.map((card) => {
    const def = defOf(registry, card.id)!;
    const at = position.get(card.id) ?? firstFreeSpot([], card.w, 1);
    const w = clamp(spans[card.id] ?? card.w, Math.min(def.minW, GRID_COLUMNS), GRID_COLUMNS);
    const out: GridCard<Id> = { id: card.id, x: Math.min(at.x, GRID_COLUMNS - w), y: at.y, w, h: sizes.get(card.id) ?? def.defaultH };
    if (card.collapsed) out.collapsed = true;
    if (card.hidden) out.hidden = true;
    return out;
  });
  return withCards(layout, settle(cards));
}

/* ---- Drawing ---- */

/** CSS grid placement for a placed card (1-based lines). */
export function gridArea(card: GridCard): { gridColumn: string; gridRow: string } {
  return {
    gridColumn: `${(card.x ?? 0) + 1} / span ${card.w}`,
    gridRow: `${(card.y ?? 0) + 1} / span ${rowsOf(card)}`,
  };
}

/** Visible placed cards top to bottom, left to right — the order a screen reader and Tab should follow. */
export function readingOrder<Id extends string>(cards: readonly GridCard<Id>[]): GridCard<Id>[] {
  return cards
    .filter((card) => !card.hidden)
    .map((card, index) => ({ card, index }))
    .sort((a, b) => (a.card.y ?? 0) - (b.card.y ?? 0) || (a.card.x ?? 0) - (b.card.x ?? 0) || a.index - b.index)
    .map((item) => item.card);
}

/** Same positions and sizes for every card (what a drag compares, cheaply). */
export function samePlacement(a: GridLayout, b: GridLayout): boolean {
  if (a.cards.length !== b.cards.length) return false;
  return a.cards.every((card, index) => {
    const other = b.cards[index];
    return (
      card.id === other.id &&
      card.x === other.x &&
      card.y === other.y &&
      card.w === other.w &&
      card.h === other.h &&
      !card.collapsed === !other.collapsed &&
      !card.hidden === !other.hidden
    );
  });
}
