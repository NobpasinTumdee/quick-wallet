import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  defaultGridLayout,
  firstFreeSpot,
  fitGridToWidth,
  isDefaultGridLayout,
  isPlaced,
  migrateV1,
  minColumnsFor,
  moveGridCard,
  overlaps,
  placeFlowLayout,
  resizeGridCard,
  rowsForPixels,
  rowsOf,
  sanitizeGridLayout,
  serializeGridLayout,
  setGridCardFlags,
  settle,
  showGridCard,
  toCardLayout,
} = await import('../src/lib/layout/gridModel.ts');
const { defaultLayout, sanitizeLayout } = await import('../src/lib/layout/layoutModel.ts');
const { serializeV1 } = await import('./support/v1Format.mjs');
const { HOME_CARDS } = await import('../src/lib/layout/homeCards.ts');

const DEFAULT_ORDER = ['budgets', 'wallets', 'cashflow', 'breakdown', 'recent', 'inbox', 'analytics'];
const ids = (layout) => layout.cards.map((card) => card.id);
const byId = (layout) => Object.fromEntries(layout.cards.map((card) => [card.id, card]));
const box = (card) => ({ x: card.x, y: card.y, w: card.w, h: rowsOf(card) });

/** No two visible cards overlap, all inside 12 columns, and nothing could float up. */
function assertSettled(layout) {
  const visible = layout.cards.filter((card) => !card.hidden);
  for (const card of visible) {
    assert.ok(card.x >= 0 && card.x + card.w <= 12, `${card.id} inside the grid`);
    assert.ok(card.y >= 0, `${card.id} y >= 0`);
  }
  for (let i = 0; i < visible.length; i += 1) {
    for (let j = i + 1; j < visible.length; j += 1) {
      assert.ok(!overlaps(box(visible[i]), box(visible[j])), `${visible[i].id} and ${visible[j].id} overlap`);
    }
  }
  for (const card of visible) {
    if (card.y === 0) continue;
    const up = { ...box(card), y: card.y - 1 };
    assert.ok(
      visible.some((other) => other !== card && overlaps(up, box(other))),
      `${card.id} could float up from ${card.y}`,
    );
  }
}

/** A placed layout of the default cards, for edit tests. */
function placedHome() {
  return sanitizeGridLayout(
    {
      v: 1,
      format: 2,
      updatedAt: 5,
      cards: [
        { id: 'budgets', x: 0, y: 0, w: 8, h: 9 },
        { id: 'wallets', x: 8, y: 0, w: 4, h: 7 },
        { id: 'cashflow', x: 0, y: 9, w: 12, h: 9 },
        { id: 'breakdown', x: 0, y: 18, w: 6, h: 7 },
        { id: 'recent', x: 6, y: 18, w: 6, h: 10 },
        { id: 'inbox', x: 0, y: 28, w: 12, h: 3 },
        { id: 'analytics', x: 0, y: 31, w: 12, h: 3 },
      ],
    },
    HOME_CARDS,
  );
}

/* ---- Registry ---- */

test('registry: every card has sane grid limits', () => {
  for (const def of HOME_CARDS) {
    assert.ok(def.minW >= 1 && def.minW <= def.defaultW && def.defaultW <= 12, `${def.id} widths`);
    assert.ok(def.minH >= 1 && def.minH <= def.defaultH && def.defaultH <= def.maxH, `${def.id} heights`);
  }
});

/* ---- First version → flow ---- */

