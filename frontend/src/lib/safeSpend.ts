import { safeToSpend } from './creditMath';
import { goalPace, lockedInGoals } from './goalMath';
import type { SyncedLayoutFormat } from './layout/layoutFormats';
import type { RemotePref } from './layout/layoutSync';
import { debtOccurrencesInRange, subscriptionOccurrences } from './liabilityMath';
import type {
  BudgetProgress,
  Debt,
  Goal,
  HistoricalBalance,
  Subscription,
  Transaction,
  WalletBalance,
} from '../types';

/**
 * Safe to spend: "how much can I still spend this month, and per day?"
 *
 * ---------------------------------------------------------------------------
 * BALANCE-BASED
 * ---------------------------------------------------------------------------
 * Income already received is in the balances and spending so far is already
 * out of them, so the month starts from what the counted wallets hold, the
 * same `cash − card debt` the hero calls "after cards" (creditMath.safeToSpend,
 * so the two can never disagree). From there:
 *
 *   left = cash − card debt
 *        − money in goals                    (setting, on)
 *        − goals planned this month          (setting, OFF: may overlap the line above)
 *        − bills still due this month        (recurring + debt payments, not yet paid)
 *        + expected income still to come    (setting, off; an estimate)
 *        − unspent budgets                   (setting, off; shown separately otherwise)
 *
 * ---------------------------------------------------------------------------
 * NOTHING IS COUNTED TWICE
 * ---------------------------------------------------------------------------
 *  - Card statement bills: card debt is already subtracted in full.
 *  - Installment chunks: every chunk of a plan is a real row, and wallet
 *    balances sum rows with no date filter (Code.gs balancesAsOf_), so the
 *    whole remaining plan is already in the balance. This month's chunk is
 *    neither a bill nor "spent this month".
 *  - Recurring bills: `subscriptions.pay` moves `nextDueDate` on, and
 *    occurrences are walked from it, so a bill paid with Pay is gone. One paid
 *    as an ordinary expense is not recognisable and still shows (noted).
 *  - Debt payments: a debt has a due day, not a paid flag. Counted only from
 *    today on, and not when this month already has a payment for it: an
 *    expense whose note is the debt's name, which `debts.pay` writes unless
 *    the user types their own note (noted).
 *  - Goals plan: deposits have no history, so a plan line cannot know what was
 *    already moved this month. Off by default, labelled when on.
 *
 * Every rule that applies is returned as a note for the breakdown sheet.
 */

/* ------------------------------------------------------------------ */
/* Settings (synced through UiPrefs: layout.safe-spend)                */
/* ------------------------------------------------------------------ */

/*
 * UiPrefs only takes `layout.*` keys with `{v:1, cards:[]}`, so the settings
 * ride in that envelope, marked `kind:"safe-spend"` with their own `format`.
 * Layout readers ignore any value with a `kind` (layoutFormats.isForeignPref).
 */
export const SAFE_SPEND_PAGE = 'safe-spend';
export const SAFE_SPEND_KIND = 'safe-spend';
export const SAFE_SPEND_FORMAT_VERSION = 1;
const MAX_EXCLUDED = 200;

export interface SafeSpendSettings {
  /** Spending wallets left out. A list of exclusions so a new wallet counts by default. */
  excluded: string[];
  /** Subtract money already in goals. */
  goals: boolean;
  /** Also subtract this month's goal plan (may overlap the above). */
  goalPlan: boolean;
  /** Add the income still expected this month (an estimate). */
  expectedIncome: boolean;
  /** Subtract unspent budgets instead of only showing them. */
  budgets: boolean;
  updatedAt: number;
}

export function defaultSafeSpendSettings(): SafeSpendSettings {
  return { excluded: [], goals: true, goalPlan: false, expectedIncome: false, budgets: false, updatedAt: 0 };
}

