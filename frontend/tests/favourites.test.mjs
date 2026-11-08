import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  FAVOURITES_SYNC_FORMAT,
  MAX_FAVOURITES,
  PREF_VALUE_MAX,
  applyUsage,
  autoStyle,
  draftFromTransaction,
  duplicateFavourite,
  emptyFavourites,
  favouritePayload,
  favouriteProblem,
  groupFavourites,
  moveFavourite,
  orderedFavourites,
  parseFavLink,
  placeFavourite,
  removeFavourite,
  sanitizeFavourites,
  serializeFavourites,
  upsertFavourite,
} = await import('../src/lib/favourites.ts');
const { isForeignPref } = await import('../src/lib/layout/layoutFormats.ts');

/* Made-up data only. */
let n = 0;
const ids = () => `f_test${String(++n).padStart(4, '0')}`;
const draft = (over = {}) => ({
  name: 'Coffee',
  emoji: '☕',
  color: 'accent',
  type: 'expense',
  walletId: 'w-cash',
  toWalletId: '',
  category: 'Food',
  note: '',
  amount: 65,
  ask: false,
  hideAmount: false,
  group: '',
  ...over,
});
const add = (list, over) => {
  const result = upsertFavourite(list, draft(over), ids);
  assert.equal(result.ok, true);
  return result.list;
};

test('round trip: stored in the layout envelope, marked with its kind', () => {
  let list = add(emptyFavourites(), {});
  list = add(list, { name: 'BTS', type: 'transfer', walletId: 'w-cash', toWalletId: 'w-bank', category: 'ignored', amount: null });
  const text = serializeFavourites({ ...list, updatedAt: 123 });
  const raw = JSON.parse(text);
  assert.equal(raw.v, 1);
  assert.deepEqual(raw.cards, []);
  assert.equal(raw.kind, 'favourites');
  assert.equal(raw.format, 1);
  const back = sanitizeFavourites(text);
  assert.equal(back.updatedAt, 123);
  assert.equal(back.favs.length, 2);
  assert.equal(back.favs[0].amount, 65);
  assert.equal(back.favs[1].amount, null);
  assert.equal(back.favs[1].category, '', 'a transfer has no category');
  assert.equal(back.favs[1].toWalletId, 'w-bank');
});

test('layouts ignore it, and it ignores layouts', () => {
  const text = serializeFavourites(add(emptyFavourites(), {}));
  assert.equal(isForeignPref(text), true);
  assert.equal(isForeignPref('{"v":1,"format":"order","cards":[]}'), false);
  assert.equal(isForeignPref(null), false);
  assert.equal(sanitizeFavourites('{"v":1,"format":"order","cards":[{"id":"wallets"}]}').favs.length, 0);
  assert.equal(sanitizeFavourites('not json').favs.length, 0);
  const remote = FAVOURITES_SYNC_FORMAT.fromRemote({ key: 'layout.favourites', value: text, updatedAt: 999 }, 'favourites');
  assert.equal(remote.updatedAt, 999);
  assert.equal(remote.favs.length, 1);
});

test('bad entries are dropped or cleaned, never thrown', () => {
  const list = sanitizeFavourites(
    JSON.stringify({
      v: 1,
      cards: [],
      kind: 'favourites',
      format: 1,
      favs: [
        { id: 'ok_1', n: 'Lunch', t: 'expense', w: 'w1', cat: 'Food', amt: -5, c: 'purple' },
        { id: 'ok_1', n: 'Duplicate id' },
        { id: 'bad id!', n: 'x' },
        { id: 'no_name', n: '   ' },
        { id: 'ok_2', n: 'x'.repeat(99), t: 'weird', w: '<script>' },
      ],
    }),
  );
  assert.deepEqual(list.favs.map((f) => f.id), ['ok_1', 'ok_2']);
  assert.equal(list.favs[0].amount, null, 'a negative amount means none');
  assert.equal(list.favs[0].color, 'accent', 'unknown colour falls back to a theme colour');
  assert.equal(list.favs[1].name.length, 40);
  assert.equal(list.favs[1].type, 'expense');
  assert.equal(list.favs[1].walletId, '');
});

test(`at most ${MAX_FAVOURITES}, and the longest list still fits the server limit`, () => {
  let list = emptyFavourites();
  for (let i = 0; i < MAX_FAVOURITES; i += 1) {
    list = add(list, {
      name: 'N'.repeat(40),
      note: 'ห'.repeat(120),
      group: 'G'.repeat(24),
      walletId: 'a'.repeat(36),
      toWalletId: 'b'.repeat(36),
      type: 'transfer',
      emoji: '👨‍👩‍👧',
      amount: 999999999.99,
      ask: true,
      hideAmount: true,
      color: 'warning',
    });
  }
  list = applyUsage(list, new Map(list.favs.map((f) => [f.id, { uses: 999999, day: '2026-11-08' }])));
  assert.ok(serializeFavourites({ ...list, updatedAt: Date.now() }).length <= PREF_VALUE_MAX);
  const full = upsertFavourite(list, draft(), ids);
  assert.deepEqual(full, { ok: false, reason: 'full' });
  assert.equal(duplicateFavourite(list, list.favs[0].id, '(copy)', ids).ok, false);
});

