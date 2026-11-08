/**
 * The phone's Home: which cards show, in what order. No sizes, no places —
 * a phone and a tablet draw the cards in one column (two halves side by side
 * on a tablet), so order and visibility are all there is to choose.
 *
 * Stored as `{ v: 1, format: "order", updatedAt, cards: [{ id, hidden? }] }`
 * (`layout.home-mobile`). `v: 1` and a `cards` array are what Code.gs
 * accepts; `format` keeps it from ever being read as a desktop layout and
 * the other way round. A reset is a marker, `{ …, reset: true, cards: [] }`,
 * so it wins over an older custom copy on another phone.
 */

export interface OrderCard<Id extends string = string> {
  id: Id;
  hidden?: boolean;
}

export interface CardOrder<Id extends string = string> {
  v: 1;
  format: 'order';
  updatedAt: number;
  /** Saved by Reset: the default, stamped, so other devices let go too. */
  reset?: true;
  cards: OrderCard<Id>[];
}

/** Only the id matters here: the order is the registry's own. */
export interface OrderCardDef<Id extends string = string> {
  id: Id;
  /** Another page's card, there only once added (see the addable flag in layoutModel.ts). */
  addable?: true;
  /** One of the page's own optional cards (see `extra` in layoutModel.ts). */
  extra?: true;
}

/** The page's own cards, in order: the registry without the addable ones. */
function own<D extends OrderCardDef>(registry: readonly D[]): readonly D[] {
  return registry.some((def) => def.addable) ? registry.filter((def) => !def.addable) : registry;
}

export function defaultOrder<Id extends string>(registry: readonly OrderCardDef<Id>[], updatedAt = 0): CardOrder<Id> {
  return { v: 1, format: 'order', updatedAt, cards: own(registry).map((def) => ({ id: def.id })) };
}

function stampOf(value: unknown): number {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * Anything (a stored string, a parsed object) as a valid order for this
 * registry. Never throws. Unknown ids and repeats are dropped. A card the
 * stored order does not know yet — one added in a later version — goes in
 * right after the card that comes before it in the default order (or first),
 * so it appears where it would by default, not at the end.
 */
export function sanitizeOrder<Id extends string>(raw: unknown, registry: readonly OrderCardDef<Id>[]): CardOrder<Id> {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return defaultOrder(registry);
    }
  }
  if (!value || typeof value !== 'object') return defaultOrder(registry);
  const obj = value as { v?: unknown; format?: unknown; updatedAt?: unknown; reset?: unknown; cards?: unknown };
  if (obj.v !== 1 || obj.format !== 'order') return defaultOrder(registry);
  const updatedAt = stampOf(obj.updatedAt);
  if (obj.reset === true) return { ...defaultOrder(registry, updatedAt), reset: true };
  if (!Array.isArray(obj.cards)) return defaultOrder(registry, updatedAt);

  const known = new Set<string>(registry.map((def) => def.id));
  const seen = new Set<string>();
  const cards: OrderCard<Id>[] = [];
  for (const item of obj.cards) {
    const id = item && typeof item === 'object' ? (item as { id?: unknown }).id : undefined;
    if (typeof id !== 'string' || !known.has(id) || seen.has(id)) continue;
    seen.add(id);
    const card: OrderCard<Id> = { id: id as Id };
    if ((item as { hidden?: unknown }).hidden === true) card.hidden = true;
    cards.push(card);
  }

  const base = own(registry);
  base.forEach((def, index) => {
    if (seen.has(def.id)) return;
    let at = 0;
    for (let before = index - 1; before >= 0; before--) {
      const found = cards.findIndex((card) => card.id === base[before].id);
      if (found >= 0) {
        at = found + 1;
        break;
      }
    }
    cards.splice(at, 0, { id: def.id });
    seen.add(def.id);
  });

  return { v: 1, format: 'order', updatedAt, cards };
}