export function sanitizeSafeSpendSettings(raw: unknown): SafeSpendSettings {
  let value = raw;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return defaultSafeSpendSettings();
    }
  }
  if (!value || typeof value !== 'object') return defaultSafeSpendSettings();
  const o = value as Record<string, unknown>;
  if (o.kind !== SAFE_SPEND_KIND || o.format !== SAFE_SPEND_FORMAT_VERSION) return defaultSafeSpendSettings();
  const base = defaultSafeSpendSettings();
  const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  const excluded = Array.isArray(o.excluded)
    ? [...new Set(o.excluded.filter((id): id is string => typeof id === 'string' && id.length > 0 && id.length <= 64))].slice(0, MAX_EXCLUDED)
    : [];
  return {
    excluded,
    goals: flag(o.goals, base.goals),
    goalPlan: flag(o.goalPlan, base.goalPlan),
    expectedIncome: flag(o.expectedIncome, base.expectedIncome),
    budgets: flag(o.budgets, base.budgets),
    updatedAt: typeof o.updatedAt === 'number' && Number.isFinite(o.updatedAt) && o.updatedAt > 0 ? o.updatedAt : 0,
  };
}

export function serializeSafeSpendSettings(settings: SafeSpendSettings): string {
  return JSON.stringify({
    v: 1,
    cards: [],
    kind: SAFE_SPEND_KIND,
    format: SAFE_SPEND_FORMAT_VERSION,
    updatedAt: settings.updatedAt,
    excluded: settings.excluded,
    goals: settings.goals,
    goalPlan: settings.goalPlan,
    expectedIncome: settings.expectedIncome,
    budgets: settings.budgets,
  });
}

/** `qw.layout.safe-spend.<user>` here, `layout.safe-spend` on the server. */
export const SAFE_SPEND_SYNC_FORMAT: SyncedLayoutFormat<SafeSpendSettings> = {
  page: SAFE_SPEND_PAGE,
  readLocal: (stored) => sanitizeSafeSpendSettings(stored[SAFE_SPEND_PAGE] ?? null),
  fromRemote: (pref: RemotePref) => ({ ...sanitizeSafeSpendSettings(pref.value), updatedAt: pref.updatedAt }),
  serialize: serializeSafeSpendSettings,
};

/* ------------------------------------------------------------------ */
/* Dates                                                               */
/* ------------------------------------------------------------------ */

const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function daysInPeriod(period: string): number {
  const [year, month] = period.split('-').map(Number);
  return year && month ? new Date(year, month, 0).getDate() : 30;
}

function dayOfKey(key: string): number {
  return Number(key.slice(8, 10)) || 1;
}

function dateFromKey(key: string): Date {
  const [year, month, day] = key.split('-').map(Number);
  return new Date(year, (month || 1) - 1, day || 1);
}

/** The months before `period` in the trend, newest first, at most `count`. */
function previousMonths<T extends { period: string }>(trend: T[], period: string, count: number): T[] {
  return trend
    .filter((row) => row.period < period)
    .sort((a, b) => (a.period < b.period ? 1 : -1))
    .slice(0, count);
}

/* ------------------------------------------------------------------ */
/* The calculation                                                     */
/* ------------------------------------------------------------------ */

export type SafeSpendMode = 'live' | 'past' | 'future';
export type SafeSpendState = 'ok' | 'tight' | 'over';

export type SafeSpendLineKey =
  | 'cash'
  | 'cardDebt'
  | 'goals'
  | 'goalPlan'
  | 'bills'
  | 'expectedIncome'
  | 'budgets'
  | 'avgIncome';

/** One line of the formula. `amount` is signed: what it adds to "left". */
export interface SafeSpendLine {
  key: SafeSpendLineKey;
  amount: number;
  estimate?: boolean;
  count?: number;
}

export interface SafeSpendBill {
  key: string;
  kind: 'subscription' | 'debt';
  name: string;
  /** `YYYY-MM-DD`. */
  date: string;
  amount: number;
  /** Due earlier this month and not marked paid. */
  overdue: boolean;
}

export type SafeSpendNoteKey =
  | 'cardBills'
  | 'installments'
  | 'billsPaid'
  | 'debtsPaid'
  | 'goalPlanOverlap'
  | 'goalsOff'
  | 'budgetsSeparate'
  | 'budgetsCounted'
  | 'transfers'
  | 'investing'
  | 'excludedWallets'
  | 'billsOtherWallets'
  | 'expectedNone'
  | 'pastAllWallets'
  | 'pastNoBills'
  | 'pastUnavailable'
  | 'futureEstimate';

export interface SafeSpendNote {
  key: SafeSpendNoteKey;
  count?: number;
  amount?: number;
}