test('migrate: a first-version layout keeps order, widths, Tall, collapsed and hidden', () => {
  const old = sanitizeLayout(
    {
      v: 1,
      updatedAt: 1760000000000,
      cards: [
        { id: 'wallets', w: 4 },
        { id: 'budgets', w: 8, h: 'tall' },
        { id: 'breakdown', w: 4, h: 'tall' },
        { id: 'recent', w: 8 },
        { id: 'cashflow', w: 12, h: 'normal', collapsed: true },
        { id: 'inbox', w: 6 },
        { id: 'analytics', w: 6, hidden: true },
      ],
    },
    HOME_CARDS,
  );
  const migrated = migrateV1(old);
  assert.equal(isPlaced(migrated), false);
  assert.equal(migrated.updatedAt, 1760000000000);
  assert.deepEqual(ids(migrated), ['wallets', 'budgets', 'breakdown', 'recent', 'cashflow', 'inbox', 'analytics']);
  /* Back in first-version terms it is the very same layout. */
  assert.deepEqual(toCardLayout(migrated, HOME_CARDS), old);
  assert.equal(serializeV1(toCardLayout(migrated, HOME_CARDS)), serializeV1(old));
});

test('migrate: a reset marker stays a reset marker, with its time', () => {
  const old = sanitizeLayout({ v: 1, updatedAt: 99, reset: true, cards: [] }, HOME_CARDS);
  const migrated = migrateV1(old);
  assert.equal(migrated.reset, true);
  assert.equal(migrated.updatedAt, 99);
  assert.equal(isDefaultGridLayout(migrated, HOME_CARDS), true);
});

test('default: a flow layout that is the first version’s default', () => {
  const layout = defaultGridLayout(HOME_CARDS);
  assert.equal(isPlaced(layout), false);
  assert.deepEqual(ids(layout), DEFAULT_ORDER);
  assert.deepEqual(toCardLayout(layout, HOME_CARDS), defaultLayout(HOME_CARDS));
  assert.equal(isDefaultGridLayout(layout, HOME_CARDS), true);
});

/* ---- Stored form ---- */

test('serialize: v stays 1 (the server accepts nothing else), format 2, cards kept', () => {
  const flow = JSON.parse(serializeGridLayout({ ...defaultGridLayout(HOME_CARDS), updatedAt: 7 }));
  assert.equal(flow.v, 1);
  assert.equal(flow.format, 2);
  assert.equal(flow.cards.length, 7);
  assert.deepEqual(flow.cards[0], { id: 'budgets', w: 8 });

  const placed = JSON.parse(serializeGridLayout(placedHome()));
  assert.deepEqual(placed.cards[0], { id: 'budgets', x: 0, y: 0, w: 8, h: 9 });

  const reset = JSON.parse(serializeGridLayout({ ...defaultGridLayout(HOME_CARDS), updatedAt: 9, reset: true }));
  assert.deepEqual(reset, { v: 1, format: 2, updatedAt: 9, reset: true, cards: [] });
});

test('serialize → sanitize round-trips flow and placed layouts', () => {
  for (const layout of [
    migrateV1(sanitizeLayout({ v: 1, updatedAt: 3, cards: [{ id: 'recent', w: 4, collapsed: true }, { id: 'budgets', w: 12, h: 'tall' }] }, HOME_CARDS)),
    placedHome(),
  ]) {
    assert.deepEqual(sanitizeGridLayout(serializeGridLayout(layout), HOME_CARDS), layout);
  }
});

test('stays well inside the server limits (20,000 characters, 64 cards)', () => {
  const text = serializeGridLayout(placedHome());
  assert.ok(text.length < 1000, `${text.length} characters`);
});

/* ---- Sanitize ---- */

test('sanitize: rubbish, other formats and the first version’s shape give the default', () => {
  for (const raw of [null, 'not json', '[]', 42, { v: 1, cards: [] }, { v: 2, format: 2, cards: [] }, { v: 1, format: 3, cards: [] }, { v: 1, format: 2 }]) {
    const out = sanitizeGridLayout(raw, HOME_CARDS);
    assert.equal(isDefaultGridLayout(out, HOME_CARDS), true, JSON.stringify(raw));
  }
});

test('sanitize: a reset marker is the default and keeps reset + time', () => {
  const out = sanitizeGridLayout({ v: 1, format: 2, updatedAt: 50, reset: true, cards: [] }, HOME_CARDS);
  assert.equal(out.reset, true);
  assert.equal(out.updatedAt, 50);
  assert.equal(isDefaultGridLayout(out, HOME_CARDS), true);
});

