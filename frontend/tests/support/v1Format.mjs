/**
 * The first layout format, as the app before free placement writes it
 * (`layout.home`: order, width step, Tall). The app itself no longer writes
 * it; the tests do, to stand in for a PC still on the old app.
 */

/** What the old app stores: the cards, without anything that equals "unset". */
export function serializeV1(layout) {
  const cards = layout.cards.map((card) => {
    const out = { id: card.id, w: card.w };
    if (card.h) out.h = card.h;
    if (card.collapsed) out.collapsed = true;
    if (card.hidden) out.hidden = true;
    return out;
  });
  return JSON.stringify(layout.reset ? { v: 1, updatedAt: layout.updatedAt, reset: true, cards: [] } : { v: 1, updatedAt: layout.updatedAt, cards });
}

/** True when a first-format layout is the registry default in all but its time. */
export function isDefaultV1(layout, defaults) {
  const base = defaults.cards;
  return (
    layout.cards.length === base.length &&
    layout.cards.every((card, index) => {
      const other = base[index];
      return card.id === other.id && card.w === other.w && (card.h ?? null) === (other.h ?? null) && !card.collapsed && !card.hidden;
    })
  );
}