export interface SafeSpendResult {
  mode: SafeSpendMode;
  /** Null when the figure cannot be known (a past month on an old backend). */
  left: number | null;
  /** Left ÷ days left including today (live), or ÷ days in the month (future). */
  perDay: number | null;
  /** Today's share of `left`, less what today has already spent (live only). */
  todayLeft: number | null;
  daysLeft: number;
  daysInMonth: number;
  lines: SafeSpendLine[];
  bills: SafeSpendBill[];
  billsTotal: number;
  notes: SafeSpendNote[];
  /** Σ max(0, remaining) over this month's budgets. */
  budgetsUnspent: number;
  budgetCount: number;
  /** Expenses this month so far in the counted wallets, installment chunks excluded. */
  spentSoFar: number;
  spentToday: number;
  movedToInvesting: number;
  /** Average spend per day over the previous three months (0 when unknown). */
  avgDailySpend: number;
  /** The month's own figures from the dashboard (all wallets). */
  monthIncome: number;
  monthExpense: number;
  /** Past month: average spend per day across the month. */
  pastPerDay: number | null;
  state: SafeSpendState;
}

export interface SafeSpendInput {
  /** `YYYY-MM` shown by the month pill. */
  period: string;
  /** The user's today, `YYYY-MM-DD`. */
  today: string;
  /** Today's balances, every wallet (the dashboard's list). */
  wallets: WalletBalance[];
  goals: Goal[];
  subscriptions: Subscription[];
  debts: Debt[];
  /** Transactions covering at least the month (any wider window is fine). */
  transactions: Transaction[];
  /** This month's budgets with their progress. */
  budgets: BudgetProgress[];
  /** Monthly totals, including months before `period`. */
  trend: { period: string; income: number; expense: number }[];
  paydays: number[];
  settings: SafeSpendSettings;
  monthIncome: number;
  monthExpense: number;
  /** Month-end balances for a past month. */
  historical?: HistoricalBalance | null;
}

/** The spending wallets that count: not archived, not excluded. Investing never counts. */
export function countedWallets(wallets: WalletBalance[], settings: SafeSpendSettings): WalletBalance[] {
  const excluded = new Set(settings.excluded);
  return wallets.filter((wallet) => wallet.mode === 'expense' && !wallet.archived && !excluded.has(wallet.id));
}

/** A debt counts as paid this month when an expense this month carries its name as the note. */
export function debtPaidThisMonth(debt: Debt, transactions: Transaction[], period: string): boolean {
  const title = String(debt.title ?? '').trim().toLowerCase();
  if (!title) return false;
  return transactions.some(
    (tx) =>
      tx.type === 'expense' &&
      String(tx.date ?? '').slice(0, 7) === period &&
      String(tx.note ?? '').trim().toLowerCase() === title,
  );
}

/** Average monthly income and daily spend over the three months before `period`. */
export function recentAverages(trend: SafeSpendInput['trend'], period: string): { income: number; dailySpend: number; months: number } {
  const months = previousMonths(trend, period, 3);
  if (months.length === 0) return { income: 0, dailySpend: 0, months: 0 };
  const days = months.reduce((sum, row) => sum + daysInPeriod(row.period), 0);
  const income = months.reduce((sum, row) => sum + (Number(row.income) || 0), 0) / months.length;
  const expense = months.reduce((sum, row) => sum + (Number(row.expense) || 0), 0);
  return { income: round2(income), dailySpend: days > 0 ? round2(expense / days) : 0, months: months.length };
}

function stateOf(left: number | null, perDay: number | null, todayLeft: number | null, avgDailySpend: number): SafeSpendState {
  if (left === null) return 'ok';
  if (left < 0) return 'over';
  if (todayLeft !== null && todayLeft < 0) return 'tight';
  if (perDay !== null && avgDailySpend > 0 && perDay < avgDailySpend) return 'tight';
  return 'ok';
}

