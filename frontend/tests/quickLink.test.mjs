import assert from 'node:assert/strict';
import { test } from 'node:test';

import { hasQuickLinkParams, parseQuickLink, resolveQuickLink, stripQuickLink } from '../src/lib/quickLink.ts';

test('parses the three types', () => {
  assert.deepEqual(parseQuickLink('?quick=expense'), { type: 'expense' });
  assert.deepEqual(parseQuickLink('quick=INCOME'), { type: 'income' });
  assert.deepEqual(parseQuickLink('?quick=transfer&wallet=a1&to=b2'), {
    type: 'transfer',
    walletId: 'a1',
    toWalletId: 'b2',
  });
});

test('ignores what it does not understand', () => {
  assert.equal(parseQuickLink(''), null);
  assert.equal(parseQuickLink('?quick=delete'), null);
  assert.equal(parseQuickLink('?wallet=a1'), null);
  // `to` only means something for a transfer, and never the same wallet.
  assert.deepEqual(parseQuickLink('?quick=expense&wallet=a1&to=b2'), { type: 'expense', walletId: 'a1' });
  assert.deepEqual(parseQuickLink('?quick=transfer&wallet=a1&to=a1'), { type: 'transfer', walletId: 'a1' });
  // Ids are uuids; markup or very long values are dropped.
  assert.deepEqual(parseQuickLink('?quick=expense&wallet=%3Cscript%3E'), { type: 'expense' });
  assert.deepEqual(parseQuickLink(`?quick=expense&wallet=${'a'.repeat(65)}`), { type: 'expense' });
});

test('strips only the quick-link parameters', () => {
  assert.equal(stripQuickLink('https://x.app/?quick=expense&wallet=a1#transactions'), '/#transactions');
  assert.equal(stripQuickLink('https://x.app/app/?ref=1&quick=income&to=b'), '/app/?ref=1');
  assert.equal(stripQuickLink('https://x.app/'), '/');
  assert.equal(hasQuickLinkParams('?ref=1'), false);
  assert.equal(hasQuickLinkParams('?ref=1&wallet=a'), true);
});

test('resolves against the real wallets', () => {
  const wallets = [
    { id: 'cash', mode: 'expense', archived: false },
    { id: 'broker', mode: 'investment', archived: false },
    { id: 'old', mode: 'expense', archived: true },
  ];
  assert.deepEqual(resolveQuickLink({ type: 'expense', walletId: 'cash' }, wallets), {
    type: 'expense',
    walletId: 'cash',
  });
  // Income and expense need a spending wallet; archived or unknown ones are dropped.
  assert.deepEqual(resolveQuickLink({ type: 'income', walletId: 'broker' }, wallets), { type: 'income' });
  assert.deepEqual(resolveQuickLink({ type: 'expense', walletId: 'old' }, wallets), { type: 'expense' });
  assert.deepEqual(resolveQuickLink({ type: 'expense', walletId: 'gone' }, wallets), { type: 'expense' });
  assert.deepEqual(resolveQuickLink({ type: 'transfer', walletId: 'cash', toWalletId: 'broker' }, wallets), {
    type: 'transfer',
    walletId: 'cash',
    toWalletId: 'broker',
  });
});
