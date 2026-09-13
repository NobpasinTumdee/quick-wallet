import { advanceDueDate } from './recurrence';
import { BillSplit, Debt, Subscription, Transaction } from '../types';

/**
 * A month of committed outgoings, laid out day by day.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS IS FOR
 * ---------------------------------------------------------------------------
 * Not "what did I spend" — that is the spending heatmap on the Analytics
 * screen, and it looks backwards. This looks *forwards*: money already promised
 * to somebody, on the day it is promised. The question it answers is whether
 * those promises are spread across the month or stacked on a Tuesday.
 *
 * ---------------------------------------------------------------------------
 * WHY BILL SPLITS DO NOT ADD HEAT
 * ---------------------------------------------------------------------------
 * They are the one input here that points the other way. In this app a bill
 * split is always a bill *the user paid* and other people owe a share of, so
 * `outstanding` is money coming back, not money going out. Adding it to a day's
 * total would tell somebody they owe money they are in fact owed, which is
 * exactly the wrong warning to give on a screen built to warn people.
 *
 * They are also undated: the schema has `createdAt` and a status, and nothing
 * that says when a share is expected. Placing them on the grid would mean
 * inventing a due date and drawing it as though it were real.
 *
 * So they are carried, because they genuinely change the month's cash picture —
 * as a separate `expectedBack` figure the insights panel shows beside the
 * liabilities, never mixed into them.
 */

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export type LiabilityKind = 'subscription' | 'card' | 'debt' | 'installment';

/** One thing falling due on one day. */
export interface LiabilityItem {
  /** Unique within the month — a weekly bill appears four times. */
  key: string;
  kind: LiabilityKind;
  name: string;
  amount: number;
  /** `YYYY-MM-DD`. */
  date: string;
}

/**
 * How loud a day is drawn.
 *
 * Four steps rather than a continuous ramp because the brief asks for three
 * distinct readings — quiet, watch this, and danger — and a reader cannot tell
 * 0.55 from 0.62 of an opacity anyway. The continuous value is kept alongside
 * as `intensity` for the tint; the level is what earns the red.
 */
export type HeatLevel = 'none' | 'low' | 'medium' | 'high';

export interface HeatmapDay {
  day: number;
  date: string;
  /** 0 = Sunday. */
  weekday: number;
  total: number;
  items: LiabilityItem[];
  /** `total / heaviestDay`, 0…1. The tint. */
  intensity: number;
  level: HeatLevel;
  isPayday: boolean;
  isToday: boolean;
  /** Before today, in the current month. Always false in other months. */
  isPast: boolean;
}

export interface WeekSummary {
  /** 1-based, and it is a *row of the grid*, not days 1-7. */
  index: number;
  startDay: number;
  endDay: number;
  total: number;
  count: number;
}

export interface LiabilityMonth {
  period: string;
  daysInMonth: number;
  /** Empty cells before the 1st, so the grid lines up under its weekday row. */
  leadingBlanks: number;
  days: HeatmapDay[];
  weeks: WeekSummary[];
  /** The heaviest week, or null when the month is empty. */
  peakWeek: WeekSummary | null;
  peakDay: HeatmapDay | null;

  total: number;
  subscriptionTotal: number;
  cardTotal: number;
  /** How many separate bills fall in the month. */
  billCount: number;

  /** Open bill splits — money expected *in*. Never part of `total`. */
  expectedBack: number;
  openSplitCount: number;

  /** Every configured payday that exists in this month, ascending. */
  paydays: number[];
  /**
   * Due strictly before the *first* payday — the stretch you fund out of last
   * month's balance, and the original reason this anchor exists.
   */
  beforePayday: number;
  /** Everything from the first payday onward. */
  afterPayday: number;
  /**
   * The month cut at each payday.
   *
   * A single before/after split stops meaning anything once there are two
   * paydays: with the 1st and the 16th, "after payday" is almost the whole
   * month and says nothing. Segmenting instead keeps the reading honest —
   * each period is a stretch of bills funded by one specific pay cheque.
   */
  payPeriods: PayPeriod[];
  /** The costliest stretch, or null when nothing is due. */
  peakPayPeriod: PayPeriod | null;
}

/** One stretch of the month, funded by one pay cheque. */
export interface PayPeriod {
  /** The payday that funds it, or null for the run-up to the first one. */
  fundedBy: number | null;
  startDay: number;
  endDay: number;
  total: number;
  count: number;
}

