import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const { continueRecent, compareRecent, SERVER_RECENT_COUNT } = await import('../src/lib/layout/recentRows.ts');

/** Made-up rows, newest first: one a day, going back from 2026-11-30. */
function rows(count, from = 0) {
  const out = [];
  for (let i = from; i < from + count; i += 1) {
    const d = new Date(Date.UTC(2026, 10, 30 - i));
    const date = d.toISOString().slice(0, 10);
    out.push({ id: `t${i}`, date, createdAt: `${date}T09:00:00.000Z`, amount: i });
  }
  return out;
}

test('continues after the server’s eight in the server’s own order', () => {
  const all = rows(20);
  const recent = all.slice(0, SERVER_RECENT_COUNT);
  /* History arrives in any order; it is sorted the server's way. */
  const history = all.slice().reverse();
  const out = continueRecent(recent, history, '2026-11-30');
  assert.deepEqual(out.map((r) => r.id), all.map((r) => r.id));
  assert.deepEqual(out.slice().sort(compareRecent).map((r) => r.id), out.map((r) => r.id));
});

test('never repeats a row, even when the history also holds the eight', () => {
  const all = rows(12);
  const out = continueRecent(all.slice(0, 8), all, '2026-11-30');
  assert.equal(new Set(out.map((r) => r.id)).size, out.length);
  assert.equal(out.length, 12);
});

test('rows newer than the eighth that the eight do not have are not slipped in', () => {
  const all = rows(12);
  /* A transaction added after the dashboard loaded: in the history only. */
  const fresh = { id: 'new', date: '2026-12-01', createdAt: '2026-12-01T10:00:00.000Z' };
  const out = continueRecent(all.slice(0, 8), [fresh, ...all], '2026-12-31');
  assert.ok(!out.some((r) => r.id === 'new'));
  assert.equal(out.length, 12);
});

test('fewer than eight from the server: nothing more exists', () => {
  const all = rows(5);
  assert.equal(continueRecent(all, rows(30), '2026-11-30').length, 5);
});

test('history still loading: the eight only', () => {
  const all = rows(8);
  assert.equal(continueRecent(all, null, '2026-11-30').length, 8);
});

test('a past month on screen whose window ends before the eighth: the eight only', () => {
  const all = rows(20);
  assert.equal(continueRecent(all.slice(0, 8), all.slice(10), '2026-11-15').length, 8);
});

test('the same timestamp as the eighth: kept, after the eight', () => {
  const all = rows(8);
  const twin = { id: 'twin', date: all[7].date, createdAt: all[7].createdAt };
  const out = continueRecent(all, [...all, twin, ...rows(3, 8)], '2026-11-30');
  assert.equal(out[8].id, 'twin');
  assert.deepEqual(out.slice(9).map((r) => r.id), ['t8', 't9', 't10']);
});

test('capped well above what the tallest card shows', () => {
  const all = rows(300);
  assert.equal(continueRecent(all.slice(0, 8), all, '2026-11-30').length, 40);
});
