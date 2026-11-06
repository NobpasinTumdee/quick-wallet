import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { isDefaultV1, serializeV1 } from './support/v1Format.mjs';

const { defaultLayout, effectiveSpan, packRows, nearestWidth, sanitizeLayout, spanPixels, updateCard } = await import(
  '../src/lib/layout/layoutModel.ts'
);
const { HOME_CARDS } = await import('../src/lib/layout/homeCards.ts');

const ids = (layout) => layout.cards.map((card) => card.id);
const DEFAULT_ORDER = ['budgets', 'wallets', 'cashflow', 'breakdown', 'recent', 'inbox', 'analytics'];

test('default: today’s order and sizes (old 6-column spans doubled)', () => {
  const layout = defaultLayout(HOME_CARDS);
  assert.deepEqual(ids(layout), DEFAULT_ORDER);
  assert.deepEqual(layout.cards.map((c) => c.w), [8, 4, 12, 6, 6, 12, 12]);
  assert.equal(layout.updatedAt, 0);
  assert.ok(isDefaultV1(layout, defaultLayout(HOME_CARDS)));
});

test('registry: every default fits its own minimum on the narrowest desktop (684px content)', () => {
  for (const def of HOME_CARDS) {
    assert.ok(def.widths.includes(def.defaultW), `${def.id} default is an allowed width`);
    assert.equal(effectiveSpan(def, def.defaultW, 684, 24), def.defaultW, `${def.id} not stepped up at 1000px`);
  }
});

test('sanitize: anything unreadable is the default, without throwing', () => {
  for (const raw of [null, undefined, 42, 'not json', '{"v":1}', { v: 2, cards: [] }, { v: 1, cards: 'x' }, []]) {
    assert.ok(isDefaultV1(sanitizeLayout(raw, HOME_CARDS), defaultLayout(HOME_CARDS)), JSON.stringify(raw));
  }
});

test('sanitize: unknown ids and duplicates dropped, sizes clamped, flags kept only when true', () => {
  const layout = sanitizeLayout(
    {
      v: 1,
      updatedAt: 1700000000000,
      cards: [
        { id: 'recent', w: 5, collapsed: true },
        { id: 'ghost', w: 6 },
        { id: 'recent', w: 12 },
        { id: 'wallets', w: 1, hidden: 'yes' },
        { id: 'cashflow', w: 3, h: 'huge' },
        { id: 'budgets', w: 12, h: 'tall', hidden: true },
      ],
    },
    HOME_CARDS,
  );
  const byId = Object.fromEntries(layout.cards.map((c) => [c.id, c]));
  assert.equal(layout.updatedAt, 1700000000000);
  assert.equal(layout.cards.filter((c) => c.id === 'recent').length, 1);
  assert.deepEqual(byId.recent, { id: 'recent', w: 6, collapsed: true }); // 5 → 6 (tie goes wider)
  assert.deepEqual(byId.wallets, { id: 'wallets', w: 3 }); // 1 → smallest; "yes" is not true
  assert.deepEqual(byId.cashflow, { id: 'cashflow', w: 6, h: 'normal' }); // below its smallest; unknown height
  assert.deepEqual(byId.budgets, { id: 'budgets', w: 12, h: 'tall', hidden: true });
  assert.equal(layout.cards.length, HOME_CARDS.length);
});

test('sanitize: a card the saved layout never had goes in at its default spot', () => {
  /* Saved before "breakdown" and "inbox" existed, in a custom order. */
  const layout = sanitizeLayout(
    { v: 1, updatedAt: 5, cards: [{ id: 'recent', w: 6 }, { id: 'cashflow', w: 12 }, { id: 'budgets', w: 8 }, { id: 'analytics', w: 4 }, { id: 'wallets', w: 4 }] },
    HOME_CARDS,
  );
  /* breakdown follows cashflow (its default predecessor); inbox follows recent. */
  assert.deepEqual(ids(layout), ['recent', 'inbox', 'cashflow', 'breakdown', 'budgets', 'analytics', 'wallets']);
  const added = layout.cards.find((c) => c.id === 'breakdown');
  assert.deepEqual(added, { id: 'breakdown', w: 6, h: 'normal' });
});