export interface LiabilityInput {
  /** `YYYY-MM`. */
  period: string;
  subscriptions: Subscription[];
  /** Cards with a computed statement due inside this month. */
  cardBills: CardBill[];
  billSplits: BillSplit[];
  /** Days of the month a salary lands. Out-of-range entries are ignored. */
  paydays?: number[] | null;
  /** `YYYY-MM-DD`. Drives `isToday` / `isPast`. */
  today?: string;
}

/**
 * A card's statement, already resolved to a date and an amount.
 *
 * Passed in rather than derived here because working it out needs the whole
 * ledger and the billing-cycle rules, both of which `creditMath` already owns.
 * Re-deriving it would be a second implementation of the statement boundary.
 */
export interface CardBill {
  walletId: string;
  name: string;
  amount: number;
  /** `YYYY-MM-DD`, from `CardState.paymentDueDate`. */
  dueDate: string;
}

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

function parsePeriod(period: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period ?? '').trim());
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) return null;
  return { year, month };
}

function dayOf(dateKey: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? '').trim());
  return match ? Number(match[3]) : null;
}

/** True when `YYYY-MM-DD` falls inside `YYYY-MM`. */
function inPeriod(dateKey: string, period: string): boolean {
  return String(dateKey ?? '').slice(0, 7) === period;
}

const money = (value: number): number => Math.round((Number(value) || 0) * 100) / 100;

/* ------------------------------------------------------------------ */
/* Projection                                                          */
/* ------------------------------------------------------------------ */

/**
 * Every time `subscription` falls due inside `period`.
 *
 * A subscription stores one `nextDueDate` and a frequency, so the occurrences
 * in any given month have to be walked to. Weekly bills hit four or five times
 * and monthly ones once; a yearly bill usually contributes nothing, which is
 * the case that makes "just read nextDueDate" wrong.
 *
 * Walking starts from `nextDueDate` and only ever goes forward, which is
 * deliberate: a monthly bill whose next due date is in October was already paid
 * for September, and back-projecting it would resurrect a settled bill as a
 * warning.
 */
export function subscriptionOccurrences(subscription: Subscription, period: string): string[] {
  const parsed = parsePeriod(period);
  if (!parsed) return [];

  const start = `${period}-01`;
  const daysInMonth = new Date(parsed.year, parsed.month, 0).getDate();
  const end = `${period}-${String(daysInMonth).padStart(2, '0')}`;

  let cursor = String(subscription.nextDueDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cursor)) return [];

  const dates: string[] = [];
  /* Bounded so a malformed frequency cannot spin: 31 is more occurrences than
     any supported cycle can produce in one month, weekly included. */
  for (let guard = 0; guard < 64 && cursor <= end; guard += 1) {
    if (cursor >= start) dates.push(cursor);
    const next = advanceDueDate(cursor, subscription.frequency);
    // A frequency that fails to advance would loop forever.
    if (next <= cursor) break;
    cursor = next;
    if (dates.length >= 31) break;
  }

  return dates;
}

/**
 * The four-step scale.
 *
 * Two signals, because the brief names two: how much lands, and how many
 * separate bills land. They are combined against the *mean billed day* rather
 * than against an absolute sum, since a threshold in baht would be wrong in
 * every other currency and wrong for every other income.
 *
 *   concentration = this day / the average day that has any bill at all
 *
 * Anchoring to the mean rather than the peak is what stops a quiet month
 * turning red: if one bill is the only bill, its concentration is exactly 1 and
 * it reads medium, not danger. Danger is reserved for a day genuinely heavier
 * than the month's own normal, or one with three bills stacked on it.
 */
export function heatLevel(total: number, count: number, meanBilledDay: number): HeatLevel {
  if (total <= 0 || count === 0) return 'none';

  const concentration = meanBilledDay > 0 ? total / meanBilledDay : 1;

  if (count >= 3) return 'high';
  if (concentration >= 2.5) return 'high';
  if (concentration >= 1.6 && count >= 2) return 'high';

  if (count === 2) return 'medium';
  if (concentration >= 1) return 'medium';

  return 'low';
}

/* ------------------------------------------------------------------ */
/* The engine                                                          */
/* ------------------------------------------------------------------ */