/** The bills still to pay in `period`, from `from` (inclusive). */
function billsFor(
  input: SafeSpendInput,
  counted: Set<string>,
  knownWallets: Set<string>,
  mode: SafeSpendMode,
): { bills: SafeSpendBill[]; otherWallets: number } {
  const { period, today } = input;
  const monthStart = `${period}-01`;
  const monthEnd = `${period}-${String(daysInPeriod(period)).padStart(2, '0')}`;
  const bills: SafeSpendBill[] = [];
  let otherWallets = 0;

  for (const sub of input.subscriptions) {
    const amount = round2(Number(sub.amount) || 0);
    if (amount <= 0) continue;
    /* Paid from a wallet that doesn't count (unticked, or investing): its money isn't in "left". */
    if (sub.walletId && knownWallets.has(sub.walletId) && !counted.has(sub.walletId)) {
      otherWallets += 1;
      continue;
    }
    for (const date of subscriptionOccurrences(sub, period)) {
      bills.push({
        key: `sub:${sub.id}:${date}`,
        kind: 'subscription',
        name: sub.name,
        date,
        amount,
        overdue: mode === 'live' && date < today,
      });
    }
  }

  for (const debt of input.debts) {
    if (debt.settled) continue;
    const from = mode === 'live' ? today : monthStart;
    if (mode === 'live' && debtPaidThisMonth(debt, input.transactions, period)) continue;
    for (const hit of debtOccurrencesInRange(debt, from, monthEnd)) {
      bills.push({ key: `debt:${debt.id}:${hit.date}`, kind: 'debt', name: debt.title, date: hit.date, amount: hit.amount, overdue: false });
    }
  }

  bills.sort((a, b) => (a.date === b.date ? a.name.localeCompare(b.name) : a.date < b.date ? -1 : 1));
  return { bills, otherWallets };
}

