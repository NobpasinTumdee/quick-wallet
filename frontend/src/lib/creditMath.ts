/**
 * Credit card state, derived from transactions and a billing cycle.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS ON THE CLIENT
 * ---------------------------------------------------------------------------
 * Every figure here is a pure function of rows the app has already fetched.
 * Computing it server-side would add an Apps Script round trip (1-3s) to a
 * screen whose data is already in the cache, and — worse — it would go stale
 * the moment an optimistic write landed, because the cache would hold a new
 * transaction next to a statement balance computed before it existed.
 *
 * Being pure and synchronous also means the cycle arithmetic, which is the part
 * that is genuinely easy to get wrong, is testable without a network or a
 * spreadsheet.
 *
 * ---------------------------------------------------------------------------
 * SIGN CONVENTION
 * ---------------------------------------------------------------------------
 * The ledger stores a card's balance the same way it stores every other
 * wallet's: `opening + income - expense +/- transfers`. A card you owe ฿5,000
 * on therefore has a balance of **-5000**, which is what makes net worth come
 * out right with no special case anywhere in the app.
 *
 * That is a terrible thing to put in front of a user, who thinks "I owe five
 * thousand baht", not "my card is negative five thousand". So every figure this
 * module returns is flipped once, here, at the boundary: **positive means owed**
 * on `currentBalance`, `statementBalance`, `unbilledBalance` and friends. The
 * UI never negates anything, and nothing downstream has to remember which way
 * round a given number is.
 *
 * The one signed figure is `availableCredit`, which can legitimately go
 * negative when a card is over its limit, and that is worth showing as such.
 *
 * ---------------------------------------------------------------------------
 * HOW A CHARGE, A REFUND AND A PAYMENT ARE TOLD APART
 * ---------------------------------------------------------------------------
 * Nothing new is stored for this. The existing transaction types already say
 * it, once you read them from the card's point of view:
 *
 *   expense on the card              charge          debt up
 *   transfer OUT of the card         cash advance    debt up
 *   transfer INTO the card           bill payment    debt down
 *   income on the card               refund/credit   debt down
 *
 * Which is why "Pay Bill" needs no new endpoint and no new row type: it is an
 * ordinary transfer from a cash wallet, and a transfer is neither income nor
 * expense, so paying a card off never double-counts as spending.
 */

import { Transaction, WalletBalance } from '../types';
import { todayKey } from './format';

/* ------------------------------------------------------------------ */
/* Cycle arithmetic                                                    */
/* ------------------------------------------------------------------ */

/** `YYYY-MM-DD` -> the parts, or null when it is not a usable date key. */
function parseKey(dateKey: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? '').trim());
  if (!match) return null;
  return { year: Number(match[1]), month: Number(match[2]), day: Number(match[3]) };
}