test('sanitize placed: overlaps pushed apart, out of range clamped, below minimum grown, unknown dropped', () => {
  const out = sanitizeGridLayout(
    {
      v: 1,
      format: 2,
      updatedAt: 1,
      cards: [
        { id: 'budgets', x: 0, y: 0, w: 8, h: 9 },
        { id: 'wallets', x: 2, y: 3, w: 4, h: 7 }, // on top of budgets
        { id: 'cashflow', x: 9, y: 50, w: 2, h: 99 }, // too narrow, too tall, off the edge
        { id: 'breakdown', x: -4, y: -3, w: 1, h: 1 }, // below minimum, negative
        { id: 'nope', x: 0, y: 0, w: 4, h: 4 },
        { id: 'budgets', x: 4, y: 4, w: 4, h: 4 }, // repeat
        { id: 'recent', x: 0, y: 40, w: 6.6, h: 5.4 },
        { id: 'inbox', x: 0, y: 60, w: 12, h: 3 },
        { id: 'analytics', x: 0, y: 70, w: 12, h: 3 },
      ],
    },
    HOME_CARDS,
  );
  const cards = byId(out);
  assert.equal(out.cards.length, 7);
  assert.ok(!('nope' in cards));
  assert.deepEqual([cards.cashflow.w, cards.cashflow.h], [6, 14]);
  assert.deepEqual([cards.breakdown.w, cards.breakdown.h], [4, 4]);
  assert.equal(cards.breakdown.x, 0);
  assert.deepEqual([cards.recent.w, cards.recent.h], [7, 5]);
  assert.equal(cards.cashflow.x, 6);
  assertSettled(out);
});

test('sanitize placed: a card the layout never heard of goes in at the first free spot', () => {
  const raw = JSON.parse(serializeGridLayout(placedHome()));
  raw.cards = raw.cards.filter((card) => card.id !== 'wallets');
  const out = sanitizeGridLayout(raw, HOME_CARDS);
  const wallets = byId(out).wallets;
  assert.deepEqual([wallets.x, wallets.y, wallets.w, wallets.h], [8, 0, 4, 7]);
  assertSettled(out);
});

test('sanitize flow: the first version’s rules (nearest width, missing cards at their default spot)', () => {
  const out = sanitizeGridLayout({ v: 1, format: 2, updatedAt: 2, cards: [{ id: 'recent', w: 5 }, { id: 'budgets', w: 8, tall: true }] }, HOME_CARDS);
  assert.equal(isPlaced(out), false);
  /* Missing cards go in after the card that precedes them by default:
     Inbox after Recent, Wallets after Budget. */
  assert.deepEqual(ids(out), ['recent', 'inbox', 'analytics', 'budgets', 'wallets', 'cashflow', 'breakdown']);
  assert.equal(byId(out).recent.w, 6);
  assert.equal(byId(out).budgets.tall, true);
  assert.equal(out.cards.length, 7);
});

/* ---- Settle: compaction and push-down ---- */

test('settle: gaps close upwards (compaction is always on)', () => {
  const out = settle([
    { id: 'a', x: 0, y: 5, w: 6, h: 2 },
    { id: 'b', x: 6, y: 20, w: 6, h: 3 },
    { id: 'c', x: 0, y: 30, w: 12, h: 1 },
  ]);
  assert.deepEqual(out.map((card) => card.y), [0, 0, 3]);
});

test('settle: a card does not pass through another on its way up', () => {
  const out = settle([
    { id: 'wide', x: 0, y: 0, w: 12, h: 2 },
    { id: 'under', x: 4, y: 9, w: 4, h: 2 },
  ]);
  assert.equal(out[1].y, 2);
});

test('settle: hidden cards keep their place and take no room', () => {
  const out = settle([
    { id: 'gone', x: 0, y: 0, w: 12, h: 4, hidden: true },
    { id: 'b', x: 0, y: 4, w: 12, h: 2 },
  ]);
  assert.deepEqual([out[0].y, out[1].y], [0, 0]);
});