/** What is stored: hidden only where it is set, nothing at all after a reset. */
export function serializeOrder(order: CardOrder): string {
  if (order.reset) return JSON.stringify({ v: 1, format: 'order', updatedAt: order.updatedAt, reset: true, cards: [] });
  return JSON.stringify({
    v: 1,
    format: 'order',
    updatedAt: order.updatedAt,
    cards: order.cards.map((card) => (card.hidden ? { id: card.id, hidden: true } : { id: card.id })),
  });
}

/** True when the order is the registry's, nothing hidden — whatever its time or reset flag. */
export function isDefaultOrder<Id extends string>(order: CardOrder<Id>, registry: readonly OrderCardDef<Id>[]): boolean {
  const base = own(registry);
  return (
    order.cards.length === base.length &&
    order.cards.every((card, index) => card.id === base[index].id && !card.hidden)
  );
}

/** Adds an addable card at the end (shown); nothing if it is already there. */
export function addToOrder<Id extends string>(order: CardOrder<Id>, id: Id): CardOrder<Id> {
  if (order.cards.some((card) => card.id === id)) return order;
  const { reset: _reset, ...rest } = order;
  return { ...rest, cards: [...order.cards, { id }] };
}

/** Takes a card out of the order altogether (an added card being removed). */
export function removeFromOrder<Id extends string>(order: CardOrder<Id>, id: Id): CardOrder<Id> {
  if (!order.cards.some((card) => card.id === id)) return order;
  const { reset: _reset, ...rest } = order;
  return { ...rest, cards: order.cards.filter((card) => card.id !== id) };
}

/** The same order (ids and hidden flags), ignoring time and reset. */
export function sameOrder(a: CardOrder, b: CardOrder): boolean {
  return (
    a.cards.length === b.cards.length &&
    a.cards.every((card, index) => card.id === b.cards[index].id && !!card.hidden === !!b.cards[index].hidden)
  );
}

/** Moves a card `delta` places (−1 up, +1 down), stopping at either end. */
export function moveInOrder<Id extends string>(order: CardOrder<Id>, id: Id, delta: number): CardOrder<Id> {
  const from = order.cards.findIndex((card) => card.id === id);
  if (from < 0) return order;
  const to = Math.max(0, Math.min(order.cards.length - 1, from + Math.trunc(delta)));
  if (to === from) return order;
  const cards = [...order.cards];
  const [card] = cards.splice(from, 1);
  cards.splice(to, 0, card);
  const { reset: _reset, ...rest } = order;
  return { ...rest, cards };
}

export function setOrderHidden<Id extends string>(order: CardOrder<Id>, id: Id, hidden: boolean): CardOrder<Id> {
  if (!order.cards.some((card) => card.id === id)) return order;
  const { reset: _reset, ...rest } = order;
  return {
    ...rest,
    cards: order.cards.map((card) => (card.id !== id ? card : hidden ? { id: card.id, hidden: true } : { id: card.id })),
  };
}

/** The cards to draw, in order. */
export function visibleIds<Id extends string>(order: CardOrder<Id>): Id[] {
  return order.cards.filter((card) => !card.hidden).map((card) => card.id);
}

/**
 * Cards that sit side by side on a tablet (a half each) do so only in pairs:
 * a half card drawn next to another half card keeps its half; one on its
 * own is drawn full width, so nothing is left with a hole beside it and the
 * grid's back-filling never moves a card away from the place chosen for it.
 * Answers the ids to draw full width.
 */
export function unpairedHalves<Id extends string>(visible: readonly Id[], halves: ReadonlySet<Id>): Set<Id> {
  const full = new Set<Id>();
  for (let index = 0; index < visible.length; index++) {
    const id = visible[index];
    if (!halves.has(id)) continue;
    const next = visible[index + 1];
    if (next !== undefined && halves.has(next)) {
      index++;
      continue;
    }
    full.add(id);
  }
  return full;
}
