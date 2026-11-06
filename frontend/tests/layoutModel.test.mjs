import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  defaultLayout,
  effectiveSpan,
  isDefaultLayout,
  gapSuggestion,
  moveCard,
  moveCardBy,
  moveCardTo,
  packRows,
  reconcileLayouts,
  nearestWidth,
  sanitizeLayout,
  serializeLayout,
  spanPixels,
  updateCard,
} = await import('../src/lib/layout/layoutModel.ts');
const { HOME_CARDS } = await import('../src/lib/layout/homeCards.ts');

const ids = (layout) => layout.cards.map((card) => card.id);
const DEFAULT_ORDER = ['budgets', 'wallets', 'cashflow', 'breakdown', 'recent', 'inbox', 'analytics'];

test('default: today’s order and sizes (old 6-column spans doubled)', () => {
  const layout = defaultLayout(HOME_CARDS);
  assert.deepEqual(ids(layout), DEFAULT_ORDER);
  assert.deepEqual(layout.cards.map((c) => c.w), [8, 4, 12, 6, 6, 12, 12]);
  assert.equal(layout.updatedAt, 0);
  assert.ok(isDefaultLayout(layout, HOME_CARDS));
});

test('registry: every default fits its own minimum on the narrowest desktop (684px content)', () => {
  for (const def of HOME_CARDS) {
    assert.ok(def.widths.includes(def.defaultW), `${def.id} default is an allowed width`);
    assert.equal(effectiveSpan(def, def.defaultW, 684, 24), def.defaultW, `${def.id} not stepped up at 1000px`);
  }
});

