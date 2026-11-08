import './support/register.mjs';

import assert from 'node:assert/strict';
import { test } from 'node:test';

const {
  averageBefore,
  biggestExpenses,
  budgetRows,
  buildMonthReview,
  compareCategories,
  figures,
  noSpendDays,
  parseReviewPeriod,
  reviewMarkdown,
  reviewStatus,
  shiftMonth,
} = await import('../src/lib/monthReview.ts');

/* ---- Fixtures (made-up) ---- */

const tx = (id, type, amount, date, extra = {}) => ({ id, type, amount, date, walletId: 'w1', toWalletId: '', note: '', category: 'Food', installmentGroupId: '', ...extra });
const trend = [
  { period: '2026-07', income: 40000, expense: 30000, net: 10000 },
  { period: '2026-08', income: 42000, expense: 31000, net: 11000 },
  { period: '2026-09', income: 41000, expense: 31160, net: 9840 },
  { period: '2026-10', income: 43500, expense: 30015, net: 13485 },
];
function summary(over = {}) {
  return {
    period: '2026-10', monthIncome: 43500, monthExpense: 30015, trend,
    categoryBreakdown: [{ category: 'Food', amount: 7770 }, { category: 'Transport', amount: 3420 }, { category: 'Fun', amount: 500 }],
    budgets: [
      { targetLabel: 'Food', targetId: 'Food', limit: 8000, spent: 7770, remaining: 230 },
      { targetLabel: 'Transport', targetId: 'Transport', limit: 3000, spent: 3420, remaining: -420 },
      { targetLabel: 'Unset', targetId: 'x', limit: 0, spent: 10, remaining: 0 },
    ],
    historical: { asOf: '2026-10-31', cashBalance: 70000, creditDebt: 9800, netWorth: 0, liquidBalance: 0, investedCost: 0, investmentCash: 0 },
    ...over,
  };
}
const previous = { period: '2026-09', monthIncome: 41000, monthExpense: 31160, trend, categoryBreakdown: [{ category: 'Food', amount: 5630 }, { category: 'Transport', amount: 4030 }, { category: 'Gifts', amount: 900 }] };

function input(over = {}) {
  return {
    period: '2026-10',
    today: '2026-11-08',
    summary: summary(),
    previousSummary: previous,
    transactions: [
      tx('a', 'expense', 1890, '2026-10-12', { note: 'Headphones', walletId: 'card' }),
      tx('b', 'expense', 120, '2026-10-02'),
      tx('c', 'expense', 3333.34, '2026-10-01', { installmentGroupId: 'g', note: 'Phone 1/3' }),
      tx('d', 'income', 43500, '2026-10-25'),
      tx('e', 'transfer', 5000, '2026-10-05'),
      tx('f', 'expense', 99999, '2026-09-30'),
    ],
    subscriptions: [
      { id: 's1', name: 'Gym', amount: 900, frequency: 'monthly', createdAt: '2026-10-03T10:00:00Z' },
      { id: 's2', name: 'Netflix', amount: 419, frequency: 'monthly', createdAt: '2026-01-01T00:00:00Z' },
    ],
    goals: [
      { id: 'g1', title: 'Laptop', targetAmount: 45000, savedAmount: 45000, purchased: true, purchasedAt: '2026-10-20T08:00:00Z', deadline: '' },
      { id: 'g2', title: 'Japan', targetAmount: 60000, savedAmount: 30000, purchased: false, purchasedAt: '', deadline: '2027-05-31' },
      { id: 'g3', title: 'Old', targetAmount: 1000, savedAmount: 1000, purchased: true, purchasedAt: '2026-08-01T00:00:00Z', deadline: '' },
    ],
    ...over,
  };
}

/* ---- Pieces ---- */

test('periods: parse, shift across years, status', () => {
  assert.equal(parseReviewPeriod('2026-10'), '2026-10');
  assert.equal(parseReviewPeriod('2026-13'), null);
  assert.equal(parseReviewPeriod('x'), null);
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(reviewStatus('2026-10', '2026-11-08'), 'past');
  assert.equal(reviewStatus('2026-11', '2026-11-08'), 'current');
  assert.equal(reviewStatus('2026-12', '2026-11-08'), 'future');
});

test('figures: net and savings rate, none without income', () => {
  assert.deepEqual(figures(43500, 30015), { income: 43500, expense: 30015, net: 13485, savingsRate: 31 });
  assert.equal(figures(0, 500).savingsRate, null);
  assert.equal(figures(1000, 1500).savingsRate, -50);
});

test('3-month average uses only the months before', () => {
  const avg = averageBefore(trend, '2026-10');
  assert.equal(avg.months, 3);
  assert.equal(avg.figures.income, 41000);
  assert.equal(avg.figures.expense, Math.round(((30000 + 31000 + 31160) / 3) * 100) / 100);
  assert.deepEqual(averageBefore([], '2026-10'), { figures: null, months: 0 });
});

