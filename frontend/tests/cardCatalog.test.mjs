import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

/* The card catalog: Home's slice is exactly the registry Home had before the
   catalog, and every saved Home layout reads and writes byte for byte as it
   did. Analytics' slice is today's page, in today's order. */
const { HOME_CARDS, HOME_LAYOUT_PAGE, HOME_LEGACY_LAYOUT_PAGE, HOME_ORDER_PAGE, HOME_TABLET_HALVES } = await import('../src/lib/layout/homeCards.ts');
const { ANALYTICS_CARDS, ANALYTICS_LAYOUT_PAGE, ANALYTICS_ORDER_PAGE, ANALYTICS_TABLET_HALVES } = await import('../src/lib/layout/analyticsCards.ts');
const { HOME_ORDER_FORMAT, gridLayoutFormat, orderFormat } = await import('../src/lib/layout/layoutFormats.ts');
const { sanitizeGridLayout, serializeGridLayout, defaultGridLayout } = await import('../src/lib/layout/gridModel.ts');
const { sanitizeOrder, serializeOrder } = await import('../src/lib/layout/orderModel.ts');
const { serializeV1 } = await import('./support/v1Format.mjs');

/* Home's registry as it was in homeCards.ts before the catalog, verbatim. */
const BEFORE = [
  { id: 'budgets', titleKey: 'dashboard.budgetProgress', widths: [4, 6, 8, 12], minPx: 320, defaultW: 8, heights: ['normal', 'tall'], minW: 4, minH: 5, maxH: 16, defaultH: 9 },
  { id: 'wallets', titleKey: 'dashboard.walletsTitle', widths: [3, 4, 6, 8, 12], minPx: 200, defaultW: 4, minW: 3, minH: 4, maxH: 16, defaultH: 7 },
  { id: 'cashflow', titleKey: 'layout.cardCashflow', widths: [6, 8, 12], minPx: 420, defaultW: 12, heights: ['normal', 'tall'], minW: 6, minH: 8, maxH: 14, defaultH: 9 },
  { id: 'breakdown', titleKey: 'dashboard.breakdownTitle', widths: [4, 6, 8, 12], minPx: 300, defaultW: 6, heights: ['normal', 'tall'], minW: 4, minH: 4, maxH: 16, defaultH: 7 },
  { id: 'recent', titleKey: 'dashboard.recentTitle', widths: [4, 6, 8, 12], minPx: 300, defaultW: 6, minW: 4, minH: 4, maxH: 16, defaultH: 10 },
  { id: 'inbox', titleKey: 'inbox.title', widths: [6, 8, 12], minPx: 360, defaultW: 12, minW: 6, minH: 3, maxH: 16, defaultH: 3 },
  { id: 'analytics', titleKey: 'analytics.title', widths: [3, 4, 6, 8, 12], minPx: 240, defaultW: 12, minW: 3, minH: 3, maxH: 3, defaultH: 3 },
];

