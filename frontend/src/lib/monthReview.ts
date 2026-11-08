import { parsePeriod, shiftPeriod } from './format';
import { goalPace } from './goalMath';
import { computeSafeSpend, daysInPeriod, defaultSafeSpendSettings } from './safeSpend';
import type { BudgetProgress, DashboardSummary, Goal, Subscription, Transaction } from '../types';

/**
 * Month review: the numbers behind the #/review page and its note.
 *
 * Everything is worked out from what the app already loads — the dashboard
 * payload for the month and the month before (totals, category breakdown,
 * budgets, the six-month trend, the month-end balances), that month's
 * transactions, the recurring list and the goals. Nothing here talks to the
 * server and nothing is guessed: where the data has no history (goal
 * deposits, edits to a recurring item) the review says so instead.
 *
 * Highlights are returned as keys with values, not sentences, so the page and
 * the note word them in the reader's language from the same facts.
 */

export type ReviewStatus = 'past' | 'current' | 'future';

export interface MonthFigures {
  income: number;
  expense: number;
  net: number;
  /** Percent of income kept; null without income. */
  savingsRate: number | null;
}

export interface CategoryRow {
  category: string;
  amount: number;
  previous: number;
  change: number;
  /** Percent change; null when last month had none. */
  changePct: number | null;
}

export interface BudgetRow {
  label: string;
  spent: number;
  limit: number;
  over: boolean;
}

export interface GoalRow {
  id: string;
  title: string;
  saved: number;
  target: number;
  percent: number;
  /** To arrive on time from today; 0 without a deadline or once funded. */
  perMonth: number;
  open: boolean;
  overdue: boolean;
}

export interface BoughtGoal {
  id: string;
  title: string;
  amount: number;
  date: string;
}

export interface NoSpend {
  days: number;
  longestRun: number;
  /** Days looked at: the whole month, or up to today for the current one. */
  outOf: number;
}

export type HighlightKey =
  | 'saved'
  | 'savedUp'
  | 'savedDown'
  | 'savedSame'
  | 'noIncome'
  | 'spendBelowAvg'
  | 'spendAboveAvg'
  | 'spendAboutAvg'
  | 'categoryUp'
  | 'categoryDown'
  | 'budgetsAll'
  | 'budgetsSome'
  | 'noSpendDays'
  | 'goalsBought';

export interface Highlight {
  key: HighlightKey;
  /** Raw values; the page formats money and percentages. */
  values: Record<string, number | string>;
}

export interface MonthReview {
  period: string;
  previousPeriod: string;
  status: ReviewStatus;
  current: MonthFigures;
  previous: MonthFigures | null;
  /** Mean of up to three months before `period` (from the trend); null when none. */
  average: MonthFigures | null;
  averageMonths: number;
  categories: CategoryRow[];
  biggestUp: CategoryRow | null;
  biggestDown: CategoryRow | null;
  budgets: BudgetRow[];
  budgetsHit: number;
  goalsBought: BoughtGoal[];
  goals: GoalRow[];
  biggest: Transaction[];
  newRecurring: Subscription[];
  noSpend: NoSpend;
  /** Cash − card debt at month end (past months on a backend that reports it). */
  leftAtMonthEnd: number | null;
  highlights: Highlight[];
}

export interface MonthReviewInput {
  period: string;
  /** `YYYY-MM-DD`. */
  today: string;
  summary: DashboardSummary;
  previousSummary?: DashboardSummary | null;
  /** That month's transactions (a wider list is fine; it is filtered). */
  transactions: Transaction[];
  subscriptions: Subscription[];
  goals: Goal[];
}

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
const pct = (value: number) => Math.round(value * 10) / 10;

/* Shared with the shell (lib/format), so a link and the page agree on the month. */
export { parsePeriod as parseReviewPeriod, shiftPeriod as shiftMonth };

export function reviewStatus(period: string, today: string): ReviewStatus {
  const now = today.slice(0, 7);
  return period < now ? 'past' : period === now ? 'current' : 'future';
}

export function figures(income: number, expense: number): MonthFigures {
  const i = round2(Number(income) || 0);
  const e = round2(Number(expense) || 0);
  return { income: i, expense: e, net: round2(i - e), savingsRate: i > 0 ? pct(((i - e) / i) * 100) : null };
}

/** Mean income and spending of up to three months before `period`. */
export function averageBefore(
  trend: { period: string; income: number; expense: number }[],
  period: string,
): { figures: MonthFigures | null; months: number } {
  const rows = trend
    .filter((row) => row.period < period)
    .sort((a, b) => (a.period < b.period ? 1 : -1))
    .slice(0, 3);
  if (rows.length === 0) return { figures: null, months: 0 };
  const income = rows.reduce((sum, row) => sum + (Number(row.income) || 0), 0) / rows.length;
  const expense = rows.reduce((sum, row) => sum + (Number(row.expense) || 0), 0) / rows.length;
  return { figures: figures(income, expense), months: rows.length };
}

