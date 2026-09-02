/**
 * Monthly cash-flow aggregation for the "Income vs spending" card.
 *
 * The dashboard summary already carries a six-month `trend`, but it is a
 * server-side rollup: fixed length, no counts, no way to reach a longer
 * history. This builds the same shape from the raw transaction rows instead,
 * so the card can show a full year, say how many rows each month is made of,
 * and stay correct the moment an optimistic write lands in the cache.
 *
 * The server rollup is still useful as a `fallback`: it is already on screen
 * when the dashboard paints, so the chart can draw six real months while the
 * twelve-month transaction window is still in flight, then swap.
 *
 * Transfers are excluded on purpose. Moving money between two of your own
 * wallets is neither income nor spending, and counting it would inflate both
 * series by the same amount — the server rollup makes the same call.
 */

import { shiftPeriod } from './format';
import { Transaction } from '../types';

/** Just enough of `DashboardSummary['trend']` to stand in while rows load. */
export interface TrendPoint {
  period: string;
  income: number;
  expense: number;
}

export interface MonthPoint {
  /** `YYYY-MM`. */
  period: string;
  /** Axis tick — "Mar". Unambiguous because a window never repeats a month. */
  label: string;
  /** Tooltip heading — "March 2026". */
  labelLong: string;
  income: number;
  expense: number;
  net: number;
  /** Rows behind the point. 0 when it came from the server rollup. */
  count: number;
}

export interface SeriesStats {
  /** Best month for this series, or null when nothing is recorded. */
  max: MonthPoint | null;
  min: MonthPoint | null;
  /** Mean over the months that had activity — see `sampleSize`. */
  mean: number;
  total: number;
}

export interface MonthlyCashFlow {
  points: MonthPoint[];
  income: SeriesStats;
  expense: SeriesStats;
  /**
   * How many months the statistics were averaged over.
   *
   * Only months with some activity count. A wallet opened in June should not
   * have its average halved by five empty months that predate it, and those
   * months would otherwise win "lowest" every time.
   */
  sampleSize: number;
  hasData: boolean;
  /** Which input the numbers came from — the card says so in its subtitle. */
  source: 'transactions' | 'summary';
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Cents, not float dust: 0.1 + 0.2 has no place on an axis. */
const round2 = (value: number) => Math.round(value * 100) / 100;

/** The `months` periods ending at `period`, oldest first. */
export function periodWindow(period: string, months: number): string[] {
  const span = Math.max(1, Math.floor(months));
  return Array.from({ length: span }, (_, i) => shiftPeriod(period, i - (span - 1)));
}

/**
 * The `from`/`to` date filter that fetches exactly this window.
 *
 * `to` is capped at the end of `period` rather than left open so that paging
 * the dashboard back to an earlier month narrows the request instead of always
 * pulling everything up to today.
 */
export function periodRange(period: string, months: number): { from: string; to: string } {
  const first = periodWindow(period, months)[0];
  const [year, month] = period.split('-').map(Number);
  // Day 0 of the next month is the last day of this one — no leap-year table.
  const last = new Date(year, month, 0);
  return {
    from: `${first}-01`,
    to: `${last.getFullYear()}-${pad(last.getMonth() + 1)}-${pad(last.getDate())}`,
  };
}

function labelsFor(period: string, locale: string): { label: string; labelLong: string } {
  const [year, month] = period.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return { label: period, labelLong: period };
  }
  const date = new Date(year, month - 1, 1);
  return {
    label: date.toLocaleDateString(locale, { month: 'short' }),
    labelLong: date.toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
  };
}

function statsFor(points: MonthPoint[], pick: (p: MonthPoint) => number): SeriesStats {
  if (points.length === 0) return { max: null, min: null, mean: 0, total: 0 };

  let max = points[0];
  let min = points[0];
  let total = 0;

  for (const point of points) {
    const value = pick(point);
    total += value;
    if (value > pick(max)) max = point;
    if (value < pick(min)) min = point;
  }

  return {
    max,
    min,
    mean: round2(total / points.length),
    total: round2(total),
  };
}

/**
 * Groups transactions into one point per month across the window ending at
 * `period`, then derives max / mean / min for each series.
 *
 * Leading empty months are trimmed — history that predates the first recorded
 * transaction is not data, it is padding, and it flattens the whole chart.
 * Trailing empty months are kept: "nothing spent yet this month" is a fact.
 */
export function buildMonthlyCashFlow(
  transactions: Transaction[],
  options: { period: string; months: number; locale?: string; fallback?: TrendPoint[] },
): MonthlyCashFlow {
  const { period, months, locale = 'en-US', fallback } = options;
  const window = periodWindow(period, months);
  const index = new Map(window.map((key, i) => [key, i]));

  const income = new Array<number>(window.length).fill(0);
  const expense = new Array<number>(window.length).fill(0);
  const counts = new Array<number>(window.length).fill(0);
  let counted = 0;

  for (const tx of transactions) {
    if (tx.type === 'transfer') continue;
    const slot = index.get(String(tx.date ?? '').slice(0, 7));
    if (slot === undefined) continue;
    const amount = Number(tx.amount) || 0;
    if (tx.type === 'income') income[slot] += amount;
    else expense[slot] += amount;
    counts[slot] += 1;
    counted += 1;
  }

  // Nothing landed in the window: either the rows are still loading or this
  // user genuinely has none. The server rollup can answer the first case.
  const summary = fallback?.filter((row) => index.has(row.period)) ?? [];
  const useSummary = counted === 0 && summary.some((row) => row.income > 0 || row.expense > 0);

  if (useSummary) {
    for (const row of summary) {
      const slot = index.get(row.period)!;
      income[slot] = Number(row.income) || 0;
      expense[slot] = Number(row.expense) || 0;
    }
  }

  const all: MonthPoint[] = window.map((key, i) => ({
    period: key,
    ...labelsFor(key, locale),
    income: round2(income[i]),
    expense: round2(expense[i]),
    net: round2(income[i] - expense[i]),
    count: useSummary ? 0 : counts[i],
  }));

  const firstActive = all.findIndex((p) => p.income > 0 || p.expense > 0);
  const points = firstActive === -1 ? [] : all.slice(firstActive);
  const active = points.filter((p) => p.income > 0 || p.expense > 0);

  return {
    points,
    income: statsFor(active, (p) => p.income),
    expense: statsFor(active, (p) => p.expense),
    sampleSize: active.length,
    hasData: active.length > 0,
    source: useSummary ? 'summary' : 'transactions',
  };
}