/* Saved Home layouts of every kind a device or the server may hold. */
const placed = JSON.stringify({
  v: 1, format: 2, updatedAt: 1700000000000,
  cards: [
    { id: 'recent', x: 0, y: 0, w: 6, h: 10 },
    { id: 'wallets', x: 6, y: 0, w: 3, h: 4, collapsed: true },
    { id: 'budgets', x: 6, y: 4, w: 6, h: 9 },
    { id: 'cashflow', x: 0, y: 13, w: 12, h: 8, hidden: true },
    { id: 'breakdown', x: 0, y: 10, w: 4, h: 6 },
    { id: 'inbox', x: 0, y: 21, w: 12, h: 3 },
  ],
});
const flow = JSON.stringify({ v: 1, format: 2, updatedAt: 42, cards: [{ id: 'cashflow', w: 12, tall: true }, { id: 'budgets', w: 6 }, { id: 'wallets', w: 6, hidden: true }] });
const GRID_CORPUS = [
  null, '', 'garbage', '{}', placed, flow,
  JSON.stringify({ v: 1, format: 2, updatedAt: 99, reset: true, cards: [] }),
  JSON.stringify({ v: 1, format: 2, updatedAt: 7, cards: [{ id: 'ghost', x: 0, y: 0, w: 4, h: 4 }, { id: 'inbox', x: 9, y: 500, w: 40, h: 1 }] }),
];
const V1_CORPUS = [
  serializeV1({ updatedAt: 500, cards: [{ id: 'wallets', w: 8 }, { id: 'budgets', w: 4 }, { id: 'breakdown', w: 4, h: 'tall' }, { id: 'recent', w: 8 }, { id: 'cashflow', w: 12, collapsed: true }, { id: 'inbox', w: 6 }, { id: 'analytics', w: 6 }] }),
  serializeV1({ updatedAt: 9, cards: [{ id: 'inbox', w: 12, hidden: true }] }),
];
const ORDER_CORPUS = [
  null, 'x',
  JSON.stringify({ v: 1, format: 'order', updatedAt: 3, cards: [{ id: 'inbox' }, { id: 'budgets', hidden: true }, { id: 'ghost' }] }),
  JSON.stringify({ v: 1, format: 'order', updatedAt: 4, reset: true, cards: [] }),
];

test('Home slice: the same cards, order and sizes as before the catalog', () => {
  assert.deepEqual(HOME_CARDS.map((def) => ({ ...def })), BEFORE);
  assert.deepEqual([...HOME_TABLET_HALVES], ['breakdown', 'recent']);
  assert.equal(HOME_LAYOUT_PAGE, 'home-grid');
  assert.equal(HOME_LEGACY_LAYOUT_PAGE, 'home');
  assert.equal(HOME_ORDER_PAGE, 'home-mobile');
});

test('Home desktop: every saved layout reads and writes byte for byte as before', () => {
  const now = gridLayoutFormat(HOME_LAYOUT_PAGE, HOME_LEGACY_LAYOUT_PAGE, HOME_CARDS);
  const then = gridLayoutFormat('home-grid', 'home', BEFORE);
  assert.deepEqual(now.legacyPages, ['home']);
  for (const own of [...GRID_CORPUS]) {
    for (const legacy of [null, ...V1_CORPUS]) {
      const stored = { 'home-grid': own, home: legacy };
      assert.equal(now.serialize(now.readLocal(stored)), then.serialize(then.readLocal(stored)), `${own} / ${legacy}`);
    }
    assert.equal(serializeGridLayout(sanitizeGridLayout(own, HOME_CARDS)), serializeGridLayout(sanitizeGridLayout(own, BEFORE)));
    for (const page of ['home-grid', 'home']) {
      const pref = { key: `layout.${page}`, value: own ?? '', updatedAt: 1234 };
      assert.equal(now.serialize(now.fromRemote(pref, page)), then.serialize(then.fromRemote(pref, page)));
    }
  }
});

test('Home phone order: the shared order format reads and writes as before', () => {
  const then = orderFormat('home-mobile', BEFORE);
  assert.equal(HOME_ORDER_FORMAT.page, 'home-mobile');
  assert.equal(HOME_ORDER_FORMAT.legacyPages, undefined);
  for (const raw of ORDER_CORPUS) {
    const stored = { 'home-mobile': raw };
    assert.equal(serializeOrder(HOME_ORDER_FORMAT.readLocal(stored)), serializeOrder(then.readLocal(stored)));
    assert.equal(serializeOrder(sanitizeOrder(raw, HOME_CARDS)), serializeOrder(sanitizeOrder(raw, BEFORE)));
  }
});