/** This month's categories against last month's, largest first. */
export function compareCategories(
  current: { category: string; amount: number }[],
  previous: { category: string; amount: number }[] | null,
): CategoryRow[] {
  const before = new Map<string, number>();
  for (const row of previous ?? []) before.set(row.category, (before.get(row.category) ?? 0) + (Number(row.amount) || 0));
  const now = new Map<string, number>();
  for (const row of current) now.set(row.category, (now.get(row.category) ?? 0) + (Number(row.amount) || 0));
  /* A category that disappeared this month is still a change worth naming. */
  const names = new Set([...now.keys(), ...(previous ? before.keys() : [])]);
  return [...names]
    .map((category) => {
      const amount = round2(now.get(category) ?? 0);
      const prev = round2(before.get(category) ?? 0);
      const change = round2(amount - prev);
      return { category, amount, previous: prev, change, changePct: previous && prev > 0 ? pct((change / prev) * 100) : null };
    })
    .sort((a, b) => b.amount - a.amount || a.category.localeCompare(b.category));
}

/** Days with no expense, and the longest run of them, up to `lastDay`. */
export function noSpendDays(transactions: Transaction[], period: string, lastDay: number): NoSpend {
  const spent = new Set<number>();
  for (const tx of transactions) {
    if (tx.type !== 'expense' || String(tx.date ?? '').slice(0, 7) !== period) continue;
    /* An installment chunk is booked on a date, but nothing was bought that day. */
    if (tx.installmentGroupId) continue;
    spent.add(Number(String(tx.date).slice(8, 10)));
  }
  let days = 0;
  let run = 0;
  let longestRun = 0;
  for (let day = 1; day <= lastDay; day += 1) {
    if (spent.has(day)) {
      run = 0;
    } else {
      days += 1;
      run += 1;
      longestRun = Math.max(longestRun, run);
    }
  }
  return { days, longestRun, outOf: Math.max(0, lastDay) };
}

/** The month's largest purchases (expenses; installment chunks are not purchases). */
export function biggestExpenses(transactions: Transaction[], period: string, count = 5): Transaction[] {
  return transactions
    .filter((tx) => tx.type === 'expense' && String(tx.date ?? '').slice(0, 7) === period && !tx.installmentGroupId)
    .sort((a, b) => (Number(b.amount) || 0) - (Number(a.amount) || 0) || (a.date < b.date ? -1 : 1))
    .slice(0, count);
}

export function budgetRows(budgets: BudgetProgress[]): BudgetRow[] {
  return budgets
    .filter((budget) => Number(budget.limit) > 0)
    .map((budget) => ({
      label: budget.targetLabel || budget.targetId || '—',
      spent: round2(Number(budget.spent) || 0),
      limit: round2(Number(budget.limit) || 0),
      over: (Number(budget.spent) || 0) > (Number(budget.limit) || 0),
    }))
    .sort((a, b) => Number(a.over) - Number(b.over) || b.spent / b.limit - a.spent / a.limit);
}

function buildHighlights(review: Omit<MonthReview, 'highlights'>): Highlight[] {
  const out: Highlight[] = [];
  const { current, previous, average } = review;

  if (current.savingsRate !== null) {
    if (previous && previous.savingsRate !== null) {
      const diff = current.savingsRate - previous.savingsRate;
      const key: HighlightKey = Math.abs(diff) < 1 ? 'savedSame' : diff > 0 ? 'savedUp' : 'savedDown';
      out.push({ key, values: { rate: current.savingsRate, previous: previous.savingsRate, month: review.previousPeriod } });
    } else {
      out.push({ key: 'saved', values: { rate: current.savingsRate } });
    }
  } else if (current.expense > 0) {
    out.push({ key: 'noIncome', values: {} });
  }

  if (average && average.expense > 0 && current.expense > 0) {
    const diff = ((current.expense - average.expense) / average.expense) * 100;
    const key: HighlightKey = Math.abs(diff) < 5 ? 'spendAboutAvg' : diff < 0 ? 'spendBelowAvg' : 'spendAboveAvg';
    out.push({ key, values: { amount: current.expense, pct: Math.abs(Math.round(diff)), months: review.averageMonths } });
  }

  const up = review.biggestUp;
  const down = review.biggestDown;
  const pick = up && down ? (Math.abs(up.change) >= Math.abs(down.change) ? up : down) : up ?? down;
  if (pick && pick.change !== 0) {
    out.push({
      key: pick.change > 0 ? 'categoryUp' : 'categoryDown',
      values: { category: pick.category, amount: Math.abs(pick.change), pct: pick.changePct === null ? '' : Math.abs(Math.round(pick.changePct)) },
    });
  }

  if (review.budgets.length > 0) {
    out.push({
      key: review.budgetsHit === review.budgets.length ? 'budgetsAll' : 'budgetsSome',
      values: { hit: review.budgetsHit, total: review.budgets.length },
    });
  }

  if (review.goalsBought.length > 0) out.push({ key: 'goalsBought', values: { count: review.goalsBought.length } });
  if (review.noSpend.days > 0) out.push({ key: 'noSpendDays', values: { count: review.noSpend.days, run: review.noSpend.longestRun } });

  return out.slice(0, 5);
}

