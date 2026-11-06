import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  defaultOrder,
  isDefaultOrder,
  moveInOrder,
  sameOrder,
  sanitizeOrder,
  serializeOrder,
  setOrderHidden,
  unpairedHalves,
  visibleIds,
} = await import('../src/lib/layout/orderModel.ts');
const { HOME_CARDS, HOME_TABLET_HALVES } = await import('../src/lib/layout/homeCards.ts');
const { HOME_ORDER_FORMAT } = await import('../src/lib/layout/layoutFormats.ts');

const ids = (order) => order.cards.map((card) => card.id + (card.hidden ? '*' : ''));
const DEFAULT_IDS = HOME_CARDS.map((def) => def.id);
const stored = (cards, extra = {}) => JSON.stringify({ v: 1, format: 'order', updatedAt: 1000, cards, ...extra });

test('default: the registry order, nothing hidden', () => {
  const order = defaultOrder(HOME_CARDS);
  assert.deepEqual(ids(order), DEFAULT_IDS);
  assert.equal(order.updatedAt, 0);
  assert.ok(isDefaultOrder(order, HOME_CARDS));
});

test('sanitize: not an order (garbage, a desktop layout, another version) reads as the default', () => {
  const inputs = [
    null,
    '',
    'not json',
    '[]',
    42,
    { v: 2, format: 'order', cards: [] },
    JSON.stringify({ v: 1, updatedAt: 5, cards: [{ id: 'wallets', w: 4 }] }),
    JSON.stringify({ v: 1, format: 2, updatedAt: 5, cards: [{ id: 'wallets', x: 0, y: 0, w: 4, h: 7 }] }),
  ];
  for (const raw of inputs) {
    const order = sanitizeOrder(raw, HOME_CARDS);
    assert.deepEqual(ids(order), DEFAULT_IDS, String(raw));
    assert.equal(order.updatedAt, 0);
  }
});

test('sanitize: keeps the order and hidden flags, drops unknown ids and repeats', () => {
  const order = sanitizeOrder(
    stored([
      { id: 'recent' },
      { id: 'ghost' },
      { id: 'wallets', hidden: true },
      { id: 'recent', hidden: true },
      { id: 'budgets', hidden: 'yes' },
      7,
      null,
      { id: 'cashflow' },
      { id: 'breakdown' },
      { id: 'inbox' },
      { id: 'analytics', hidden: true },
    ]),
    HOME_CARDS,
  );
  assert.deepEqual(ids(order), ['recent', 'wallets*', 'budgets', 'cashflow', 'breakdown', 'inbox', 'analytics*']);
  assert.equal(order.updatedAt, 1000);
});

test('sanitize: a card the stored order lacks goes in after the card before it by default', () => {
  const only = (list) => stored(list.map((id) => ({ id })));
  /* Stored by a version without Inbox: it goes right after Recent, wherever Recent is. */
  const a = sanitizeOrder(only(['recent', 'budgets', 'wallets', 'cashflow', 'breakdown', 'analytics']), HOME_CARDS);
  assert.deepEqual(ids(a), ['recent', 'inbox', 'budgets', 'wallets', 'cashflow', 'breakdown', 'analytics']);
  /* The first card missing: it goes first. */
  const b = sanitizeOrder(only(['analytics', 'wallets', 'cashflow', 'breakdown', 'recent', 'inbox']), HOME_CARDS);
  assert.deepEqual(ids(b), ['budgets', 'analytics', 'wallets', 'cashflow', 'breakdown', 'recent', 'inbox']);
  /* Several missing, in a row: they keep their default order. */
  const c = sanitizeOrder(stored([{ id: 'analytics' }, { id: 'budgets', hidden: true }]), HOME_CARDS);
  assert.deepEqual(ids(c), ['analytics', 'budgets*', 'wallets', 'cashflow', 'breakdown', 'recent', 'inbox']);
  /* Empty: the default. */
  assert.deepEqual(ids(sanitizeOrder(stored([]), HOME_CARDS)), DEFAULT_IDS);
});

test('sanitize: a future card lands at its default spot (smaller registry stand-in)', () => {
  const registry = [{ id: 'a' }, { id: 'b' }, { id: 'new' }, { id: 'c' }];
  const order = sanitizeOrder(stored([{ id: 'c' }, { id: 'b' }, { id: 'a' }]), registry);
  assert.deepEqual(ids(order), ['c', 'b', 'new', 'a']);
});