test('Analytics slice: today\'s cards in today\'s order, its own keys, no older key', () => {
  assert.deepEqual(
    ANALYTICS_CARDS.map((def) => `${def.id}:${def.defaultW}`),
    ['bills:12', 'savingsRate:12', 'categoryPie:6', 'categoryTree:6', 'spendHeatmap:6', 'categoryBoxplot:12', 'payees:6', 'sankey:12', 'projection:12'],
  );
  assert.deepEqual([...ANALYTICS_TABLET_HALVES].sort(), ['categoryPie', 'categoryTree', 'payees', 'spendHeatmap']);
  assert.equal(ANALYTICS_LAYOUT_PAGE, 'analytics-grid');
  assert.equal(ANALYTICS_ORDER_PAGE, 'analytics-mobile');
  const format = gridLayoutFormat(ANALYTICS_LAYOUT_PAGE, undefined, ANALYTICS_CARDS);
  assert.equal(format.legacyPages, undefined);
  assert.equal(format.serialize(format.readLocal({})), serializeGridLayout(defaultGridLayout(ANALYTICS_CARDS)));
});

test('catalog: ids unique across pages, names unambiguous, sizes consistent', async () => {
  const { en } = await import('../src/locales/en.ts');
  const { th } = await import('../src/locales/th.ts');
  const all = [...HOME_CARDS, ...ANALYTICS_CARDS];
  assert.equal(new Set(all.map((def) => def.id)).size, all.length);
  for (const locale of [en, th]) {
    const name = (key) => key.split('.').reduce((node, part) => node?.[part], locale);
    const names = all.map((def) => name(def.titleKey));
    assert.ok(names.every((value) => typeof value === 'string' && value.length > 0), names.join());
    assert.equal(new Set(names.map((value) => value.toLowerCase())).size, names.length, names.join(' | '));
  }
  for (const def of all) {
    assert.ok(def.widths.includes(def.defaultW), def.id);
    assert.ok(def.minW <= def.defaultW && def.minH <= def.defaultH && def.defaultH <= def.maxH, def.id);
    /* Never wider than its default comes to at 1000px (a 684px grid, 24px gaps). */
    const at1000 = ((684 - 11 * 24) / 12) * def.defaultW + (def.defaultW - 1) * 24;
    assert.ok(def.minPx <= at1000 + 0.5, `${def.id} ${def.minPx} > ${at1000}`);
  }
});

/* Opening Customize: the draft is taken from where the cards are drawn. */
const { placeFlowLayout, ROW_PX } = await import('../src/lib/layout/gridModel.ts');

/* A 1280px-wide grid's column pitch (1088px content, 24px gaps). */
const PITCH = (1088 + 24) / 12;
const rowsPx = (rows) => rows * ROW_PX + (rows - 1) * 24;

test('Customize on Analytics: the draft keeps the back-filled default exactly where it is drawn', () => {
  const layout = defaultGridLayout(ANALYTICS_CARDS);
  const spans = Object.fromEntries(ANALYTICS_CARDS.map((def) => [def.id, def.defaultW]));
  /* Measured as drawn: the treemap is shorter than the pie beside it. */
  const heights = Object.fromEntries(ANALYTICS_CARDS.map((def) => [def.id, rowsPx(def.defaultH)]));
  /* Drawn as today's dense grid draws it: Top payees beside Spending by day. */
  const row = (rows) => rows * (ROW_PX + 24);
  const boxes = {
    bills: { top: 0, left: 0 },
    savingsRate: { top: row(8), left: 0 },
    categoryPie: { top: row(13), left: 0 },
    categoryTree: { top: row(13), left: 6 * PITCH },
    spendHeatmap: { top: row(20), left: 0 },
    payees: { top: row(20), left: 6 * PITCH },
    categoryBoxplot: { top: row(26), left: 0 },
    sankey: { top: row(33), left: 0 },
    projection: { top: row(41), left: 0 },
  };
  const out = placeFlowLayout(layout, ANALYTICS_CARDS, spans, heights, 24, { boxes, pitch: PITCH });
  const at = Object.fromEntries(out.cards.map((card) => [card.id, `${card.x},${card.y},${card.w}x${card.h}`]));
  assert.deepEqual(at, {
    bills: '0,0,12x8',
    savingsRate: '0,8,12x5',
    categoryPie: '0,13,6x7',
    categoryTree: '6,13,6x7',
    spendHeatmap: '0,20,6x6',
    payees: '6,20,6x6',
    categoryBoxplot: '0,26,12x7',
    sankey: '0,33,12x8',
    projection: '0,41,12x7',
  });
});