export function buildMonthReview(input: MonthReviewInput): MonthReview {
  const { period, today, summary } = input;
  const previousPeriod = shiftPeriod(period, -1);
  const status = reviewStatus(period, today);
  const trend = summary.trend ?? [];

  const current = figures(summary.monthIncome, summary.monthExpense);
  const prevRow = input.previousSummary
    ? { income: input.previousSummary.monthIncome, expense: input.previousSummary.monthExpense }
    : trend.find((row) => row.period === previousPeriod) ?? null;
  const previous = prevRow ? figures(prevRow.income, prevRow.expense) : null;
  const avg = averageBefore(trend, period);

  const categories = compareCategories(summary.categoryBreakdown ?? [], input.previousSummary?.categoryBreakdown ?? null);
  const withChange = categories.filter((row) => row.change !== 0);
  const biggestUp = withChange.filter((row) => row.change > 0).sort((a, b) => b.change - a.change)[0] ?? null;
  const biggestDown = withChange.filter((row) => row.change < 0).sort((a, b) => a.change - b.change)[0] ?? null;

  const budgets = budgetRows(summary.budgets ?? []);
  const lastDay = status === 'past' ? daysInPeriod(period) : status === 'current' ? Number(today.slice(8, 10)) : 0;

  const goalsBought = input.goals
    .filter((goal) => goal.purchased && String(goal.purchasedAt ?? '').slice(0, 7) === period)
    .map((goal) => ({ id: goal.id, title: goal.title, amount: round2(Number(goal.targetAmount) || Number(goal.savedAmount) || 0), date: goal.purchasedAt.slice(0, 10) }));
  const asOf = new Date(Number(today.slice(0, 4)), Number(today.slice(5, 7)) - 1, Number(today.slice(8, 10)));
  const goals = input.goals
    .filter((goal) => !goal.purchased)
    .map((goal) => {
      const pace = goalPace(goal, asOf);
      const target = Number(goal.targetAmount) || 0;
      const saved = Number(goal.savedAmount) || 0;
      return {
        id: goal.id,
        title: goal.title,
        saved: round2(saved),
        target: round2(target),
        percent: target > 0 ? Math.min(100, Math.round((saved / target) * 100)) : 0,
        perMonth: pace.perMonth,
        open: pace.open,
        overdue: pace.overdue,
      };
    });

  /* Same figure the Safe-to-spend card shows for a past month. */
  const leftAtMonthEnd =
    status === 'past'
      ? computeSafeSpend({
          period,
          today,
          wallets: [],
          goals: [],
          subscriptions: [],
          debts: [],
          transactions: [],
          budgets: [],
          trend: [],
          paydays: [],
          settings: defaultSafeSpendSettings(),
          monthIncome: summary.monthIncome,
          monthExpense: summary.monthExpense,
          historical: summary.historical ?? null,
        }).left
      : null;

  const review: Omit<MonthReview, 'highlights'> = {
    period,
    previousPeriod,
    status,
    current,
    previous,
    average: avg.figures,
    averageMonths: avg.months,
    categories,
    biggestUp,
    biggestDown,
    budgets,
    budgetsHit: budgets.filter((row) => !row.over).length,
    goalsBought,
    goals,
    biggest: biggestExpenses(input.transactions, period),
    newRecurring: input.subscriptions
      .filter((sub) => String(sub.createdAt ?? '').slice(0, 7) === period)
      .sort((a, b) => (a.createdAt < b.createdAt ? -1 : 1)),
    noSpend: noSpendDays(input.transactions, period, lastDay),
    leftAtMonthEnd,
  };
  return { ...review, highlights: buildHighlights(review) };
}

/* ------------------------------------------------------------------ */
/* The note                                                            */
/* ------------------------------------------------------------------ */

export interface ReviewWords {
  /** A translated string for a key under `review.`. */
  t: (key: string, values?: Record<string, unknown>) => string;
  money: (value: number) => string;
  /** "October 2026" etc. */
  monthName: (period: string) => string;
  /** "12 Oct" etc. */
  dayName: (date: string) => string;
  highlight: (highlight: Highlight) => string;
  walletName: (id: string) => string;
}