test('sanitize: anything unreadable is the default, without throwing', () => {
  for (const raw of [null, undefined, 42, 'not json', '{"v":1}', { v: 2, cards: [] }, { v: 1, cards: 'x' }, []]) {
    assert.ok(isDefaultLayout(sanitizeLayout(raw, HOME_CARDS), HOME_CARDS), JSON.stringify(raw));
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
  assert.ok(isDefaultLayout(layout, HOME_CARDS));
  assert.equal(layout.updatedAt, 99);
  assert.equal(layout.reset, true);
});

test('serialize → sanitize round-trips, and omits unset fields', () => {
  let layout = defaultLayout(HOME_CARDS, 1234);
  layout = updateCard(layout, HOME_CARDS, 'wallets', { w: 6, collapsed: true });
  layout = updateCard(layout, HOME_CARDS, 'analytics', { hidden: true });
  const text = serializeLayout(layout);
  assert.ok(!text.includes('"collapsed":false'));
  assert.deepEqual(sanitizeLayout(text, HOME_CARDS), layout);
  assert.ok(text.length < 20000);
  const reset = serializeLayout({ ...defaultLayout(HOME_CARDS, 7), reset: true });
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

test('moveCard reorders and clears a reset marker', () => {
  const layout = { ...defaultLayout(HOME_CARDS, 3), reset: true };
  const moved = moveCard(layout, 6, 0);
  assert.equal(ids(moved)[0], 'analytics');
  assert.equal(moved.reset, undefined);
  assert.equal(moveCard(layout, 2, 2), layout);
});

test('moveCardTo: before/after a target; hidden cards keep their place', () => {
  let layout = updateCard(defaultLayout(HOME_CARDS), HOME_CARDS, 'cashflow', { hidden: true });
  layout = moveCardTo(layout, 'analytics', 'wallets', false);
  assert.deepEqual(ids(layout), ['budgets', 'analytics', 'wallets', 'cashflow', 'breakdown', 'recent', 'inbox']);
  layout = moveCardTo(layout, 'budgets', 'recent', true);
  assert.deepEqual(ids(layout), ['analytics', 'wallets', 'cashflow', 'breakdown', 'recent', 'budgets', 'inbox']);
  assert.equal(moveCardTo(layout, 'budgets', 'budgets', true), layout);
  assert.equal(moveCardTo(layout, 'budgets', 'recent', true), layout, 'already there: same object');
  assert.equal(moveCardTo(layout, 'budgets', 'ghost', true), layout);
});

test('moveCardBy: steps over hidden cards, stops at the ends', () => {
  const layout = updateCard(defaultLayout(HOME_CARDS), HOME_CARDS, 'cashflow', { hidden: true });
  const down = moveCardBy(layout, 'wallets', 1);
  /* The next visible card after wallets is breakdown (cashflow is hidden). */
  assert.deepEqual(ids(down).filter((id) => id !== 'cashflow'), ['budgets', 'breakdown', 'wallets', 'recent', 'inbox', 'analytics']);
  assert.equal(moveCardBy(layout, 'budgets', -1), layout);
  assert.equal(moveCardBy(layout, 'analytics', 1), layout);
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

test('gapSuggestion: widen the row’s last card first, else another; never invents a width', () => {
  const spans = { budgets: 8, wallets: 3, recent: 4, analytics: 3 };
  /* budgets 8 + wallets 3 → gap 1: wallets 3→4 is allowed. */
  assert.deepEqual(gapSuggestion({ ids: ['budgets', 'wallets'], used: 11 }, HOME_CARDS, spans), { id: 'wallets', w: 4 });
  /* recent 4 + analytics 3 → gap 5: analytics 8 is allowed. */
  assert.deepEqual(gapSuggestion({ ids: ['recent', 'analytics'], used: 7 }, HOME_CARDS, spans), { id: 'analytics', w: 8 });
  /* budgets 8 alone → gap 4: 12 is allowed. */
  assert.deepEqual(gapSuggestion({ ids: ['budgets'], used: 8 }, HOME_CARDS, spans), { id: 'budgets', w: 12 });
  /* wallets 3 + recent 4 → gap 5: recent 9 is not a width, so wallets 3→8. */
  assert.deepEqual(gapSuggestion({ ids: ['wallets', 'recent'], used: 7 }, HOME_CARDS, spans), { id: 'wallets', w: 8 });
  /* cashflow 8 + wallets 3 → gap 1: wallets 3→4. A full row has nothing to suggest. */
  assert.deepEqual(gapSuggestion({ ids: ['cashflow', 'wallets'], used: 11 }, HOME_CARDS, { cashflow: 8, wallets: 3 }), { id: 'wallets', w: 4 });
  /* cashflow 6 + recent 4 → gap 2: recent 6 is allowed. */
  assert.deepEqual(gapSuggestion({ ids: ['cashflow', 'recent'], used: 10 }, HOME_CARDS, { cashflow: 6, recent: 4 }), { id: 'recent', w: 6 });
  assert.equal(gapSuggestion({ ids: ['budgets', 'wallets'], used: 12 }, HOME_CARDS, spans), null);
  assert.equal(gapSuggestion({ ids: ['cashflow'], used: 6 }, HOME_CARDS, { cashflow: 6 })?.w, 12);
});

test('reconcileLayouts: last write wins; never-customised devices do nothing', () => {
  /* Fresh device, nothing on the server: no request beyond the check. */
  assert.equal(reconcileLayouts({ updatedAt: 0 }, null), 'none');
  /* Another PC saved: take it. */
  assert.equal(reconcileLayouts({ updatedAt: 0 }, { updatedAt: 50 }), 'adopt');
  assert.equal(reconcileLayouts({ updatedAt: 40 }, { updatedAt: 50 }), 'adopt');
  /* Edited here while offline, or before the redeploy: send it. */
  assert.equal(reconcileLayouts({ updatedAt: 60 }, { updatedAt: 50 }), 'upload');
  assert.equal(reconcileLayouts({ updatedAt: 60 }, null), 'upload');
  assert.equal(reconcileLayouts({ updatedAt: 50 }, { updatedAt: 50 }), 'none');
});

test('a reset from another device replaces an older custom layout here', () => {
  const custom = updateCard(defaultLayout(HOME_CARDS, 100), HOME_CARDS, 'wallets', { hidden: true });
  const remote = sanitizeLayout(serializeLayout({ ...defaultLayout(HOME_CARDS, 200), reset: true }), HOME_CARDS);
  assert.equal(reconcileLayouts(custom, remote), 'adopt');
  assert.ok(isDefaultLayout(remote, HOME_CARDS));
  assert.equal(remote.updatedAt, 200);
});
