import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  daySummary,
  groupByDay,
  groupState,
  pruneSelected,
  selectRange,
  sumTotals,
  toggleGroup,
  toggleSelected,
} = await import('../src/lib/txTotals.ts');

const tx = (id, date, type, amount) => ({ id, date, type, amount });

const ROWS = [
  tx('a', '2026-11-08', 'income', 1200),
  tx('b', '2026-11-08', 'expense', 350),
  tx('c', '2026-11-08', 'transfer', 500),
  tx('d', '2026-11-07', 'expense', 120.5),
  tx('e', '2026-11-07', 'expense', 79.5),
  tx('f', '2026-11-06', 'transfer', 40),
  tx('g', '2026-11-05', 'income', 300),
];

test('sumTotals: income and expense by type, transfers left out but counted', () => {
  assert.deepEqual(sumTotals(ROWS), { income: 1500, expense: 550, net: 950, count: 7, transfers: 2 });
  assert.deepEqual(sumTotals([]), { income: 0, expense: 0, net: 0, count: 0, transfers: 0 });
});

test('sumTotals: a string or broken amount counts as its number, or zero', () => {
  assert.equal(sumTotals([tx('x', 'd', 'expense', '12.5'), tx('y', 'd', 'expense', 'oops')]).expense, 12.5);
});

test('day totals add up to the header totals', () => {
  const groups = groupByDay(ROWS);
  const header = sumTotals(ROWS);
  const sum = (key) => groups.reduce((total, group) => total + group.totals[key], 0);
  assert.equal(sum('income'), header.income);
  assert.equal(sum('expense'), header.expense);
  assert.equal(sum('net'), header.net);
  assert.equal(sum('count'), header.count);
});

test('groupByDay keeps the list order and groups consecutive dates', () => {
  const groups = groupByDay(ROWS);
  assert.deepEqual(groups.map((g) => g.date), ['2026-11-08', '2026-11-07', '2026-11-06', '2026-11-05']);
  assert.deepEqual(groups[0].rows.map((r) => r.id), ['a', 'b', 'c']);
  assert.equal(new Set(groups.map((g) => g.key)).size, groups.length);
});

test('daySummary: both kinds, one kind shown once, transfers only, empty', () => {
  const [both, spent, moved, earned] = groupByDay(ROWS).map((g) => daySummary(g.totals));
  assert.deepEqual(both, { kind: 'full', income: 1200, expense: 350, net: 850 });
  assert.deepEqual(spent, { kind: 'expense', expense: 200 });
  assert.deepEqual(moved, { kind: 'transfers', transfers: 1 });
  assert.deepEqual(earned, { kind: 'income', income: 300 });
  assert.deepEqual(daySummary(sumTotals([])), { kind: 'empty' });
});

test('selection: toggle, and its totals use the same rules', () => {
  let selected = new Set();
  selected = toggleSelected(selected, 'a');
  selected = toggleSelected(selected, 'c');
  selected = toggleSelected(selected, 'd');
  assert.deepEqual([...selected].sort(), ['a', 'c', 'd']);
  const totals = sumTotals(ROWS.filter((r) => selected.has(r.id)));
  assert.deepEqual(totals, { income: 1200, expense: 120.5, net: 1079.5, count: 3, transfers: 1 });
  assert.deepEqual([...toggleSelected(selected, 'a')].sort(), ['c', 'd']);
});

test('selection: Shift range in screen order, either direction, on or off', () => {
  const order = ROWS.map((r) => r.id);
  assert.deepEqual([...selectRange(new Set(['b']), order, 'b', 'e')].sort(), ['b', 'c', 'd', 'e']);
  assert.deepEqual([...selectRange(new Set(), order, 'f', 'c')].sort(), ['c', 'd', 'e', 'f']);
  /* Shift on a selected row clears the range. */
  assert.deepEqual([...selectRange(new Set(['a', 'b', 'c', 'd']), order, 'a', 'c')], ['d']);
  /* No anchor in the list: a plain toggle. */
  assert.deepEqual([...selectRange(new Set(), order, 'gone', 'b')], ['b']);
});

test('selection: a whole day, its state, and pruning rows that left', () => {
  const day = ['a', 'b', 'c'];
  assert.equal(groupState(day, new Set()), 'none');
  assert.equal(groupState(day, new Set(['b'])), 'some');
  const all = toggleGroup(new Set(['b', 'g']), day);
  assert.equal(groupState(day, all), 'all');
  assert.deepEqual([...toggleGroup(all, day)], ['g']);
  const kept = new Set(['a', 'g']);
  assert.equal(pruneSelected(kept, new Set(['a', 'g', 'b'])), kept, 'unchanged keeps identity');
  assert.deepEqual([...pruneSelected(kept, new Set(['a']))], ['a']);
});
