import { advanceDueDate } from './recurrence';
import { BillSplit, Subscription } from '../types';

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

export type LiabilityKind = 'subscription' | 'card';

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