export function buildLiabilityMonth(input: LiabilityInput): LiabilityMonth {
  const { period, subscriptions, cardBills, billSplits, today } = input;
  const parsed = parsePeriod(period);

  const daysInMonth = parsed ? new Date(parsed.year, parsed.month, 0).getDate() : 0;
  /* A payday past the end of a short month is dropped rather than clamped: a
     salary set for the 31st does not arrive on the 28th of February, and
     drawing a marker there would be inventing one. */
  const paydays = Array.from(
    new Set(
      (input.paydays ?? [])
        .map((day) => Math.round(Number(day)))
        .filter((day) => Number.isFinite(day) && day >= 1 && day <= daysInMonth),
    ),
  ).sort((a, b) => a - b);
  const paydaySet = new Set(paydays);

  const buckets: LiabilityItem[][] = Array.from({ length: daysInMonth }, () => []);

  /* ---- Subscriptions ---- */
  let subscriptionTotal = 0;
  for (const subscription of subscriptions) {
    const amount = money(subscription.amount);
    if (amount <= 0) continue;

    for (const date of subscriptionOccurrences(subscription, period)) {
      const day = dayOf(date);
      if (!day || day > daysInMonth) continue;
      buckets[day - 1].push({
        // The date is in the key because a weekly bill lands more than once.
        key: `sub:${subscription.id}:${date}`,
        kind: 'subscription',
        name: subscription.name,
        amount,
        date,
      });
      subscriptionTotal += amount;
    }
  }

  /* ---- Card statements ---- */
  let cardTotal = 0;
  for (const bill of cardBills) {
    const amount = money(bill.amount);
    if (amount <= 0) continue;
    if (!inPeriod(bill.dueDate, period)) continue;

    const day = dayOf(bill.dueDate);
    if (!day || day > daysInMonth) continue;

    buckets[day - 1].push({
      key: `card:${bill.walletId}:${bill.dueDate}`,
      kind: 'card',
      name: bill.name,
      amount,
      date: bill.dueDate,
    });
    cardTotal += amount;
  }

  /* ---- Bill splits: money back, deliberately not heat. See the header. ---- */
  let expectedBack = 0;
  let openSplitCount = 0;
  for (const split of billSplits) {
    if (split.status !== 'open') continue;
    const outstanding = money(split.outstanding);
    if (outstanding <= 0) continue;
    expectedBack += outstanding;
    openSplitCount += 1;
  }

  /* ---- Days ---- */
  const totals = buckets.map((items) => money(items.reduce((sum, item) => sum + item.amount, 0)));
  const total = money(totals.reduce((sum, value) => sum + value, 0));
  const billedDays = totals.filter((value) => value > 0);
  const meanBilledDay = billedDays.length ? total / billedDays.length : 0;
  const peak = billedDays.length ? Math.max(...billedDays) : 0;

  const firstWeekday = parsed ? new Date(parsed.year, parsed.month - 1, 1).getDay() : 0;

  const days: HeatmapDay[] = buckets.map((items, index) => {
    const day = index + 1;
    const date = `${period}-${String(day).padStart(2, '0')}`;
    const dayTotal = totals[index];

    // Newest first reads better in the popover: the biggest bill is the reason
    // the day is coloured, so it should not be third in the list.
    const sorted = [...items].sort((a, b) => b.amount - a.amount);

    return {
      day,
      date,
      weekday: (firstWeekday + index) % 7,
      total: dayTotal,
      items: sorted,
      intensity: peak > 0 ? dayTotal / peak : 0,
      level: heatLevel(dayTotal, items.length, meanBilledDay),
      isPayday: paydaySet.has(day),
      isToday: today === date,
      isPast: Boolean(today) && date < String(today),
    };
  });

  /* ---- Weeks: rows of the grid, so "week 2" is the row the reader sees ---- */
  const weeks: WeekSummary[] = [];
  if (days.length) {
    let row: HeatmapDay[] = [];
    for (const day of days) {
      row.push(day);
      // A row ends on Saturday, or when the month runs out.
      if (day.weekday === 6 || day.day === daysInMonth) {
        weeks.push({
          index: weeks.length + 1,
          startDay: row[0].day,
          endDay: row[row.length - 1].day,
          total: money(row.reduce((sum, d) => sum + d.total, 0)),
          count: row.reduce((sum, d) => sum + d.items.length, 0),
        });
        row = [];
      }
    }
  }

  const peakWeek = weeks.reduce<WeekSummary | null>(
    (best, week) => (week.total > 0 && (!best || week.total > best.total) ? week : best),
    null,
  );
  const peakDay = days.reduce<HeatmapDay | null>(
    (best, day) => (day.total > 0 && (!best || day.total > best.total) ? day : best),
    null,
  );

  /* Cut the month at each payday. The leading segment — days before the first
     one — is the stretch funded from last month's balance, which is the reading
     the single-payday version gave and the one worth keeping. */
  const payPeriods: PayPeriod[] = [];
  if (days.length && paydays.length) {
    const bounds = [1, ...paydays];
    for (let i = 0; i < bounds.length; i += 1) {
      const startDay = bounds[i];
      const endDay = i + 1 < bounds.length ? bounds[i + 1] - 1 : daysInMonth;
      // The leading segment is empty when a payday falls on the 1st.
      if (endDay < startDay) continue;
      const slice = days.slice(startDay - 1, endDay);
      payPeriods.push({
        fundedBy: i === 0 && paydays[0] > 1 ? null : bounds[i],
        startDay,
        endDay,
        total: money(slice.reduce((sum, d) => sum + d.total, 0)),
        count: slice.reduce((sum, d) => sum + d.items.length, 0),
      });
    }
  }

  const peakPayPeriod = payPeriods.reduce<PayPeriod | null>(
    (best, period) => (period.total > 0 && (!best || period.total > best.total) ? period : best),
    null,
  );

  const firstPayday = paydays[0] ?? null;
  const beforePayday = firstPayday
    ? money(days.filter((d) => d.day < firstPayday).reduce((sum, d) => sum + d.total, 0))
    : 0;

  return {
    period,
    daysInMonth,
    leadingBlanks: firstWeekday,
    days,
    weeks,
    peakWeek,
    peakDay,
    total,
    subscriptionTotal: money(subscriptionTotal),
    cardTotal: money(cardTotal),
    billCount: days.reduce((sum, d) => sum + d.items.length, 0),
    expectedBack: money(expectedBack),
    openSplitCount,
    paydays,
    beforePayday,
    afterPayday: money(total - beforePayday),
    payPeriods,
    peakPayPeriod,
  };
}