function toKey(year: number, monthIndex: number, day: number): string {
  const date = new Date(year, monthIndex, day);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

/**
 * The billing day `day` as it actually falls in a given month.
 *
 * A card that closes on the 31st has no 31st in February. Clamping to the
 * month's last day is what every issuer does, and it is why the day is stored
 * as 1-31 rather than being clamped on the way in: the user's "the 31st" has
 * to mean the 28th in February and the 31st again in March, which a stored
 * clamp would have destroyed.
 */
export function cycleDayInMonth(year: number, monthIndex: number, day: number): string {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return toKey(year, monthIndex, Math.min(Math.max(1, Math.round(day)), lastDay));
}

/**
 * The most recent statement close on or before `today`, and the one before it.
 *
 * "On or before" matters: a statement closing today has closed. Charges made
 * today land on it, which is what the bank's own cut-off does.
 */
export function statementWindow(
  statementDay: number,
  today = todayKey(),
): { lastClose: string; previousClose: string; nextClose: string } | null {
  const now = parseKey(today);
  if (!now || !(statementDay >= 1)) return null;

  const monthIndex = now.month - 1;
  const thisMonthClose = cycleDayInMonth(now.year, monthIndex, statementDay);

  // Before this month's close, the last one that happened was last month's.
  const closedThisMonth = thisMonthClose <= today;
  const lastIndex = closedThisMonth ? monthIndex : monthIndex - 1;

  return {
    lastClose: cycleDayInMonth(now.year, lastIndex, statementDay),
    previousClose: cycleDayInMonth(now.year, lastIndex - 1, statementDay),
    nextClose: cycleDayInMonth(now.year, lastIndex + 1, statementDay),
  };
}

/**
 * When the balance that closed on `lastClose` falls due.
 *
 * The rule is "the next `dueDay` strictly after the close". Both orderings are
 * normal and both are handled by it: a card closing on the 25th and due on the
 * 15th is due the following month, while one closing on the 5th and due on the
 * 25th is due in the same month.
 */
export function dueDateFor(lastClose: string, dueDay: number): string | null {
  const close = parseKey(lastClose);
  if (!close || !(dueDay >= 1)) return null;

  const monthIndex = close.month - 1;
  const sameMonth = cycleDayInMonth(close.year, monthIndex, dueDay);
  return sameMonth > lastClose ? sameMonth : cycleDayInMonth(close.year, monthIndex + 1, dueDay);
}

/** Whole days from `from` to `to`. Negative once `to` is in the past. */
export function daysBetween(from: string, to: string): number {
  const a = parseKey(from);
  const b = parseKey(to);
  if (!a || !b) return 0;
  const start = new Date(a.year, a.month - 1, a.day).getTime();
  const end = new Date(b.year, b.month - 1, b.day).getTime();
  return Math.round((end - start) / 86_400_000);
}

/* ------------------------------------------------------------------ */
/* Per-transaction effect                                              */
/* ------------------------------------------------------------------ */

/**
 * What one row does to a card's debt, in the user's sign convention.
 *
 * Positive = the debt grew. Rows that do not touch this card return 0, so the
 * caller can map over an unfiltered ledger.
 */
export function debtEffect(tx: Transaction, walletId: string): number {
  const amount = Number(tx.amount) || 0;

  if (tx.walletId === walletId) {
    if (tx.type === 'expense') return amount; // charge
    if (tx.type === 'income') return -amount; // refund posted to the card
    if (tx.type === 'transfer') return amount; // cash advance out of the card
  }
  // A transfer whose destination is the card is a bill payment.
  if (tx.type === 'transfer' && tx.toWalletId === walletId) return -amount;

  return 0;
}

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Card state                                                          */
/* ------------------------------------------------------------------ */

export interface CardState {
  wallet: WalletBalance;

  /** Owed today, positive. Excludes chunks of a plan not yet dated. */
  currentBalance: number;
  /**
   * The part of `currentBalance` that closed on the last statement — the
   * figure the bank wants by `dueDate`. Never negative.
   */
  statementBalance: number;
  /** Posted since the last close. Negative when the card is in credit. */
  unbilledBalance: number;
  /**
   * Future-dated charges: the remaining chunks of every installment plan.
   *
   * Held apart from `unbilledBalance` because it answers a different question.
   * Unbilled is "what will appear on the next statement"; this is "what I have
   * already committed to on statements after that".
   */
  scheduledBalance: number;
  /** `currentBalance + scheduledBalance` — everything owed to the issuer. */
  totalCommitted: number;

  /** `creditLimit - totalCommitted`. Signed: negative means over the limit. */
  availableCredit: number;
  /**
   * Percent of the limit used, against `totalCommitted` rather than
   * `currentBalance`. A bank holds the whole installment plan against the
   * limit, so counting only the posted part would tell the user they have
   * headroom the card will refuse to give them.
   *
   * 0 when no limit is set, which `hasLimit` distinguishes from a genuine 0%.
   */
  utilization: number;
  hasLimit: boolean;

  /** Null when the card has no statement day set. */
  lastStatementDate: string | null;
  nextStatementDate: string | null;
  /** When `statementBalance` falls due. Null without both cycle days. */
  paymentDueDate: string | null;
  /** Days until `paymentDueDate`. Negative once it has passed. */
  daysUntilDue: number | null;
  /** Owed, due within the warning window, and not yet overdue. */
  dueSoon: boolean;
  overdue: boolean;

  /** Rows that touched this card, newest first. */
  transactions: Transaction[];
}

/** How many days ahead counts as "due soon". Three, per the brief. */
export const DUE_SOON_DAYS = 3;

/**
 * Everything the card UI needs, from one wallet and the ledger.
 *
 * ---------------------------------------------------------------------------
 * HOW PAYMENTS ARE ALLOCATED, AND WHY NOT BY DATE
 * ---------------------------------------------------------------------------
 * Charges bucket by their own date — before the last close is billed, after it
 * is unbilled — but payments do **not**. They are applied oldest-debt-first:
 * against the billed balance until it is clear, then against unbilled.
 *
 * Bucketing payments by date instead would break the ordinary case. A statement
 * closes on the 25th and you pay it on the 5th; that payment is dated after the
 * close, so a date bucket would file it under "unbilled", leaving the statement
 * still demanding money you have already sent and the unbilled figure sitting
 * at a nonsense negative. Oldest-first is both what the issuer does and the
 * only allocation under which "Pay Bill" visibly zeroes the thing it paid.
 */
export function computeCardState(
  wallet: WalletBalance,
  transactions: Transaction[],
  today = todayKey(),
): CardState {
  const window = wallet.statementDate >= 1 ? statementWindow(wallet.statementDate, today) : null;
  const lastClose = window?.lastClose ?? null;

  /* An opening balance predates every transaction, so it is billed debt by
     definition — it is the balance the user carried in when they created the
     wallet. Stored negative like any other debt, hence the flip. */
  let billedCharges = Math.max(0, -(Number(wallet.openingBalance) || 0));
  let unbilledCharges = 0;
  let scheduledCharges = 0;
  let payments = 0;

  const mine: Transaction[] = [];

  for (const tx of transactions) {
    const effect = debtEffect(tx, wallet.id);
    if (effect === 0 && tx.walletId !== wallet.id && tx.toWalletId !== wallet.id) continue;
    mine.push(tx);

    if (effect < 0) {
      payments += -effect;
      continue;
    }

    const date = String(tx.date ?? '');
    if (date > today) scheduledCharges += effect;
    else if (lastClose && date <= lastClose) billedCharges += effect;
    else unbilledCharges += effect;
  }

  /* Without a statement day there is no cycle to split on, so everything posted
     is "unbilled" and nothing is ever demanded by a due date. Treating the
     whole balance as a statement balance instead would raise a payment-due
     warning for a card the user never told us the dates of. */
  const statementBalance = lastClose ? Math.max(0, billedCharges - payments) : 0;
  const paymentSurplus = Math.max(0, payments - (lastClose ? billedCharges : 0));
  const unbilledBalance = lastClose
    ? unbilledCharges - paymentSurplus
    : billedCharges + unbilledCharges - payments;

  const currentBalance = statementBalance + unbilledBalance;
  const scheduledBalance = scheduledCharges;
  const totalCommitted = currentBalance + scheduledBalance;

  const hasLimit = (Number(wallet.creditLimit) || 0) > 0;
  const availableCredit = (Number(wallet.creditLimit) || 0) - totalCommitted;

  const paymentDueDate =
    lastClose && wallet.dueDate >= 1 ? dueDateFor(lastClose, wallet.dueDate) : null;
  const daysUntilDue = paymentDueDate ? daysBetween(today, paymentDueDate) : null;

  const owes = statementBalance > 0.005;

  return {
    wallet,
    currentBalance: round2(currentBalance),
    statementBalance: round2(statementBalance),
    unbilledBalance: round2(unbilledBalance),
    scheduledBalance: round2(scheduledBalance),
    totalCommitted: round2(totalCommitted),
    availableCredit: round2(availableCredit),
    utilization: hasLimit ? round2((totalCommitted / wallet.creditLimit) * 100) : 0,
    hasLimit,
    lastStatementDate: lastClose,
    nextStatementDate: window?.nextClose ?? null,
    paymentDueDate,
    daysUntilDue,
    dueSoon: owes && daysUntilDue !== null && daysUntilDue >= 0 && daysUntilDue <= DUE_SOON_DAYS,
    overdue: owes && daysUntilDue !== null && daysUntilDue < 0,
    transactions: mine.sort((a, b) =>
      `${b.date}${b.createdAt}`.localeCompare(`${a.date}${a.createdAt}`),
    ),
  };
}

/* ------------------------------------------------------------------ */
/* Portfolio-level roll-up                                             */
/* ------------------------------------------------------------------ */

export interface DebtSummary {
  /** Owed across every card, positive. */
  totalDebt: number;
  /** Owed and already billed — the amount with a due date attached. */
  totalStatementBalance: number;
  /** Committed but not yet posted: remaining installment chunks. */
  totalScheduled: number;
  totalLimit: number;
  totalAvailable: number;
  /** Percent of the combined limit in use. 0 when no card has a limit. */
  utilization: number;
  /** Cards owing money with a due date inside the warning window. */
  dueSoon: CardState[];
  overdue: CardState[];
}

export function summarizeDebt(cards: CardState[]): DebtSummary {
  let totalDebt = 0;
  let totalStatementBalance = 0;
  let totalScheduled = 0;
  let totalLimit = 0;

  for (const card of cards) {
    // Clamped at zero: a card in credit is not negative debt to be netted off
    // against another card's balance, it is just a card you do not owe on.
    totalDebt += Math.max(0, card.currentBalance);
    totalStatementBalance += card.statementBalance;
    totalScheduled += card.scheduledBalance;
    totalLimit += Number(card.wallet.creditLimit) || 0;
  }

  const committed = totalDebt + totalScheduled;

  return {
    totalDebt: round2(totalDebt),
    totalStatementBalance: round2(totalStatementBalance),
    totalScheduled: round2(totalScheduled),
    totalLimit: round2(totalLimit),
    totalAvailable: round2(totalLimit - committed),
    utilization: totalLimit > 0 ? round2((committed / totalLimit) * 100) : 0,
    dueSoon: cards.filter((card) => card.dueSoon),
    overdue: cards.filter((card) => card.overdue),
  };
}

/**
 * Cash you could spend today and still clear every card.
 *
 * Deliberately the same definition the server puts on the dashboard as
 * `safeToSpend`, so the Cards page and the Overview cannot disagree. Scheduled
 * installment chunks are excluded: they are next month's problem, and counting
 * them here would tell someone they cannot afford lunch because of a phone they
 * are paying off over a year.
 */
export function safeToSpend(wallets: WalletBalance[]): number {
  let cash = 0;
  let debt = 0;

  for (const wallet of wallets) {
    if (wallet.archived || wallet.mode !== 'expense') continue;
    if (wallet.type === 'CREDIT') debt += Math.max(0, -wallet.balance);
    else cash += wallet.balance;
  }

  return round2(cash - debt);
}

/* ------------------------------------------------------------------ */
/* Utilisation presentation                                            */
/* ------------------------------------------------------------------ */

/**
 * The band a utilisation figure falls in.
 *
 * 30% is the threshold credit scoring actually uses, so it is the one worth
 * warning at rather than an arbitrary two-thirds. Over the limit is its own
 * state because it is a different problem from merely high.
 */
export type UtilizationTone = 'ok' | 'warning' | 'over';

export function utilizationTone(percent: number): UtilizationTone {
  if (percent >= 100) return 'over';
  if (percent >= 30) return 'warning';
  return 'ok';
}

/** Is this wallet a credit card? The single place the check is spelled out. */
export function isCreditWallet(wallet: Pick<WalletBalance, 'type'>): boolean {
  return wallet.type === 'CREDIT';
}