test('categories: change vs last month, including one that disappeared', () => {
  const rows = compareCategories(summary().categoryBreakdown, previous.categoryBreakdown);
  const food = rows.find((r) => r.category === 'Food');
  assert.equal(food.change, 2140);
  assert.equal(food.changePct, 38);
  const gifts = rows.find((r) => r.category === 'Gifts');
  assert.equal(gifts.amount, 0);
  assert.equal(gifts.change, -900);
  const fun = rows.find((r) => r.category === 'Fun');
  assert.equal(fun.changePct, null, 'new this month: no percentage');
  assert.equal(rows[0].category, 'Food', 'largest first');
});

test('no-spend days and the longest run; installment chunks are not spending', () => {
  const r = noSpendDays(input().transactions, '2026-10', 31);
  // Spending on the 2nd and 12th only (the 1st is an installment chunk).
  assert.equal(r.days, 29);
  assert.equal(r.longestRun, 19); // 13th–31st
  assert.equal(r.outOf, 31);
  assert.deepEqual(noSpendDays([], '2026-10', 0), { days: 0, longestRun: 0, outOf: 0 });
});

test('biggest purchases: expenses of the month only, chunks left out', () => {
  const top = biggestExpenses(input().transactions, '2026-10');
  assert.deepEqual(top.map((t) => t.id), ['a', 'b']);
});

test('budgets: unset limits dropped, over ones flagged', () => {
  const rows = budgetRows(summary().budgets);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.label, r.over]), [['Food', false], ['Transport', true]]);
});

/* ---- The whole review ---- */

test('a past month: figures, comparisons, goals, recurring, month-end left', () => {
  const r = buildMonthReview(input());
  assert.equal(r.status, 'past');
  assert.equal(r.current.savingsRate, 31);
  assert.equal(r.previous.savingsRate, 24);
  assert.equal(r.biggestUp.category, 'Food');
  assert.equal(r.biggestDown.category, 'Gifts');
  assert.equal(r.budgetsHit, 1);
  assert.deepEqual(r.goalsBought.map((g) => g.title), ['Laptop']);
  assert.deepEqual(r.goals.map((g) => [g.title, g.percent]), [['Japan', 50]]);
  assert.deepEqual(r.newRecurring.map((s) => s.name), ['Gym']);
  assert.equal(r.leftAtMonthEnd, 60200);
});

test('highlights: rule-based, at most five, in a fixed order', () => {
  const r = buildMonthReview(input());
  assert.deepEqual(r.highlights.map((h) => h.key), ['savedUp', 'spendAboutAvg', 'categoryUp', 'budgetsSome', 'goalsBought']);
  assert.equal(r.highlights[0].values.rate, 31);
  assert.equal(r.highlights[2].values.category, 'Food');
});

test('highlights: no income, and spending about average', () => {
  const s = summary({ monthIncome: 0, monthExpense: 30700, budgets: [] });
  const r = buildMonthReview(input({ summary: s, previousSummary: null, goals: [] }));
  assert.equal(r.highlights[0].key, 'noIncome');
  assert.equal(r.highlights[1].key, 'spendAboutAvg');
  assert.equal(r.previous.income, 41000, 'falls back to the trend for last month');
});

test('current month counts no-spend days only up to today, no month-end figure', () => {
  const r = buildMonthReview(input({ period: '2026-11', summary: summary({ period: '2026-11' }), transactions: [] }));
  assert.equal(r.status, 'current');
  assert.equal(r.noSpend.outOf, 8);
  assert.equal(r.leftAtMonthEnd, null);
});

test('the note: callout, tables, lists and room for the reader', () => {
  const r = buildMonthReview(input());
  const words = {
    t: (key, v = {}) => `${key}${Object.keys(v).length ? JSON.stringify(v) : ''}`,
    money: (n) => `฿${n}`,
    monthName: (p) => p,
    dayName: (d) => d.slice(5),
    highlight: (h) => `${h.key}|with pipe`,
    walletName: (id) => id,
  };
  const { title, body } = reviewMarkdown(r, words);
  assert.match(title, /noteTitle/);
  assert.match(body, /^> \[!NOTE\]\n> savedUp\\\|with pipe/);
  assert.match(body, /\|---\|---:\|---:\|---:\|/);
  assert.match(body, /\| Food \| ฿7770 \| ▲ ฿2140 \|/);
  assert.match(body, /- ❌ Transport/);
  assert.match(body, /1\. 10-12 · Headphones · ฿1890 · card/);
  assert.match(body, /- Gym · ฿900/);
  assert.match(body, /goalsNoHistory/);
  assert.match(body, /## myNotes\n$/);
  assert.ok(body.length < 40000);
});