test('settle: a collapsed card takes one row', () => {
  const out = settle([
    { id: 'a', x: 0, y: 0, w: 12, h: 9, collapsed: true },
    { id: 'b', x: 0, y: 9, w: 12, h: 2 },
  ]);
  assert.equal(out[1].y, 1);
  assert.equal(out[0].h, 9, 'height kept for Expand');
});

/* ---- Moving ---- */

test('move: dropping onto a card pushes it down', () => {
  const out = moveGridCard(placedHome(), 'analytics', 0, 0);
  const cards = byId(out);
  assert.deepEqual([cards.analytics.x, cards.analytics.y], [0, 0]);
  assert.equal(cards.budgets.y, 3);
  assert.equal(cards.wallets.y, 3);
  assertSettled(out);
});

test('move: dragging a card down past another swaps them', () => {
  const out = moveGridCard(placedHome(), 'budgets', 0, 10);
  const cards = byId(out);
  /* Cash flow moves up under Wallets (still top right); Budget goes below it. */
  assert.equal(cards.cashflow.y, 7);
  assert.equal(cards.budgets.y, 16);
  assertSettled(out);
});

test('move: dropped into empty space below, the card floats back up', () => {
  const out = moveGridCard(placedHome(), 'wallets', 8, 2);
  assert.equal(byId(out).wallets.y, 0);
  assertSettled(out);
});

test('move: kept inside the grid', () => {
  const out = moveGridCard(placedHome(), 'wallets', 11, 0);
  assert.equal(byId(out).wallets.x, 8);
});

test('move: side by side, a narrow card slots in next to another', () => {
  const start = resizeGridCard(placedHome(), HOME_CARDS, 'cashflow', 6, 9);
  const out = moveGridCard(start, 'breakdown', 6, 9);
  const cards = byId(out);
  /* Beside the narrower chart, just under Budget (whose columns it shares). */
  assert.deepEqual([cards.breakdown.x, cards.breakdown.y], [6, 9]);
  assert.equal(cards.cashflow.y, 9);
  assertSettled(out);
});

test('move: hidden or unknown cards are left alone', () => {
  const start = setGridCardFlags(placedHome(), 'wallets', { hidden: true });
  assert.equal(moveGridCard(start, 'wallets', 0, 0), start);
  assert.equal(moveGridCard(start, 'nope', 0, 0), start);
});

/* ---- Resizing ---- */

test('resize: growing pushes neighbours down; limits hold', () => {
  const out = resizeGridCard(placedHome(), HOME_CARDS, 'budgets', 12, 10);
  const cards = byId(out);
  assert.deepEqual([cards.budgets.w, cards.budgets.h], [12, 10]);
  assert.equal(cards.wallets.y, 10);
  assertSettled(out);

  const tiny = byId(resizeGridCard(placedHome(), HOME_CARDS, 'budgets', 1, 1)).budgets;
  assert.deepEqual([tiny.w, tiny.h], [4, 5]);
  const huge = byId(resizeGridCard(placedHome(), HOME_CARDS, 'analytics', 20, 20)).analytics;
  assert.deepEqual([huge.w, huge.h], [12, 3]);
});

test('resize: shrinking lets the cards below float up', () => {
  const out = resizeGridCard(placedHome(), HOME_CARDS, 'cashflow', 12, 8);
  assert.equal(byId(out).breakdown.y, 17);
  assertSettled(out);
});

test('resize: widening at the right edge moves the card left to stay inside', () => {
  const out = resizeGridCard(placedHome(), HOME_CARDS, 'wallets', 6, 7);
  const wallets = byId(out).wallets;
  assert.equal(wallets.x + wallets.w <= 12, true);
  assertSettled(out);
});

/* ---- Collapse, hide, show ---- */

