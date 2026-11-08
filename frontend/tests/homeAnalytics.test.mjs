import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

/* Analytics cards on Home: copies, there only once added. Every Home layout
   saved before reads and writes exactly as it did with Home's own registry,
   and no Analytics card ever appears on Home by itself. */
const { HOME_CARDS, HOME_BOARD_CARDS, HOME_BOARD_HALVES, HOME_LAYOUT_PAGE, HOME_LEGACY_LAYOUT_PAGE } = await import('../src/lib/layout/homeCards.ts');
const { ANALYTICS_CARDS } = await import('../src/lib/layout/analyticsCards.ts');
const { isAnalyticsCardId } = await import('../src/lib/layout/cardCatalog.ts');
const { HOME_ORDER_FORMAT, gridLayoutFormat, orderFormat } = await import('../src/lib/layout/layoutFormats.ts');
const { addGridCard, defaultGridLayout, isDefaultGridLayout, removeGridCard, sanitizeGridLayout, serializeGridLayout, setGridCardFlags } = await import('../src/lib/layout/gridModel.ts');
const { addToOrder, defaultOrder, isDefaultOrder, removeFromOrder, sanitizeOrder, serializeOrder, visibleIds } = await import('../src/lib/layout/orderModel.ts');
const { defaultLayout, ownCards, sanitizeLayout } = await import('../src/lib/layout/layoutModel.ts');
const { serializeV1 } = await import('./support/v1Format.mjs');

const ANALYTICS_IDS = ANALYTICS_CARDS.map((def) => def.id);
const hasAnalytics = (cards) => cards.some((card) => ANALYTICS_IDS.includes(card.id));

const GRID_CORPUS = [
  null, '', 'garbage', '{}',
  JSON.stringify({ v: 1, format: 2, updatedAt: 17, cards: [{ id: 'recent', x: 0, y: 0, w: 6, h: 10 }, { id: 'budgets', x: 6, y: 0, w: 6, h: 9, collapsed: true }, { id: 'inbox', x: 0, y: 30, w: 12, h: 3, hidden: true }] }),
  JSON.stringify({ v: 1, format: 2, updatedAt: 42, cards: [{ id: 'cashflow', w: 12, tall: true }, { id: 'budgets', w: 6 }, { id: 'wallets', w: 6, hidden: true }] }),
  JSON.stringify({ v: 1, format: 2, updatedAt: 99, reset: true, cards: [] }),
];
const V1_CORPUS = [
  null,
  serializeV1({ updatedAt: 500, cards: [{ id: 'wallets', w: 8 }, { id: 'budgets', w: 4 }, { id: 'breakdown', w: 4, h: 'tall' }, { id: 'recent', w: 8 }] }),
];
const ORDER_CORPUS = [
  null, 'x',
  JSON.stringify({ v: 1, format: 'order', updatedAt: 3, cards: [{ id: 'inbox' }, { id: 'budgets', hidden: true }, { id: 'ghost' }] }),
  JSON.stringify({ v: 1, format: 'order', updatedAt: 4, reset: true, cards: [] }),
];

test('board registry: Home\'s own cards first, unchanged, then Favourites, Safe to spend and every Analytics card as addable', () => {
  assert.deepEqual(HOME_BOARD_CARDS.slice(0, HOME_CARDS.length), [...HOME_CARDS]);
  assert.deepEqual(ownCards(HOME_BOARD_CARDS), [...HOME_CARDS]);
  const added = HOME_BOARD_CARDS.slice(HOME_CARDS.length);
  /* Home's own optional cards (More cards) come first, then every Analytics card. */
  assert.deepEqual(added.map((def) => def.id), ['favourites', 'safeSpend', ...ANALYTICS_IDS]);
  assert.ok(added.filter((def) => def.extra).every((def) => def.id === 'favourites' || def.id === 'safeSpend'));
  assert.ok(added.every((def) => def.addable === true));
  assert.ok(HOME_CARDS.every((def) => !def.addable) && ANALYTICS_CARDS.every((def) => !def.addable));
  for (const id of ['breakdown', 'recent', 'categoryPie', 'payees']) assert.ok(HOME_BOARD_HALVES.has(id), id);
  assert.ok(isAnalyticsCardId('sankey') && !isAnalyticsCardId('budgets'));
});

test('defaults: Home\'s, with no Analytics card', () => {
  assert.equal(serializeGridLayout(defaultGridLayout(HOME_BOARD_CARDS)), serializeGridLayout(defaultGridLayout(HOME_CARDS)));
  assert.deepEqual(defaultLayout(HOME_BOARD_CARDS), defaultLayout(HOME_CARDS));
  assert.equal(serializeOrder(defaultOrder(HOME_BOARD_CARDS)), serializeOrder(defaultOrder(HOME_CARDS)));
  assert.ok(isDefaultOrder(defaultOrder(HOME_CARDS), HOME_BOARD_CARDS));
  assert.ok(isDefaultGridLayout(defaultGridLayout(HOME_CARDS), HOME_BOARD_CARDS));
});

