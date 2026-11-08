import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  SAFE_SPEND_SYNC_FORMAT,
  computeSafeSpend,
  countedWallets,
  debtPaidThisMonth,
  defaultSafeSpendSettings,
  recentAverages,
  sanitizeSafeSpendSettings,
  serializeSafeSpendSettings,
} = await import('../src/lib/safeSpend.ts');
const { safeToSpend } = await import('../src/lib/creditMath.ts');
const { isForeignPref } = await import('../src/lib/layout/layoutFormats.ts');

/* ---- Fixtures (made-up) ---- */

const wallet = (id, balance, extra = {}) => ({
  id, name: id, mode: 'expense', kind: 'bank', type: 'CASH', archived: false, balance,
  investedCost: 0, income: 0, expense: 0, transactionCount: 0, ...extra,
});
const card = (id, balance) => wallet(id, balance, { kind: 'credit', type: 'CREDIT' });
const sub = (id, name, amount, nextDueDate, extra = {}) => ({ id, name, amount, walletId: '', frequency: 'monthly', nextDueDate, ...extra });
const debt = (id, title, minimumPayment, dueDate, extra = {}) => ({ id, title, minimumPayment, dueDate, currentBalance: 100000, settled: false, ...extra });
const tx = (id, type, amount, date, extra = {}) => ({ id, type, amount, date, walletId: 'kbank', toWalletId: '', note: '', category: '', installmentGroupId: '', ...extra });
const goal = (id, savedAmount, extra = {}) => ({ id, title: id, savedAmount, targetAmount: 100000, deadline: '', purchased: false, ...extra });

function input(over = {}) {
  return {
    period: '2026-11',
    today: '2026-11-12',
    wallets: [wallet('cash', 3120), wallet('kbank', 84250.75), wallet('tmn', 860), card('visa', -10000), card('amex', -5680.5)],
    goals: [goal('japan', 20000)],
    subscriptions: [sub('n', 'Netflix', 419, '2026-11-15'), sub('i', 'Internet', 599, '2026-11-20')],
    debts: [debt('car', 'Car loan', 8500, 25)],
    transactions: [],
    budgets: [],
    trend: [
      { period: '2026-08', income: 60000, expense: 31000 },
      { period: '2026-09', income: 60000, expense: 30000 },
      { period: '2026-10', income: 63000, expense: 31000 },
      { period: '2026-11', income: 60000, expense: 12000 },
    ],
    paydays: [25],
    settings: defaultSafeSpendSettings(),
    monthIncome: 60000,
    monthExpense: 12000,
    historical: null,
    ...over,
  };
}

const line = (result, key) => result.lines.find((l) => l.key === key);
const noteKeys = (result) => result.notes.map((n) => n.key);

/* ---- The worked example ---- */

test('the worked example: balance-based, goals subtracted, bills from today', () => {
  const r = computeSafeSpend(input());
  assert.equal(r.mode, 'live');
  assert.equal(line(r, 'cash').amount, 88230.75);
  assert.equal(line(r, 'cardDebt').amount, -15680.5);
  assert.equal(line(r, 'goals').amount, -20000);
  assert.equal(line(r, 'bills').amount, -9518);
  assert.deepEqual(r.bills.map((b) => [b.name, b.date]), [
    ['Netflix', '2026-11-15'],
    ['Internet', '2026-11-20'],
    ['Car loan', '2026-11-25'],
  ]);
  assert.equal(r.left, 43032.25);
  assert.equal(r.daysLeft, 19);
  assert.equal(r.perDay, Math.round((43032.25 / 19) * 100) / 100);
  assert.equal(r.state, 'ok');
});

test('starts from the same number as the hero (creditMath.safeToSpend)', () => {
  const settings = { ...defaultSafeSpendSettings(), goals: false };
  const data = input({ subscriptions: [], debts: [], settings });
  const r = computeSafeSpend(data);
  assert.equal(r.left, safeToSpend(data.wallets));
  assert.ok(noteKeys(r).includes('goalsOff'));
});

/* ---- Per day and today ---- */

test("today's figure is today's share less what today has spent", () => {
  const r = computeSafeSpend(input({ transactions: [tx('a', 'expense', 350, '2026-11-12')] }));
  assert.equal(r.spentToday, 350);
  assert.equal(r.todayLeft, Math.round(((r.left + 350) / 19 - 350) * 100) / 100);
});

test('first and last day of the month', () => {
  const first = computeSafeSpend(input({ today: '2026-11-01', subscriptions: [], debts: [] }));
  assert.equal(first.daysLeft, 30);
  const last = computeSafeSpend(input({ today: '2026-11-30', subscriptions: [], debts: [] }));
  assert.equal(last.daysLeft, 1);
  assert.equal(last.perDay, last.left);
});

test('over: a negative result is kept and marked over', () => {
  const r = computeSafeSpend(input({ wallets: [wallet('kbank', 1000), card('visa', -5000)], goals: [] }));
  assert.ok(r.left < 0);
  assert.equal(r.state, 'over');
});