test('collapse and expand: one row while collapsed, the old height back after', () => {
  const collapsed = setGridCardFlags(placedHome(), 'cashflow', { collapsed: true });
  assert.equal(byId(collapsed).breakdown.y, 10);
  assertSettled(collapsed);
  const expanded = setGridCardFlags(collapsed, 'cashflow', { collapsed: false });
  assert.equal(byId(expanded).cashflow.h, 9);
  assert.equal(byId(expanded).breakdown.y, 18);
  assertSettled(expanded);
});

test('hide, then show at the first free spot or at a drop point', () => {
  const hidden = setGridCardFlags(placedHome(), 'wallets', { hidden: true });
  assertSettled(hidden);
  const back = byId(showGridCard(hidden, HOME_CARDS, 'wallets')).wallets;
  assert.deepEqual([back.x, back.y, back.w, back.h, back.hidden], [8, 0, 4, 7, undefined]);

  const dropped = showGridCard(hidden, HOME_CARDS, 'wallets', { x: 0, y: 0 });
  assert.deepEqual([byId(dropped).wallets.x, byId(dropped).wallets.y], [0, 0]);
  assert.equal(byId(dropped).budgets.y, 7);
  assertSettled(dropped);
});

test('show: a card comes back at the size it had when hidden, or a size asked for', async () => {
  const { showSize } = await import('../src/lib/layout/gridModel.ts');
  const wallets = HOME_CARDS.find((def) => def.id === 'wallets');
  const small = resizeGridCard(placedHome(), HOME_CARDS, 'wallets', 3, 5);
  const hidden = setGridCardFlags(small, 'wallets', { hidden: true });
  assert.deepEqual(showSize(byId(hidden).wallets, wallets), { w: 3, h: 5 });
  const back = byId(showGridCard(hidden, HOME_CARDS, 'wallets')).wallets;
  assert.deepEqual([back.w, back.h], [3, 5]);
  /* Never placed (a first-format card): its default. */
  assert.deepEqual(showSize({ id: 'wallets', w: 4, hidden: true }, wallets), { w: 4, h: wallets.defaultH });
  /* Wider when the screen needs it. */
  const wide = byId(showGridCard(hidden, HOME_CARDS, 'wallets', undefined, { w: 4, h: 5 })).wallets;
  assert.deepEqual([wide.w, wide.h], [4, 5]);
  assertSettled(showGridCard(hidden, HOME_CARDS, 'wallets', { x: 9, y: 3 }));
});

test('first free spot: top-most, then left-most', () => {
  const cards = [{ id: 'a', x: 0, y: 0, w: 8, h: 4 }];
  assert.deepEqual(firstFreeSpot(cards, 4, 4), { x: 8, y: 0 });
  assert.deepEqual(firstFreeSpot(cards, 6, 2), { x: 0, y: 4 });
  assert.deepEqual(firstFreeSpot([], 12, 3), { x: 0, y: 0 });
});

/* ---- Narrow screens ---- */

test('narrow screens: too-narrow cards widen and the rest reflows; 1920 untouched', () => {
  const start = resizeGridCard(placedHome(), HOME_CARDS, 'wallets', 3, 7); // 3 columns
  /* 1920px: the page is 1604 wide; three columns are ~383px, wide enough. */
  assert.equal(fitGridToWidth(start, HOME_CARDS, 1604, 24), start);
  /* 1000px: 684 wide; three columns are ~153px, under Wallets' 200. */
  const narrow = fitGridToWidth(start, HOME_CARDS, 684, 24);
  assert.equal(byId(narrow).wallets.w, minColumnsFor(200, 684, 24));
  assert.ok(byId(narrow).wallets.w > 3);
  assertSettled(narrow);
  /* Flow layouts are left to the first version's own rule. */
  const flow = defaultGridLayout(HOME_CARDS);
  assert.equal(fitGridToWidth(flow, HOME_CARDS, 684, 24), flow);
});

test('minColumnsFor: fewest columns that are wide enough', () => {
  assert.equal(minColumnsFor(200, 684, 24), 4);
  assert.equal(minColumnsFor(200, 1604, 24), 2);
  assert.equal(minColumnsFor(5000, 684, 24), 12);
});