test('reset marker: reads as the default and keeps its time', () => {
  const order = sanitizeOrder(stored([{ id: 'recent' }], { reset: true }), HOME_CARDS);
  assert.deepEqual(ids(order), DEFAULT_IDS);
  assert.equal(order.reset, true);
  assert.equal(order.updatedAt, 1000);
  assert.deepEqual(JSON.parse(serializeOrder(order)), { v: 1, format: 'order', updatedAt: 1000, reset: true, cards: [] });
});

test('serialize: round-trips, hidden only where set, and is what the server accepts', () => {
  const order = setOrderHidden(moveInOrder(defaultOrder(HOME_CARDS, 77), 'recent', -4), 'inbox', true);
  const text = serializeOrder(order);
  const parsed = JSON.parse(text);
  assert.equal(parsed.v, 1);
  assert.ok(Array.isArray(parsed.cards) && parsed.cards.length <= 64 && text.length <= 20000);
  assert.deepEqual(parsed.cards[0], { id: 'recent' });
  assert.deepEqual(parsed.cards.find((card) => card.id === 'inbox'), { id: 'inbox', hidden: true });
  assert.deepEqual(sanitizeOrder(text, HOME_CARDS), order);
});

test('move: one place up or down, stops at the ends, drops the reset flag', () => {
  const base = { ...defaultOrder(HOME_CARDS, 5), reset: true };
  const down = moveInOrder(base, 'budgets', 1);
  assert.deepEqual(ids(down).slice(0, 2), ['wallets', 'budgets']);
  assert.equal(down.reset, undefined);
  assert.equal(moveInOrder(base, 'budgets', -1), base);
  assert.equal(moveInOrder(base, 'analytics', 1), base);
  assert.equal(moveInOrder(base, 'nope', 1), base);
  assert.equal(ids(moveInOrder(base, 'analytics', -99))[0], 'analytics');
  assert.ok(isDefaultOrder(moveInOrder(down, 'budgets', -1), HOME_CARDS));
});

test('hide and show: only the flag changes; visible ids leave hidden cards out', () => {
  const hidden = setOrderHidden(defaultOrder(HOME_CARDS), 'wallets', true);
  assert.deepEqual(visibleIds(hidden), DEFAULT_IDS.filter((id) => id !== 'wallets'));
  assert.ok(!isDefaultOrder(hidden, HOME_CARDS));
  const back = setOrderHidden(hidden, 'wallets', false);
  assert.ok(isDefaultOrder(back, HOME_CARDS));
  assert.deepEqual(back.cards[1], { id: 'wallets' });
  assert.ok(sameOrder(back, defaultOrder(HOME_CARDS, 9)));
  assert.ok(!sameOrder(hidden, back));
  let all = defaultOrder(HOME_CARDS);
  for (const id of DEFAULT_IDS) all = setOrderHidden(all, id, true);
  assert.deepEqual(visibleIds(all), []);
});

test('tablet halves: side by side only in pairs', () => {
  const full = (list) => [...unpairedHalves(list, HOME_TABLET_HALVES)].sort();
  assert.deepEqual(full(DEFAULT_IDS), []);
  assert.deepEqual(full(['breakdown', 'budgets', 'recent']), ['breakdown', 'recent']);
  assert.deepEqual(full(['recent', 'breakdown', 'budgets']), []);
  assert.deepEqual(full(['budgets', 'recent']), ['recent']);
  assert.deepEqual(full([]), []);
  assert.deepEqual([...unpairedHalves(['a', 'b', 'c', 'x'], new Set(['a', 'b', 'c']))], ['c']);
});

test('synced format: its own key only, a server copy takes the server time', () => {
  assert.equal(HOME_ORDER_FORMAT.page, 'home-mobile');
  assert.equal(HOME_ORDER_FORMAT.legacyPages, undefined);
  const copy = HOME_ORDER_FORMAT.fromRemote({ key: 'layout.home-mobile', value: stored(['inbox', ...DEFAULT_IDS].map((id) => ({ id }))), updatedAt: 4242 }, 'home-mobile');
  assert.equal(copy.updatedAt, 4242);
  assert.equal(copy.cards[0].id, 'inbox');
  assert.ok(isDefaultOrder(HOME_ORDER_FORMAT.readLocal({}), HOME_CARDS));
});