test('tight: per day below the recent average daily spend', () => {
  // Average spend ≈ 92,000 / 92 days = 1,000/day.
  const r = computeSafeSpend(input({ wallets: [wallet('kbank', 10000)], goals: [], subscriptions: [], debts: [] }));
  assert.equal(r.avgDailySpend, 1000);
  assert.ok(r.perDay < 1000);
  assert.equal(r.state, 'tight');
});

/* ---- No double counts ---- */

test('card statement bills are never a bill line: card debt already covers them', () => {
  const r = computeSafeSpend(input());
  assert.ok(r.bills.every((b) => b.kind !== 'card'));
  assert.ok(noteKeys(r).includes('cardBills'));
});

test('installment chunks are neither a bill nor spending this month', () => {
  const chunk = tx('c', 'expense', 2500, '2026-11-05', { installmentGroupId: 'g1', installmentIndex: '2/6', walletId: 'visa' });
  const r = computeSafeSpend(input({ transactions: [chunk, tx('x', 'expense', 100, '2026-11-05')] }));
  assert.equal(r.spentSoFar, 100);
  assert.equal(r.billsTotal, 9518);
  assert.ok(noteKeys(r).includes('installments'));
});

test('a recurring bill paid with Pay has moved on and is not counted', () => {
  // Paid on the 15th: nextDueDate is now in December.
  const r = computeSafeSpend(input({ subscriptions: [sub('n', 'Netflix', 419, '2026-12-15')] }));
  assert.ok(!r.bills.some((b) => b.name === 'Netflix'));
});

test('an unpaid bill from earlier this month still counts, marked overdue', () => {
  const r = computeSafeSpend(input({ subscriptions: [sub('n', 'Netflix', 419, '2026-11-03')] }));
  const bill = r.bills.find((b) => b.name === 'Netflix');
  assert.equal(bill.overdue, true);
});

test('debts: only from today on, and not when paid this month', () => {
  const early = computeSafeSpend(input({ debts: [debt('car', 'Car loan', 8500, 5)] }));
  assert.ok(!early.bills.some((b) => b.kind === 'debt'), 'due day already passed');

  const paid = input({ transactions: [tx('p', 'expense', 8500, '2026-11-10', { note: 'Car loan' })] });
  assert.equal(debtPaidThisMonth(paid.debts[0], paid.transactions, '2026-11'), true);
  const r = computeSafeSpend(paid);
  assert.ok(!r.bills.some((b) => b.kind === 'debt'));
  assert.ok(noteKeys(r).includes('debtsPaid'));

  const settled = computeSafeSpend(input({ debts: [debt('car', 'Car loan', 8500, 25, { settled: true })] }));
  assert.ok(!settled.bills.some((b) => b.kind === 'debt'));
});

test('goal plan: off by default; when on, subtracted and flagged as a possible overlap', () => {
  const goals = [goal('japan', 20000, { targetAmount: 50000, deadline: '2027-05-31' })];
  const off = computeSafeSpend(input({ goals }));
  assert.equal(line(off, 'goalPlan'), undefined);

  const on = computeSafeSpend(input({ goals, settings: { ...defaultSafeSpendSettings(), goalPlan: true } }));
  const plan = line(on, 'goalPlan');
  assert.equal(plan.amount, -5000); // 30,000 over 6 months
  assert.equal(plan.estimate, true);
  assert.ok(noteKeys(on).includes('goalPlanOverlap'));
  assert.equal(on.left, Math.round((off.left - 5000) * 100) / 100);
});

test('purchased goals reserve nothing', () => {
  const r = computeSafeSpend(input({ goals: [goal('done', 30000, { purchased: true })] }));
  assert.equal(line(r, 'goals'), undefined);
});

/* ---- Budgets, income ---- */

test('budgets are shown separately by default, subtracted only when asked', () => {
  const budgets = [
    { category: 'Food', limit: 8000, remaining: 3000 },
    { category: 'Fun', limit: 2000, remaining: -500 },
  ];
  const shown = computeSafeSpend(input({ budgets }));
  assert.equal(shown.budgetsUnspent, 3000);
  assert.equal(line(shown, 'budgets'), undefined);
  assert.ok(noteKeys(shown).includes('budgetsSeparate'));

  const counted = computeSafeSpend(input({ budgets, settings: { ...defaultSafeSpendSettings(), budgets: true } }));
  assert.equal(line(counted, 'budgets').amount, -3000);
  assert.equal(counted.left, Math.round((shown.left - 3000) * 100) / 100);
});

test('expected income: an estimate, only with a payday still ahead', () => {
  const settings = { ...defaultSafeSpendSettings(), expectedIncome: true };
  // No income yet this month, payday on the 25th: average (61,000) comes in.
  const r = computeSafeSpend(input({ settings, monthIncome: 0 }));
  assert.equal(line(r, 'expectedIncome').amount, 61000);
  assert.equal(line(r, 'expectedIncome').estimate, true);

  const after = computeSafeSpend(input({ settings, today: '2026-11-26', monthIncome: 0 }));
  assert.equal(line(after, 'expectedIncome'), undefined);
  assert.ok(noteKeys(after).includes('expectedNone'));
});