/* ---- Flow → placed (first edit) ---- */

test('rows from pixels: nearest whole row of 40px with the gap', () => {
  assert.equal(rowsForPixels(565, 24), 9);
  assert.equal(rowsForPixels(440, 24), 7);
  assert.equal(rowsForPixels(168, 24), 3);
  assert.equal(rowsForPixels(10, 24), 1);
});

test('place flow: cards where the flow put them, heights from what is on screen', () => {
  const heights = { budgets: 565, wallets: 440, cashflow: 572, breakdown: 419, recent: 609, inbox: 168, analytics: 170 };
  const spans = { budgets: 8, wallets: 4, cashflow: 12, breakdown: 6, recent: 6, inbox: 12, analytics: 12 };
  const out = placeFlowLayout(defaultGridLayout(HOME_CARDS), HOME_CARDS, spans, heights, 24);
  assert.equal(isPlaced(out), true);
  const cards = byId(out);
  assert.deepEqual([cards.budgets.x, cards.budgets.y, cards.budgets.w, cards.budgets.h], [0, 0, 8, 9]);
  assert.deepEqual([cards.wallets.x, cards.wallets.y, cards.wallets.h], [8, 0, 7]);
  assert.deepEqual([cards.cashflow.y, cards.cashflow.h], [9, 9]);
  assert.deepEqual([cards.breakdown.x, cards.breakdown.y], [0, 18]);
  assert.deepEqual([cards.recent.x, cards.recent.y, cards.recent.h], [6, 18, 10]);
  assert.deepEqual([cards.inbox.y, cards.analytics.y], [28, 31]);
  assertSettled(out);
});

test('place flow: collapsed and hidden cards keep a usable height for later', () => {
  const flow = migrateV1(
    sanitizeLayout({ v: 1, updatedAt: 1, cards: [{ id: 'cashflow', w: 12, collapsed: true }, { id: 'wallets', w: 4, hidden: true }] }, HOME_CARDS),
  );
  const out = byId(placeFlowLayout(flow, HOME_CARDS, {}, { cashflow: 59 }, 24));
  assert.equal(out.cashflow.h, 9);
  assert.equal(out.cashflow.collapsed, true);
  assert.equal(out.wallets.hidden, true);
  assert.equal(out.wallets.h, 7);
});

/* ---- Drawing helpers ---- */

test('grid area: 1-based CSS lines, a collapsed card one row', async () => {
  const { gridArea } = await import('../src/lib/layout/gridModel.ts');
  assert.deepEqual(gridArea({ id: 'a', x: 0, y: 0, w: 8, h: 9 }), { gridColumn: '1 / span 8', gridRow: '1 / span 9' });
  assert.deepEqual(gridArea({ id: 'a', x: 8, y: 9, w: 4, h: 7, collapsed: true }), { gridColumn: '9 / span 4', gridRow: '10 / span 1' });
});

test('reading order: top to bottom, left to right, hidden left out', async () => {
  const { readingOrder } = await import('../src/lib/layout/gridModel.ts');
  const order = readingOrder([
    { id: 'c', x: 0, y: 9, w: 12, h: 2 },
    { id: 'b', x: 8, y: 0, w: 4, h: 2 },
    { id: 'gone', x: 0, y: 0, w: 4, h: 2, hidden: true },
    { id: 'a', x: 0, y: 0, w: 8, h: 9 },
  ]);
  assert.deepEqual(order.map((card) => card.id), ['a', 'b', 'c']);
});

test('same placement: positions, sizes and flags compared', async () => {
  const { samePlacement } = await import('../src/lib/layout/gridModel.ts');
  const a = placedHome();
  assert.equal(samePlacement(a, placedHome()), true);
  assert.equal(samePlacement(a, moveGridCard(a, 'analytics', 0, 0)), false);
  assert.equal(samePlacement(a, setGridCardFlags(a, 'inbox', { collapsed: true })), false);
});