export function computeSafeSpend(input: SafeSpendInput): SafeSpendResult {
  const { period, today, settings } = input;
  const currentPeriod = today.slice(0, 7);
  const mode: SafeSpendMode = period === currentPeriod ? 'live' : period < currentPeriod ? 'past' : 'future';
  const daysInMonth = daysInPeriod(period);
  const averages = recentAverages(input.trend, period);
  const counted = countedWallets(input.wallets, settings);
  const countedIds = new Set(counted.map((wallet) => wallet.id));
  const knownWallets = new Set(input.wallets.map((wallet) => wallet.id));
  const investing = new Set(input.wallets.filter((wallet) => wallet.mode === 'investment').map((wallet) => wallet.id));

  /* ---- This month's ledger, counted wallets only ---- */
  let spentSoFar = 0;
  let spentToday = 0;
  let movedToInvesting = 0;
  for (const tx of input.transactions) {
    const date = String(tx.date ?? '');
    if (date.slice(0, 7) !== period || (mode === 'live' && date > today)) continue;
    const amount = Number(tx.amount) || 0;
    if (tx.type === 'expense' && countedIds.has(tx.walletId) && !tx.installmentGroupId) {
      spentSoFar += amount;
      if (date === today) spentToday += amount;
    } else if (tx.type === 'transfer' && countedIds.has(tx.walletId) && investing.has(tx.toWalletId)) {
      movedToInvesting += amount;
    }
  }
  spentSoFar = round2(spentSoFar);
  spentToday = round2(spentToday);
  movedToInvesting = round2(movedToInvesting);

  const budgetList = input.budgets.filter((budget) => Number(budget.limit) > 0);
  const budgetsUnspent = round2(budgetList.reduce((sum, budget) => sum + Math.max(0, Number(budget.remaining) || 0), 0));

  const base = {
    mode,
    daysInMonth,
    budgetsUnspent,
    budgetCount: budgetList.length,
    spentSoFar,
    spentToday,
    movedToInvesting,
    avgDailySpend: averages.dailySpend,
    monthIncome: round2(input.monthIncome),
    monthExpense: round2(input.monthExpense),
  };

  /* ---- A past month: what was left at month end ---- */
  if (mode === 'past') {
    const pastPerDay = round2(input.monthExpense / daysInMonth);
    if (!input.historical) {
      return {
        ...base,
        left: null,
        perDay: null,
        todayLeft: null,
        daysLeft: 0,
        lines: [],
        bills: [],
        billsTotal: 0,
        notes: [{ key: 'pastUnavailable' }],
        pastPerDay,
        state: 'ok',
      };
    }
    const cash = round2(input.historical.cashBalance);
    const debt = round2(input.historical.creditDebt);
    const left = round2(cash - debt);
    return {
      ...base,
      left,
      perDay: null,
      todayLeft: null,
      daysLeft: 0,
      lines: [
        { key: 'cash', amount: cash },
        { key: 'cardDebt', amount: -debt },
      ],
      bills: [],
      billsTotal: 0,
      notes: [{ key: 'pastAllWallets' }, { key: 'pastNoBills' }],
      pastPerDay,
      state: left < 0 ? 'over' : 'ok',
    };
  }

  const { bills, otherWallets } = billsFor(input, countedIds, knownWallets, mode);
  const billsTotal = round2(bills.reduce((sum, bill) => sum + bill.amount, 0));
  const lines: SafeSpendLine[] = [];
  const notes: SafeSpendNote[] = [];

  /* Goals: what is saved (today's figure, so live only) and the month's plan. */
  const asOf = mode === 'live' ? dateFromKey(today) : dateFromKey(`${period}-01`);
  const activeGoals = input.goals.filter((goal) => !goal.purchased);
  const planned = round2(activeGoals.reduce((sum, goal) => sum + goalPace(goal, asOf).perMonth, 0));

  let left: number;
  let perDay: number | null;
  let todayLeft: number | null = null;
  let daysLeft: number;

  if (mode === 'live') {
    let cash = 0;
    let debt = 0;
    for (const wallet of counted) {
      if (wallet.type === 'CREDIT') debt += Math.max(0, -wallet.balance);
      else cash += wallet.balance;
    }
    cash = round2(cash);
    debt = round2(debt);
    /* Same function as the hero's "after cards" — must agree to the satang. */
    left = safeToSpend(counted);
    lines.push({ key: 'cash', amount: cash }, { key: 'cardDebt', amount: -debt });

    if (settings.goals) {
      const locked = lockedInGoals(input.goals);
      if (locked > 0) {
        lines.push({ key: 'goals', amount: -locked, count: activeGoals.filter((goal) => goal.savedAmount > 0).length });
        left -= locked;
      }
    } else {
      notes.push({ key: 'goalsOff' });
    }
  } else {
    /* Future: the recent average income is the only money we can expect. */
    left = averages.income;
    lines.push({ key: 'avgIncome', amount: averages.income, estimate: true, count: averages.months });
    notes.push({ key: 'futureEstimate' });
  }

  if (settings.goals && settings.goalPlan && planned > 0) {
    lines.push({ key: 'goalPlan', amount: -planned, estimate: true });
    left -= planned;
    notes.push({ key: 'goalPlanOverlap' });
  }

  if (billsTotal > 0 || bills.length > 0) {
    lines.push({ key: 'bills', amount: -billsTotal, count: bills.length });
    left -= billsTotal;
  }

  if (mode === 'live' && settings.expectedIncome) {
    const todayDay = dayOfKey(today);
    const paydayAhead = input.paydays.some((day) => Number(day) >= todayDay && Number(day) <= daysInMonth);
    const expected = round2(averages.income - input.monthIncome);
    if (paydayAhead && expected > 0) {
      lines.push({ key: 'expectedIncome', amount: expected, estimate: true });
      left += expected;
    } else {
      notes.push({ key: 'expectedNone' });
    }
  }

  if (settings.budgets && budgetsUnspent > 0) {
    lines.push({ key: 'budgets', amount: -budgetsUnspent, count: budgetList.length });
    left -= budgetsUnspent;
    notes.push({ key: 'budgetsCounted' });
  } else if (budgetList.length > 0) {
    notes.push({ key: 'budgetsSeparate', amount: budgetsUnspent, count: budgetList.length });
  }

  left = round2(left);

  if (mode === 'live') {
    daysLeft = daysInMonth - dayOfKey(today) + 1;
    perDay = round2(left / daysLeft);
    todayLeft = round2((left + spentToday) / daysLeft - spentToday);
    notes.unshift({ key: 'cardBills' }, { key: 'installments' }, { key: 'billsPaid' }, { key: 'debtsPaid' }, { key: 'transfers' });
    if (movedToInvesting > 0) notes.push({ key: 'investing', amount: movedToInvesting });
  } else {
    daysLeft = daysInMonth;
    perDay = round2(left / daysInMonth);
    notes.push({ key: 'cardBills' }, { key: 'installments' });
  }

  const excludedSpending = input.wallets.filter(
    (wallet) => wallet.mode === 'expense' && !wallet.archived && settings.excluded.includes(wallet.id),
  ).length;
  if (excludedSpending > 0) notes.push({ key: 'excludedWallets', count: excludedSpending });
  if (otherWallets > 0) notes.push({ key: 'billsOtherWallets', count: otherWallets });

  return {
    ...base,
    left,
    perDay,
    todayLeft,
    daysLeft,
    lines,
    bills,
    billsTotal,
    notes,
    pastPerDay: null,
    state: stateOf(left, perDay, todayLeft, averages.dailySpend),
  };
}