test('Customize on Home: drawn positions give exactly the draft order packing gave', () => {
  const heights = { budgets: 565, wallets: 440, cashflow: 572, breakdown: 419, recent: 609, inbox: 168, analytics: 170 };
  const spans = Object.fromEntries(HOME_CARDS.map((def) => [def.id, def.defaultW]));
  const tops = { budgets: 0, wallets: 0, cashflow: 589, breakdown: 1185, recent: 1185, inbox: 1818, analytics: 2010 };
  const lefts = { budgets: 0, wallets: 8 * PITCH, cashflow: 0, breakdown: 0, recent: 6 * PITCH, inbox: 0, analytics: 0 };
  const boxes = Object.fromEntries(HOME_CARDS.map((def) => [def.id, { top: tops[def.id], left: lefts[def.id] }]));
  const layouts = [
    defaultGridLayout(HOME_CARDS),
    sanitizeGridLayout(flow, HOME_CARDS),
  ];
  for (const layout of layouts) {
    const packed = placeFlowLayout(layout, HOME_CARDS, spans, heights, 24);
    const drawnBoxes = Object.fromEntries(layout.cards.filter((c) => !c.hidden).map((c) => [c.id, boxes[c.id]]));
    /* The flow layout's own positions, drawn as order packing would put them. */
    if (layout !== layouts[0]) {
      for (const card of packed.cards.filter((c) => !c.hidden).sort((a, b) => a.y - b.y || a.x - b.x)) {
        drawnBoxes[card.id] = { top: card.y * 1000, left: card.x * PITCH };
      }
    }
    const drawn = placeFlowLayout(layout, HOME_CARDS, spans, heights, 24, { boxes: drawnBoxes, pitch: PITCH });
    assert.equal(serializeGridLayout(drawn), serializeGridLayout(packed));
  }
  /* A card not measured: back to order packing. */
  const layout = defaultGridLayout(HOME_CARDS);
  const partial = { ...boxes };
  delete partial.inbox;
  assert.equal(
    serializeGridLayout(placeFlowLayout(layout, HOME_CARDS, spans, heights, 24, { boxes: partial, pitch: PITCH })),
    serializeGridLayout(placeFlowLayout(layout, HOME_CARDS, spans, heights, 24)),
  );
});

test('Analytics desktop sync: its own key, round trip, and Home\'s keys untouched', () => {
  const format = gridLayoutFormat(ANALYTICS_LAYOUT_PAGE, undefined, ANALYTICS_CARDS);
  const saved = JSON.stringify({
    v: 1, format: 2, updatedAt: 555,
    cards: [
      { id: 'payees', x: 0, y: 0, w: 4, h: 6 },
      { id: 'sankey', x: 4, y: 0, w: 8, h: 8 },
      { id: 'bills', x: 0, y: 8, w: 12, h: 8, collapsed: true },
      { id: 'projection', x: 0, y: 9, w: 12, h: 7, hidden: true },
    ],
  });
  const local = format.readLocal({ 'analytics-grid': saved, 'home-grid': placed, home: V1_CORPUS[0] });
  const remote = format.fromRemote({ key: 'layout.analytics-grid', value: saved, updatedAt: 555 }, 'analytics-grid');
  assert.equal(format.serialize(local), format.serialize(remote));
  assert.equal(local.updatedAt, 555);
  /* A card the saved layout does not name comes back at a free spot, visible. */
  assert.equal(local.cards.length, ANALYTICS_CARDS.length);
  /* Home cards never leak into the Analytics layout, and vice versa. */
  assert.ok(local.cards.every((card) => ANALYTICS_CARDS.some((def) => def.id === card.id)));
  const home = gridLayoutFormat(HOME_LAYOUT_PAGE, HOME_LEGACY_LAYOUT_PAGE, HOME_CARDS);
  const homeWith = home.readLocal({ 'home-grid': placed, 'analytics-grid': saved });
  const homeWithout = home.readLocal({ 'home-grid': placed });
  assert.equal(home.serialize(homeWith), home.serialize(homeWithout));
  assert.ok(format.serialize(local).length < 20000);
});