/* ------------------------------------------------------------------ */
/* The year view                                                       */
/* ------------------------------------------------------------------ */

/**
 * A whole year of committed outgoings, laid out as a contribution graph.
 *
 * ---------------------------------------------------------------------------
 * WHY A YEAR IS A DIFFERENT VIEW AND NOT A LONGER MONTH
 * ---------------------------------------------------------------------------
 * The month view answers "what does this month look like" and is read by date:
 * you look for the 14th. A year is not read that way — nobody scans 365 labelled
 * cells — it is read as a *shape*, for the clusters and the quiet stretches. So
 * the layout inverts: weeks become columns, weekdays become rows, dates
 * disappear, and the cell shrinks to the smallest square that still holds a
 * colour. That is what a contribution graph is, and it is the right form for
 * the question.
 *
 * ---------------------------------------------------------------------------
 * WHAT CAN HONESTLY BE PROJECTED A YEAR OUT, AND WHAT CANNOT
 * ---------------------------------------------------------------------------
 * Three of the four sources are genuinely knowable that far ahead, because they
 * are commitments already made:
 *
 *   - subscriptions, by walking `nextDueDate` forward on its own cycle
 *   - debt minimum payments, which fall on a fixed day every month
 *   - installment plans, which are already *written* as future-dated ledger
 *     rows, so they are read rather than predicted
 *
 * Credit-card statements are the exception and are deliberately not projected.
 * A statement balance is a function of spending that has not happened yet;
 * inventing twelve of them would fill the graph with confident-looking figures
 * that are guesses. Only the one real computed `paymentDueDate` is placed, and
 * the UI says the rest are absent rather than pretending they are zero.
 */

/** How the twelve months are anchored. Rolling forward, not a calendar year. */
export const YEAR_MONTHS = 12;

export interface WeekColumn {
  /** Monday-free: index 0 is the week's Sunday, matching the month grid. */
  days: (HeatmapDay | null)[];
  /** `YYYY-MM-DD` of the first real day in the column. */
  startDate: string;
  /** Set when this column is the first of a month — drives the label row. */
  monthLabel: string | null;
}