test('saved Home layouts: byte for byte as with Home\'s own registry, never gaining an Analytics card', () => {
  const now = gridLayoutFormat(HOME_LAYOUT_PAGE, HOME_LEGACY_LAYOUT_PAGE, HOME_BOARD_CARDS);
  const then = gridLayoutFormat(HOME_LAYOUT_PAGE, HOME_LEGACY_LAYOUT_PAGE, HOME_CARDS);
  for (const own of GRID_CORPUS) {
    for (const legacy of V1_CORPUS) {
      const stored = { 'home-grid': own, home: legacy };
      const read = now.readLocal(stored);
      assert.equal(now.serialize(read), then.serialize(then.readLocal(stored)), `${own} / ${legacy}`);
      assert.ok(!hasAnalytics(read.cards));
    }
    assert.equal(serializeGridLayout(sanitizeGridLayout(own, HOME_BOARD_CARDS)), serializeGridLayout(sanitizeGridLayout(own, HOME_CARDS)));
  }
  for (const raw of V1_CORPUS) assert.deepEqual(sanitizeLayout(raw, HOME_BOARD_CARDS), sanitizeLayout(raw, HOME_CARDS));
  const thenOrder = orderFormat('home-mobile', HOME_CARDS);
  for (const raw of ORDER_CORPUS) {
    const stored = { 'home-mobile': raw };
    const read = HOME_ORDER_FORMAT.readLocal(stored);
    assert.equal(serializeOrder(read), serializeOrder(thenOrder.readLocal(stored)));
    assert.ok(!hasAnalytics(read.cards));
    assert.equal(serializeOrder(sanitizeOrder(raw, HOME_BOARD_CARDS)), serializeOrder(sanitizeOrder(raw, HOME_CARDS)));
  }
});

test('desktop: add places an Analytics card at the first free spot; remove takes it out and floats the rest up', () => {
  const base = sanitizeGridLayout(GRID_CORPUS[4], HOME_BOARD_CARDS);
  const added = addGridCard(base, HOME_BOARD_CARDS, 'sankey');
  const card = added.cards.find((item) => item.id === 'sankey');
  assert.ok(card && !card.hidden && card.w === 12 && card.h === 8, JSON.stringify(card));
  /* Kept through a save and a read (sync to another device). */
  const round = sanitizeGridLayout(serializeGridLayout(added), HOME_BOARD_CARDS);
  assert.equal(serializeGridLayout(round), serializeGridLayout(added));
  /* Not twice. */
  assert.equal(addGridCard(added, HOME_BOARD_CARDS, 'sankey'), added);
  /* Dropped, the others where they were. */
  const removed = removeGridCard(added, 'sankey');
  assert.ok(!removed.cards.some((item) => item.id === 'sankey'));
  assert.equal(serializeGridLayout(removed), serializeGridLayout(base));
  assert.equal(removeGridCard(base, 'sankey'), base);
  /* At a chosen cell and size (a drag from the panel). */
  const at = addGridCard(base, HOME_BOARD_CARDS, 'categoryPie', { x: 6, y: 40 }, { w: 6, h: 7 });
  const pie = at.cards.find((item) => item.id === 'categoryPie');
  assert.equal(`${pie.x},${pie.w}x${pie.h}`, '6,6x7');
  /* On Home, an added card hidden in the editor is a removed one: the board
     drops hidden addable cards on Done, which leaves the original layout. */
  const hidden = setGridCardFlags(added, 'sankey', { hidden: true });
  const kept = { ...hidden, cards: hidden.cards.filter((item) => !(item.hidden && isAnalyticsCardId(item.id))) };
  assert.ok(!kept.cards.some((item) => item.id === 'sankey'));
});

test('phone: add goes at the end and shows; remove takes it out; a sync keeps it', () => {
  const base = sanitizeOrder(ORDER_CORPUS[2], HOME_BOARD_CARDS);
  const added = addToOrder(base, 'payees');
  assert.equal(added.cards.at(-1).id, 'payees');
  assert.ok(visibleIds(added).includes('payees'));
  assert.equal(addToOrder(added, 'payees'), added);
  const round = HOME_ORDER_FORMAT.readLocal({ 'home-mobile': serializeOrder(added) });
  assert.equal(serializeOrder(round), serializeOrder(added));
  assert.ok(!isDefaultOrder(addToOrder(defaultOrder(HOME_BOARD_CARDS), 'bills'), HOME_BOARD_CARDS));
  assert.equal(serializeOrder(removeFromOrder(added, 'payees')), serializeOrder(base));
  /* After a reset: an add makes a custom order again (no reset marker). */
  const reset = { ...defaultOrder(HOME_BOARD_CARDS, 9), reset: true };
  assert.equal(addToOrder(reset, 'bills').reset, undefined);
});