/* Phones and tablets: Analytics' order, on its own key. */
const { ANALYTICS_ORDER_FORMAT } = await import('../src/lib/layout/layoutFormats.ts');
const { defaultOrder, isDefaultOrder, moveInOrder, setOrderHidden, unpairedHalves, visibleIds } = await import('../src/lib/layout/orderModel.ts');

test('Analytics phone order: its own key, round trip, Home\'s order untouched', () => {
  assert.equal(ANALYTICS_ORDER_FORMAT.page, 'analytics-mobile');
  assert.equal(ANALYTICS_ORDER_FORMAT.legacyPages, undefined);
  let order = defaultOrder(ANALYTICS_CARDS);
  order = setOrderHidden(moveInOrder(order, 'projection', -8), 'bills', true);
  const raw = serializeOrder({ ...order, updatedAt: 77 });
  const local = ANALYTICS_ORDER_FORMAT.readLocal({ 'analytics-mobile': raw, 'home-mobile': ORDER_CORPUS[2] });
  const remote = ANALYTICS_ORDER_FORMAT.fromRemote({ key: 'layout.analytics-mobile', value: raw, updatedAt: 77 }, 'analytics-mobile');
  assert.equal(serializeOrder(local), serializeOrder(remote));
  assert.deepEqual(local.cards.slice(0, 2).map((card) => card.id), ['projection', 'bills']);
  assert.equal(local.cards.find((card) => card.id === 'bills').hidden, true);
  /* Home's order reads the same with or without Analytics' beside it. */
  assert.equal(
    serializeOrder(HOME_ORDER_FORMAT.readLocal({ 'home-mobile': ORDER_CORPUS[2], 'analytics-mobile': raw })),
    serializeOrder(HOME_ORDER_FORMAT.readLocal({ 'home-mobile': ORDER_CORPUS[2] })),
  );
  /* No saved order: the default, which draws as today's page. */
  assert.ok(isDefaultOrder(ANALYTICS_ORDER_FORMAT.readLocal({}), ANALYTICS_CARDS));
});

test('Analytics on a tablet: a custom order keeps its order, half cards pair only side by side', () => {
  /* Today's default back-fills Top payees beside Spending by day; a saved
     order equal to the default is drawn as the default (CardBoard), so this
     only applies once the order really changes. */
  const moved = moveInOrder(defaultOrder(ANALYTICS_CARDS), 'projection', -1);
  assert.deepEqual([...unpairedHalves(visibleIds(moved), ANALYTICS_TABLET_HALVES)].sort(), ['payees', 'spendHeatmap']);
  /* Hiding the box plot puts the two next to each other again: a pair. */
  const hidden = setOrderHidden(defaultOrder(ANALYTICS_CARDS), 'categoryBoxplot', true);
  assert.deepEqual([...unpairedHalves(visibleIds(hidden), ANALYTICS_TABLET_HALVES)], []);
  /* Home's two halves next to each other, as always. */
  assert.deepEqual([...unpairedHalves(visibleIds(defaultOrder(HOME_CARDS)), HOME_TABLET_HALVES)], []);
});