const cell = (text: string) => text.replace(/\|/g, '\\|').replace(/[\r\n]+/g, ' ');
const signedMoney = (words: ReviewWords, value: number) => (value > 0 ? `▲ ${words.money(value)}` : value < 0 ? `▼ ${words.money(-value)}` : '—');
const rate = (value: number | null) => (value === null ? '—' : `${Math.round(value)}%`);

/** The review as Markdown for a note: a callout of highlights, tables, lists, and room for the reader's own notes. */
export function reviewMarkdown(review: MonthReview, words: ReviewWords): { title: string; body: string } {
  const { t, money } = words;
  const month = words.monthName(review.period);
  const prev = words.monthName(review.previousPeriod);
  const lines: string[] = [];

  if (review.highlights.length > 0) {
    lines.push('> [!NOTE]');
    for (const highlight of review.highlights) lines.push(`> ${cell(words.highlight(highlight))}`);
    lines.push('');
  }

  const col = (f: MonthFigures | null, key: 'income' | 'expense') => (f ? money(f[key]) : '—');
  const saved = (f: MonthFigures | null) => (f ? `${money(f.net)} (${rate(f.savingsRate)})` : '—');
  lines.push(`| | ${cell(month)} | ${cell(prev)} | ${cell(t('noteAvg'))} |`, '|---|---:|---:|---:|');
  lines.push(`| ${t('income')} | ${col(review.current, 'income')} | ${col(review.previous, 'income')} | ${col(review.average, 'income')} |`);
  lines.push(`| ${t('spent')} | ${col(review.current, 'expense')} | ${col(review.previous, 'expense')} | ${col(review.average, 'expense')} |`);
  lines.push(`| ${t('saved')} | ${saved(review.current)} | ${saved(review.previous)} | ${saved(review.average)} |`);
  lines.push('');

  const top = review.categories.filter((row) => row.amount > 0).slice(0, 6);
  if (top.length > 0) {
    lines.push(`## ${t('categories')}`, `| ${t('category')} | ${t('spent')} | ${cell(t('vsMonth', { month: prev }))} |`, '|---|---:|---:|');
    for (const row of top) lines.push(`| ${cell(row.category)} | ${money(row.amount)} | ${signedMoney(words, row.change)} |`);
    lines.push('');
  }

  if (review.budgets.length > 0) {
    lines.push(`## ${t('budgets')}`);
    for (const row of review.budgets) {
      lines.push(
        row.over
          ? `- ❌ ${cell(row.label)}: ${t('budgetOver', { spent: money(row.spent), limit: money(row.limit), over: money(row.spent - row.limit) })}`
          : `- ✅ ${cell(row.label)}: ${t('budgetOk', { spent: money(row.spent), limit: money(row.limit) })}`,
      );
    }
    lines.push('');
  }

  if (review.goalsBought.length > 0 || review.goals.length > 0) {
    lines.push(`## ${t('goals')}`);
    for (const goal of review.goalsBought) lines.push(`- 🎉 ${cell(goal.title)}: ${t('goalBought', { date: words.dayName(goal.date), amount: money(goal.amount) })}`);
    for (const goal of review.goals) lines.push(`- ${cell(goal.title)}: ${t('goalProgress', { percent: goal.percent, saved: money(goal.saved), target: money(goal.target) })}`);
    lines.push(`- _${t('goalsNoHistory')}_`, '');
  }

  if (review.biggest.length > 0) {
    lines.push(`## ${t('biggest')}`);
    review.biggest.forEach((tx, index) => {
      const label = tx.note?.trim() || tx.category || '—';
      lines.push(`${index + 1}. ${words.dayName(tx.date)} · ${cell(label)} · ${money(Number(tx.amount) || 0)} · ${cell(words.walletName(tx.walletId))}`);
    });
    lines.push('');
  }

  if (review.newRecurring.length > 0) {
    lines.push(`## ${t('newRecurring')}`);
    for (const sub of review.newRecurring) lines.push(`- ${cell(sub.name)} · ${money(Number(sub.amount) || 0)} · ${t(`freq_${sub.frequency}`)}`);
    lines.push('');
  }

  lines.push(`**${t('noSpendTitle')}:** ${t('noSpendLine', { count: review.noSpend.days, run: review.noSpend.longestRun })}`);
  if (review.leftAtMonthEnd !== null) lines.push('', `**${t('leftTitle')}:** ${money(review.leftAtMonthEnd)}`);
  lines.push('', `## ${t('myNotes')}`, '');

  return { title: t('noteTitle', { month }), body: lines.join('\n') };
}