test('edit, duplicate, move, remove', () => {
  let list = add(add(add(emptyFavourites(), { name: 'A' }), { name: 'B' }), { name: 'C' });
  const [a, b, c] = list.favs;
  const edited = upsertFavourite(list, { ...a, name: 'A2', amount: 70 });
  assert.equal(edited.ok, true);
  list = edited.list;
  assert.equal(list.favs[0].name, 'A2');
  assert.equal(list.favs[0].id, a.id, 'edit keeps the id');
  assert.deepEqual(upsertFavourite(list, { ...a, id: 'f_gone' }), { ok: false, reason: 'missing' });

  const dup = duplicateFavourite(list, b.id, '(copy)', ids);
  assert.equal(dup.ok, true);
  assert.deepEqual(dup.list.favs.map((f) => f.name), ['A2', 'B', 'B (copy)', 'C']);
  assert.equal(dup.fav.uses, 0);

  assert.deepEqual(moveFavourite(list, c.id, -1).favs.map((f) => f.name), ['A2', 'C', 'B']);
  assert.equal(moveFavourite(list, a.id, -1), list, 'no move past the top');
  assert.deepEqual(placeFavourite(list, a.id, 99).favs.map((f) => f.name), ['B', 'C', 'A2']);
  assert.deepEqual(removeFavourite(list, b.id).favs.map((f) => f.name), ['A2', 'C']);
});

test('usage is batched, and can order the card', () => {
  let list = add(add(add(emptyFavourites(), { name: 'A' }), { name: 'B' }), { name: 'C' });
  const [a, b, c] = list.favs;
  list = applyUsage(list, new Map([[b.id, { uses: 3, day: '2026-11-07' }], [c.id, { uses: 3, day: '2026-11-08' }], ['f_gone', { uses: 9, day: '2026-11-08' }]]));
  assert.deepEqual(list.favs.map((f) => f.uses), [0, 3, 3]);
  assert.deepEqual(orderedFavourites(list).map((f) => f.name), ['A', 'B', 'C'], 'manual by default');
  assert.deepEqual(orderedFavourites({ ...list, sort: 'usage' }).map((f) => f.name), ['C', 'B', 'A']);
  assert.equal(applyUsage(list, new Map()), list);
  assert.equal(a.lastUsed, '');
});

test('groups: ungrouped first, then in first-appearance order', () => {
  let list = emptyFavourites();
  for (const [name, group] of [['Rent', 'Bills'], ['Coffee', ''], ['Lunch', 'Daily'], ['Power', 'Bills']]) list = add(list, { name, group });
  assert.deepEqual(
    groupFavourites(list.favs).map((g) => `${g.group}:${g.favs.map((f) => f.name).join(',')}`),
    [':Coffee', 'Bills:Rent,Power', 'Daily:Lunch'],
  );
});

test('the transaction it adds, and what stops it', () => {
  const list = add(emptyFavourites(), { note: 'Morning' });
  const fav = list.favs[0];
  assert.deepEqual(favouritePayload(fav, 65, '2026-11-08'), {
    walletId: 'w-cash', toWalletId: '', type: 'expense', amount: 65, category: 'Food', note: 'Morning', date: '2026-11-08',
  });
  const wallets = [{ id: 'w-cash', mode: 'expense' }, { id: 'w-bank', mode: 'expense' }, { id: 'w-inv', mode: 'investment' }, { id: 'w-old', archived: true }];
  assert.equal(favouriteProblem(fav, wallets), null);
  assert.equal(favouriteProblem({ ...fav, walletId: 'w-old' }, wallets), 'wallet');
  assert.equal(favouriteProblem({ ...fav, walletId: 'w-inv' }, wallets), 'wallet', 'an expense never comes out of an investing wallet');
  assert.equal(favouriteProblem({ ...fav, category: '' }, wallets), 'category');
  assert.equal(favouriteProblem({ ...fav, type: 'transfer', walletId: 'w-inv', toWalletId: 'w-cash' }, wallets), null);
  assert.equal(favouriteProblem({ ...fav, type: 'transfer', toWalletId: 'w-gone' }, wallets), 'to');
});

test('drafts from a transaction, display style, deep link', () => {
  const d = draftFromTransaction({ type: 'expense', walletId: 'w1', category: 'Food', note: '', amount: 120 });
  assert.equal(d.name, 'Food');
  assert.equal(d.amount, 120);
  assert.equal(draftFromTransaction({ type: 'transfer', walletId: 'w1', toWalletId: 'w2', category: 'x' }).category, '');
  assert.equal(autoStyle(400, 120), 'chips');
  assert.equal(autoStyle(400, 300), 'tiles');
  assert.equal(autoStyle(400, 500), 'list');
  assert.equal(autoStyle(400, 0), 'tiles', 'unmeasured: tiles');
  assert.equal(parseFavLink('?fav=f_abc123'), 'f_abc123');
  assert.equal(parseFavLink('?fav=../x'), null);
  assert.equal(parseFavLink('?quick=expense'), null);
});