export interface MonthTotal {
  /** `YYYY-MM`. */
  period: string;
  total: number;
  count: number;
}

export interface LiabilityYear {
  from: string;
  to: string;
  days: HeatmapDay[];
  /** Week columns, left to right. Seven rows each, padded with nulls. */
  columns: WeekColumn[];
  /** Per-month roll-ups, for the summary line and the peak reading. */
  months: MonthTotal[];
  peakMonth: MonthTotal | null;
  peakDay: HeatmapDay | null;

  total: number;
  subscriptionTotal: number;
  cardTotal: number;
  debtTotal: number;
  installmentTotal: number;
  billCount: number;

  expectedBack: number;
  openSplitCount: number;

  paydays: number[];
  /** True when at least one card statement could not be projected. */
  cardsUnprojected: boolean;
}

/** Adds days to a `YYYY-MM-DD`, staying in local time. */
function addDays(dateKey: string, days: number): string {
  const [year, month, day] = dateKey.split('-').map(Number);
  const date = new Date(year, month - 1, day + days);
  return toDateKey(date);
}

function toDateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(
    date.getDate(),
  ).padStart(2, '0')}`;
}

/** 0 = Sunday, for a `YYYY-MM-DD`. */
function weekdayOf(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number);
  return new Date(year, month - 1, day).getDay();
}

/**
 * Every date `subscription` falls due between `from` and `to`, inclusive.
 *
 * The month-scoped `subscriptionOccurrences` is this with a one-month window;
 * it stays as the narrower entry point because the month view and its tests
 * read better in terms of a period.
 *
 * The guard is sized for the range rather than fixed: a weekly bill produces 53
 * occurrences across a year, and the old cap of 31 — correct for one month —
 * would have silently truncated a year's projection three quarters of the way
 * through, which is the kind of bug that looks like a quiet December.
 */
export function subscriptionOccurrencesInRange(
  subscription: Subscription,
  from: string,
  to: string,
): string[] {
  let cursor = String(subscription.nextDueDate ?? '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(cursor)) return [];

  /* One per day is more than any supported cycle can produce, so this bounds a
     malformed frequency without ever truncating a real one. */
  const maxOccurrences = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000) + 1);

  const dates: string[] = [];
  for (let guard = 0; guard < maxOccurrences * 2 + 8 && cursor <= to; guard += 1) {
    if (cursor >= from) dates.push(cursor);
    const next = advanceDueDate(cursor, subscription.frequency);
    // A frequency that fails to advance would loop forever.
    if (next <= cursor) break;
    cursor = next;
    if (dates.length >= maxOccurrences) break;
  }
  return dates;
}

/**
 * When a debt's minimum payment falls due, across a range.
 *
 * A debt stores a day of the month rather than a date, so this walks the months
 * in the window and places the payment on that day in each. A day past the end
 * of a short month is skipped rather than clamped, for the same reason a payday
 * is: the 31st does not happen in February, and moving the marker would invent
 * a due date the lender never set.
 *
 * Only the *minimum* is projected. It is the one figure that is actually
 * committed; what someone chooses to overpay is not predictable and would make
 * the graph a forecast of intentions rather than obligations.
 */
export function debtOccurrencesInRange(
  debt: Debt,
  from: string,
  to: string,
): { date: string; amount: number }[] {
  const day = Math.round(Number(debt.dueDate) || 0);
  const payment = money(debt.minimumPayment);
  const balance = money(debt.currentBalance);
  if (day < 1 || day > 31 || payment <= 0 || balance <= 0) return [];

  const out: { date: string; amount: number }[] = [];
  let [year, month] = from.split('-').map(Number);
  /* Track what is still owed so the projection stops when the debt clears,
     rather than drawing payments on a loan that was paid off in March. */
  let remaining = balance;

  for (let guard = 0; guard < 400 && remaining > 0; guard += 1) {
    const daysInMonth = new Date(year, month, 0).getDate();
    if (day <= daysInMonth) {
      const date = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (date > to) break;
      if (date >= from) {
        const amount = money(Math.min(payment, remaining));
        out.push({ date, amount });
        remaining = money(remaining - amount);
      } else {
        // Before the window but still drawing down the balance.
        remaining = money(remaining - payment);
      }
    }
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
    if (`${year}-${String(month).padStart(2, '0')}-01` > to) break;
  }

  return out;
}

export interface LiabilityYearInput {
  /** First day of the window, `YYYY-MM-DD`. */
  from: string;
  /** Last day, inclusive. */
  to: string;
  subscriptions: Subscription[];
  cardBills: CardBill[];
  debts: Debt[];
  /** Future-dated installment rows, read straight from the ledger. */
  installments: Transaction[];
  billSplits: BillSplit[];
  paydays?: number[] | null;
  today?: string;
}

export function buildLiabilityYear(input: LiabilityYearInput): LiabilityYear {
  const { from, to, subscriptions, cardBills, debts, installments, billSplits, today } = input;

  const valid = /^\d{4}-\d{2}-\d{2}$/;
  if (!valid.test(from) || !valid.test(to) || from > to) {
    return emptyYear(from, to);
  }

  const buckets = new Map<string, LiabilityItem[]>();
  const push = (date: string, item: LiabilityItem) => {
    const bucket = buckets.get(date);
    if (bucket) bucket.push(item);
    else buckets.set(date, [item]);
  };

  let subscriptionTotal = 0;
  let cardTotal = 0;
  let debtTotal = 0;
  let installmentTotal = 0;

  /* ---- Subscriptions ---- */
  for (const subscription of subscriptions) {
    const amount = money(subscription.amount);
    if (amount <= 0) continue;
    for (const date of subscriptionOccurrencesInRange(subscription, from, to)) {
      push(date, {
        key: `sub:${subscription.id}:${date}`,
        kind: 'subscription',
        name: subscription.name,
        amount,
        date,
      });
      subscriptionTotal += amount;
    }
  }

  /* ---- Card statements: only the one real computed due date. See the note. */
  for (const bill of cardBills) {
    const amount = money(bill.amount);
    if (amount <= 0) continue;
    if (bill.dueDate < from || bill.dueDate > to) continue;
    push(bill.dueDate, {
      key: `card:${bill.walletId}:${bill.dueDate}`,
      kind: 'card',
      name: bill.name,
      amount,
      date: bill.dueDate,
    });
    cardTotal += amount;
  }

  /* ---- Debt minimum payments ---- */
  for (const debt of debts) {
    for (const { date, amount } of debtOccurrencesInRange(debt, from, to)) {
      push(date, {
        key: `debt:${debt.id}:${date}`,
        kind: 'debt',
        name: debt.title,
        amount,
        date,
      });
      debtTotal += amount;
    }
  }

  /* ---- Installments ----
     Read, not predicted: a plan is already n dated rows in the ledger, so these
     are facts about the future rather than a projection of one. */
  for (const row of installments) {
    if (!row.installmentGroupId) continue;
    if (row.type !== 'expense') continue;
    const amount = money(Math.abs(Number(row.amount) || 0));
    if (amount <= 0) continue;
    if (row.date < from || row.date > to) continue;
    push(row.date, {
      key: `inst:${row.id}`,
      kind: 'installment',
      name: row.note || row.category,
      amount,
      date: row.date,
    });
    installmentTotal += amount;
  }

  /* ---- Bill splits: money back, never heat. Same rule as the month view. ---- */
  let expectedBack = 0;
  let openSplitCount = 0;
  for (const split of billSplits) {
    if (split.status !== 'open') continue;
    const outstanding = money(split.outstanding);
    if (outstanding <= 0) continue;
    expectedBack += outstanding;
    openSplitCount += 1;
  }

  /* ---- Days ---- */
  const paydays = Array.from(
    new Set(
      (input.paydays ?? [])
        .map((day) => Math.round(Number(day)))
        .filter((day) => Number.isFinite(day) && day >= 1 && day <= 31),
    ),
  ).sort((a, b) => a - b);
  const paydaySet = new Set(paydays);

  const days: HeatmapDay[] = [];
  const monthMap = new Map<string, MonthTotal>();
  let total = 0;

  for (let cursor = from; cursor <= to; cursor = addDays(cursor, 1)) {
    const items = (buckets.get(cursor) ?? []).slice().sort((a, b) => b.amount - a.amount);
    const dayTotal = money(items.reduce((sum, item) => sum + item.amount, 0));
    total += dayTotal;

    const period = cursor.slice(0, 7);
    const monthEntry = monthMap.get(period) ?? { period, total: 0, count: 0 };
    monthEntry.total = money(monthEntry.total + dayTotal);
    monthEntry.count += items.length;
    monthMap.set(period, monthEntry);

    days.push({
      day: Number(cursor.slice(8, 10)),
      date: cursor,
      weekday: weekdayOf(cursor),
      total: dayTotal,
      items,
      intensity: 0,
      level: 'none',
      isPayday: paydaySet.has(Number(cursor.slice(8, 10))),
      isToday: today === cursor,
      isPast: Boolean(today) && cursor < String(today),
    });
  }

  /* Intensity and level are scaled across the *whole year*, not per month. A
     per-month scale would make a quiet February look as alarming as a heavy
     December, which is the one thing a year view exists to distinguish. */
  const billed = days.filter((d) => d.total > 0).map((d) => d.total);
  const peak = billed.length ? Math.max(...billed) : 0;
  const mean = billed.length ? billed.reduce((sum, v) => sum + v, 0) / billed.length : 0;

  for (const day of days) {
    day.intensity = peak > 0 ? day.total / peak : 0;
    day.level = heatLevel(day.total, day.items.length, mean);
  }

  /* ---- Week columns ----
     Padded at both ends so every column has seven rows and the weekday axis
     lines up: a year almost never starts on a Sunday. */
  const columns: WeekColumn[] = [];
  let column: (HeatmapDay | null)[] = Array(days[0]?.weekday ?? 0).fill(null);
  let seenMonths = new Set<string>();

  for (const day of days) {
    column.push(day);
    if (column.length === 7) {
      columns.push(finishColumn(column, seenMonths));
      column = [];
    }
  }
  if (column.length) {
    while (column.length < 7) column.push(null);
    columns.push(finishColumn(column, seenMonths));
  }

  const months = [...monthMap.values()];
  const peakMonth = months.reduce<MonthTotal | null>(
    (best, entry) => (entry.total > 0 && (!best || entry.total > best.total) ? entry : best),
    null,
  );
  const peakDay = days.reduce<HeatmapDay | null>(
    (best, day) => (day.total > 0 && (!best || day.total > best.total) ? day : best),
    null,
  );

  return {
    from,
    to,
    days,
    columns,
    months,
    peakMonth,
    peakDay,
    total: money(total),
    subscriptionTotal: money(subscriptionTotal),
    cardTotal: money(cardTotal),
    debtTotal: money(debtTotal),
    installmentTotal: money(installmentTotal),
    billCount: days.reduce((sum, d) => sum + d.items.length, 0),
    expectedBack: money(expectedBack),
    openSplitCount,
    paydays,
    /* A card with a statement due inside the window contributes exactly one
       payment across twelve months, which is a hole the UI has to admit to. */
    cardsUnprojected: cardBills.length > 0,
  };
}

/** Labels the column with its month the first time that month appears. */
function finishColumn(cells: (HeatmapDay | null)[], seen: Set<string>): WeekColumn {
  const first = cells.find((cell): cell is HeatmapDay => cell !== null);
  const startDate = first?.date ?? '';
  const period = startDate.slice(0, 7);

  let monthLabel: string | null = null;
  if (period && !seen.has(period)) {
    seen.add(period);
    monthLabel = period;
  }

  return { days: cells, startDate, monthLabel };
}

function emptyYear(from: string, to: string): LiabilityYear {
  return {
    from,
    to,
    days: [],
    columns: [],
    months: [],
    peakMonth: null,
    peakDay: null,
    total: 0,
    subscriptionTotal: 0,
    cardTotal: 0,
    debtTotal: 0,
    installmentTotal: 0,
    billCount: 0,
    expectedBack: 0,
    openSplitCount: 0,
    paydays: [],
    cardsUnprojected: false,
  };
}

/** The rolling window the year view uses: this month, plus eleven ahead. */
export function yearWindow(period: string): { from: string; to: string } {
  const match = /^(\d{4})-(\d{2})$/.exec(String(period ?? '').trim());
  if (!match) return { from: '', to: '' };
  const year = Number(match[1]);
  const month = Number(match[2]);

  const endYear = year + Math.floor((month - 1 + YEAR_MONTHS - 1) / 12);
  const endMonth = ((month - 1 + YEAR_MONTHS - 1) % 12) + 1;
  const lastDay = new Date(endYear, endMonth, 0).getDate();

  return {
    from: `${year}-${String(month).padStart(2, '0')}-01`,
    to: `${endYear}-${String(endMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`,
  };
}