test('recent averages use the three months before the period', () => {
  const avg = recentAverages(input().trend, '2026-11');
  assert.equal(avg.months, 3);
  assert.equal(avg.income, 61000);
  assert.equal(avg.dailySpend, 1000);
  assert.deepEqual(recentAverages([], '2026-11'), { income: 0, dailySpend: 0, months: 0 });
});

/* ---- Wallets, transfers ---- */

test('counted wallets: spending only, not archived, not excluded', () => {
  const wallets = [
    wallet('a', 1), wallet('b', 2, { archived: true }), wallet('inv', 3, { mode: 'investment' }), wallet('c', 4),
  ];
  const settings = { ...defaultSafeSpendSettings(), excluded: ['c'] };
  assert.deepEqual(countedWallets(wallets, settings).map((w) => w.id), ['a']);
});

test('transfers are ignored; money moved to investing is reported', () => {
  const wallets = [...input().wallets, wallet('broker', 50000, { mode: 'investment' })];
  const transactions = [
    tx('t1', 'transfer', 5000, '2026-11-03', { toWalletId: 'cash' }),
    tx('t2', 'transfer', 7000, '2026-11-04', { toWalletId: 'broker' }),
  ];
  const r = computeSafeSpend(input({ wallets, transactions }));
  assert.equal(r.spentSoFar, 0);
  assert.equal(r.movedToInvesting, 7000);
  assert.ok(r.notes.some((n) => n.key === 'investing' && n.amount === 7000));
});

test('bills paid from a wallet that does not count are left out, with a note', () => {
  const settings = { ...defaultSafeSpendSettings(), excluded: ['tmn'] };
  const r = computeSafeSpend(input({ settings, subscriptions: [sub('n', 'Netflix', 419, '2026-11-15', { walletId: 'tmn' })] }));
  assert.ok(!r.bills.some((b) => b.name === 'Netflix'));
  assert.ok(noteKeys(r).includes('billsOtherWallets'));
  assert.ok(noteKeys(r).includes('excludedWallets'));
});

/* ---- Month pill ---- */

test('past month: what was left at month end, no bills, average per day', () => {
  const historical = { asOf: '2026-09-30', cashBalance: 70000, creditDebt: 12000, netWorth: 0, liquidBalance: 0, investedCost: 0, investmentCash: 0 };
  const r = computeSafeSpend(input({ period: '2026-09', historical, monthExpense: 30000 }));
  assert.equal(r.mode, 'past');
  assert.equal(r.left, 58000);
  assert.equal(r.perDay, null);
  assert.equal(r.pastPerDay, 1000);
  assert.deepEqual(r.bills, []);

  const old = computeSafeSpend(input({ period: '2026-09', historical: null }));
  assert.equal(old.left, null);
  assert.ok(noteKeys(old).includes('pastUnavailable'));
});

test('future month: average income less that month\'s bills, as an estimate', () => {
  const r = computeSafeSpend(input({ period: '2026-12' }));
  assert.equal(r.mode, 'future');
  assert.equal(line(r, 'avgIncome').amount, 61000);
  // Netflix 15 Dec, Internet 20 Dec, Car loan 25 Dec.
  assert.equal(r.billsTotal, 9518);
  assert.equal(r.left, 61000 - 9518);
  assert.equal(r.daysLeft, 31);
  assert.ok(noteKeys(r).includes('futureEstimate'));
});

/* ---- Settings storage ---- */

test('settings: defaults, sanitising, round trip through the layout envelope', () => {
  const d = defaultSafeSpendSettings();
  assert.equal(d.goals, true);
  assert.equal(d.goalPlan, false);
  assert.equal(d.expectedIncome, false);
  assert.equal(d.budgets, false);

  const saved = { ...d, excluded: ['a', 'a', '', 5, 'b'], goalPlan: true, updatedAt: 42 };
  const text = serializeSafeSpendSettings(saved);
  const envelope = JSON.parse(text);
  assert.equal(envelope.v, 1);
  assert.deepEqual(envelope.cards, []);
  assert.equal(envelope.kind, 'safe-spend');
  assert.equal(envelope.format, 1);
  assert.ok(isForeignPref(text), 'layout readers must ignore it');

  const back = sanitizeSafeSpendSettings(text);
  assert.deepEqual(back.excluded, ['a', 'b']);
  assert.equal(back.goalPlan, true);
  assert.equal(back.updatedAt, 42);

  assert.deepEqual(sanitizeSafeSpendSettings('{"v":1,"cards":[]}'), d, 'a plain layout is not settings');
  assert.deepEqual(sanitizeSafeSpendSettings('nope'), d);
  const remote = SAFE_SPEND_SYNC_FORMAT.fromRemote({ value: text, updatedAt: 99 });
  assert.equal(remote.updatedAt, 99);
});
