import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

import { groupWalletsByKind, walletGroupKind } from '../src/lib/walletKinds.ts';

const w = (id, kind, type = 'CASH') => ({ id, kind, type });
const shape = (groups) => groups.map((g) => `${g.kind}:${g.items.map((i) => i.id).join(',')}`);

test('spending groups follow the form order and skip empty kinds', () => {
  const wallets = [w('a', 'other'), w('b', 'credit', 'CREDIT'), w('c', 'cash'), w('d', 'bank'), w('e', 'cash')];
  assert.deepEqual(shape(groupWalletsByKind(wallets, 'expense')), ['cash:c,e', 'bank:d', 'credit:b', 'other:a']);
});

test('wallet order inside a group is kept', () => {
  const wallets = [w('z', 'bank'), w('a', 'bank'), w('m', 'bank')];
  assert.deepEqual(shape(groupWalletsByKind(wallets, 'expense')), ['bank:z,a,m']);
});

test('investing groups: brokerage, then other', () => {
  const wallets = [w('o', 'other'), w('b1', 'brokerage'), w('b2', 'brokerage')];
  assert.deepEqual(shape(groupWalletsByKind(wallets, 'investment')), ['brokerage:b1,b2', 'other:o']);
});

test('a kind not offered for the mode keeps its own group, after the listed ones', () => {
  const wallets = [w('c', 'cash'), w('b', 'brokerage')];
  assert.deepEqual(shape(groupWalletsByKind(wallets, 'investment')), ['brokerage:b', 'cash:c']);
  assert.deepEqual(shape(groupWalletsByKind([w('x', 'brokerage'), w('y', 'cash')], 'expense')), ['cash:y', 'brokerage:x']);
});

test('a CREDIT wallet is a credit card whatever its kind says; an unknown kind is other', () => {
  assert.equal(walletGroupKind(w('a', 'bank', 'CREDIT')), 'credit');
  assert.equal(walletGroupKind(w('b', 'crypto')), 'other');
  assert.deepEqual(groupWalletsByKind([], 'expense'), []);
});