test('sanitize: a reset marker means the default, and keeps its time so it wins a sync', () => {
  const layout = sanitizeLayout({ v: 1, updatedAt: 99, reset: true, cards: [] }, HOME_CARDS);
  assert.ok(isDefaultV1(layout, defaultLayout(HOME_CARDS)));
  assert.equal(layout.updatedAt, 99);
  assert.equal(layout.reset, true);
});

test('serialize → sanitize round-trips, and omits unset fields', () => {
  let layout = defaultLayout(HOME_CARDS, 1234);
  layout = updateCard(layout, HOME_CARDS, 'wallets', { w: 6, collapsed: true });
  layout = updateCard(layout, HOME_CARDS, 'analytics', { hidden: true });
  const text = serializeV1(layout);
  assert.ok(!text.includes('"collapsed":false'));
  assert.deepEqual(sanitizeLayout(text, HOME_CARDS), layout);
  assert.ok(text.length < 20000);
  const reset = serializeV1({ ...defaultLayout(HOME_CARDS, 7), reset: true });
  assert.deepEqual(JSON.parse(reset), { v: 1, updatedAt: 7, reset: true, cards: [] });
});

test('nearestWidth and updateCard keep sizes legal', () => {
  const analytics = HOME_CARDS.find((d) => d.id === 'analytics');
  assert.equal(nearestWidth(analytics, 7), 8);
  assert.equal(nearestWidth(analytics, 'x'), 12);
  const layout = updateCard(defaultLayout(HOME_CARDS), HOME_CARDS, 'recent', { w: 3, h: 'tall' });
  /* recent: smallest is 4, and it has no height steps. */
  assert.deepEqual(layout.cards.find((c) => c.id === 'recent'), { id: 'recent', w: 4 });
});

test('effectiveSpan: steps a too-narrow card up, never down', () => {
  const wallets = HOME_CARDS.find((d) => d.id === 'wallets'); // min 200
  const budgets = HOME_CARDS.find((d) => d.id === 'budgets'); // min 320
  /* 684px content (1000px window): 3 cols ≈ 153px → 4 cols ≈ 212px. */
  assert.equal(effectiveSpan(wallets, 3, 684, 24), 4);
  /* 964px content (1280px window): 3 cols ≈ 223px fits. */
  assert.equal(effectiveSpan(wallets, 3, 964, 24), 3);
  assert.equal(effectiveSpan(budgets, 4, 684, 24), 6);
  assert.equal(effectiveSpan(budgets, 4, 1284, 24), 4);
  /* Not measured yet: the chosen width stands. */
  assert.equal(effectiveSpan(budgets, 4, 0, 24), 4);
  assert.ok(Math.abs(spanPixels(12, 684, 24) - 684) < 1e-9);
});

test('packRows: left to right, a card that does not fit starts the next row', () => {
  const rows = packRows([
    { id: 'a', span: 8 },
    { id: 'b', span: 6 },
    { id: 'c', span: 6 },
    { id: 'd', span: 3 },
    { id: 'e', span: 12 },
  ]);
  assert.deepEqual(rows, [
    { ids: ['a'], used: 8 },
    { ids: ['b', 'c'], used: 12 },
    { ids: ['d'], used: 3 },
    { ids: ['e'], used: 12 },
  ]);
  /* The default layout tiles exactly: no gaps anywhere. */
  const base = defaultLayout(HOME_CARDS).cards.map((c) => ({ id: c.id, span: c.w }));
  assert.ok(packRows(base).every((row) => row.used === 12));
});

test('a reset written by the old app reads as the default and keeps its time', () => {
  const remote = sanitizeLayout(serializeV1({ ...defaultLayout(HOME_CARDS, 200), reset: true }), HOME_CARDS);
  assert.ok(isDefaultV1(remote, defaultLayout(HOME_CARDS)));
  assert.equal(remote.updatedAt, 200);
  assert.equal(remote.reset, true);
});
