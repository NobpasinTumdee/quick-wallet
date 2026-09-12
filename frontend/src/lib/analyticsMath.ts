import { Transaction } from '../types';
import { TrendMonth } from './projectionMath';

/**
 * The arithmetic behind the Analytics screen.
 *
 * Pure, and in `lib/` for the same reason the tax bands and the DCA averaging
 * are: these are the numbers a user will act on, and they should be checkable
 * without mounting React.
 *
 * Every function here takes rows the app already has — the dashboard payload's
 * `trend`, and a window of transactions — so the whole screen costs no endpoint
 * of its own.
 */

function round2(value: number): number {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Savings rate                                                        */
/* ------------------------------------------------------------------ */

export interface SavingsRatePoint extends TrendMonth {
  /** `net / income × 100`. Negative when the month overspent. */
  ratePercent: number;
  /** No income at all — the rate is undefined, not zero. */
  undefinedRate: boolean;
}

export interface SavingsRateSeries {
  points: SavingsRatePoint[];
  /** Mean rate over months that had income. */
  averagePercent: number;
  /** How many months that mean is built from. */
  monthsUsed: number;
  /** True when at least one month spent more than it earned. */
  hasNegative: boolean;
}

/**
 * Savings rate per month.
 *
 * A month with no income is marked rather than scored. Dividing by zero income
 * gives either 0% (which reads as "saved nothing", though they may have saved
 * every baht they had) or −Infinity if they also spent — both are lies, and
 * averaging either one drags the headline figure somewhere meaningless. Those
 * months are plotted as a gap and excluded from the average.
 */
export function savingsRateSeries(trend: TrendMonth[]): SavingsRateSeries {
  const points: SavingsRatePoint[] = trend.map((month) => {
    const income = Number(month.income) || 0;
    const net = Number(month.net) || 0;
    const undefinedRate = income <= 0;

    return {
      ...month,
      ratePercent: undefinedRate ? 0 : round2((net / income) * 100),
      undefinedRate,
    };
  });

  const scored = points.filter((point) => !point.undefinedRate);
  const averagePercent = scored.length
    ? round2(scored.reduce((sum, point) => sum + point.ratePercent, 0) / scored.length)
    : 0;

  return {
    points,
    averagePercent,
    monthsUsed: scored.length,
    hasNegative: scored.some((point) => point.ratePercent < 0),
  };
}

/* ------------------------------------------------------------------ */
/* Spending heatmap                                                    */
/* ------------------------------------------------------------------ */

export interface HeatmapCell {
  /** `YYYY-MM-DD`. */
  date: string;
  /** Day of the month, 1-based. */
  day: number;
  /** 0 = Sunday, matching `Date.getDay()`. */
  weekday: number;
  total: number;
  count: number;
  /** 0…1 against the busiest day in the month. 0 when nothing was spent. */
  intensity: number;
}

export interface Heatmap {
  cells: HeatmapCell[];
  /** Blank cells before the 1st, so the grid starts on the right weekday. */
  leadingBlanks: number;
  busiestDay: HeatmapCell | null;
  monthTotal: number;
  /** Days that actually had spending — the denominator for a daily average. */
  activeDays: number;
}

/**
 * Spending per calendar day, laid out as a month grid.
 *
 * Intensity is scaled against the month's own busiest day rather than a fixed
 * amount. A fixed scale would render a frugal month as uniformly blank and a
 * month with one house payment as one dark square and thirty empty ones; the
 * question the grid answers is "which days were heavy *for me, this month*".
 *
 * `weekStartsOn` defaults to Sunday because `Date.getDay()` does, and both the
 * en and th locales in this app start their week there.
 */
export function spendingHeatmap(
  transactions: Transaction[],
  period: string,
  weekStartsOn = 0,
): Heatmap {
  const [year, month] = period.split('-').map(Number);
  if (!Number.isFinite(year) || !Number.isFinite(month)) {
    return { cells: [], leadingBlanks: 0, busiestDay: null, monthTotal: 0, activeDays: 0 };
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const totals = new Map<number, { total: number; count: number }>();

  for (const tx of transactions) {
    // Transfers move money between the user's own wallets; counting them as
    // spending would make every payday look like the heaviest day of the month.
    if (tx.type !== 'expense') continue;
    if (!tx.date || tx.date.slice(0, 7) !== period) continue;

    const day = Number(tx.date.slice(8, 10));
    if (!Number.isFinite(day)) continue;

    const entry = totals.get(day) ?? { total: 0, count: 0 };
    entry.total += Number(tx.amount) || 0;
    entry.count += 1;
    totals.set(day, entry);
  }

  const busiest = Math.max(0, ...[...totals.values()].map((entry) => entry.total));

  const cells: HeatmapCell[] = [];
  for (let day = 1; day <= daysInMonth; day += 1) {
    const entry = totals.get(day) ?? { total: 0, count: 0 };
    cells.push({
      date: `${period}-${String(day).padStart(2, '0')}`,
      day,
      weekday: new Date(year, month - 1, day).getDay(),
      total: round2(entry.total),
      count: entry.count,
      intensity: busiest > 0 ? entry.total / busiest : 0,
    });
  }

  const firstWeekday = new Date(year, month - 1, 1).getDay();
  const busiestDay = cells.reduce<HeatmapCell | null>(
    (best, cell) => (cell.total > 0 && (!best || cell.total > best.total) ? cell : best),
    null,
  );

  return {
    cells,
    leadingBlanks: (firstWeekday - weekStartsOn + 7) % 7,
    busiestDay,
    monthTotal: round2(cells.reduce((sum, cell) => sum + cell.total, 0)),
    activeDays: cells.filter((cell) => cell.total > 0).length,
  };
}

/* ------------------------------------------------------------------ */
/* Category composition                                                */
/* ------------------------------------------------------------------ */

export interface CategorySlice {
  category: string;
  total: number;
  count: number;
  /** Percent of the whole. */
  share: number;
  /** True for the synthesised tail bucket. */
  isOther: boolean;
}

/**
 * Expenses by category, largest first, with a tail bucket.
 *
 * Capped at `limit` real slices because the visual is an area comparison: past
 * eight or so, the slices are too small to compare and each one needs its own
 * colour, which is exactly the point at which a categorical palette stops being
 * distinguishable. The remainder folds into "Other" rather than being dropped —
 * a breakdown whose parts do not sum to the total is not a breakdown.
 */
export function categoryComposition(
  transactions: Transaction[],
  limit = 7,
  otherLabel = 'Other',
): { slices: CategorySlice[]; total: number } {
  const byCategory = new Map<string, { total: number; count: number }>();

  for (const tx of transactions) {
    if (tx.type !== 'expense') continue;
    const category = String(tx.category ?? '').trim() || otherLabel;
    const entry = byCategory.get(category) ?? { total: 0, count: 0 };
    entry.total += Number(tx.amount) || 0;
    entry.count += 1;
    byCategory.set(category, entry);
  }

  const ranked = [...byCategory.entries()]
    .map(([category, entry]) => ({ category, ...entry }))
    .sort((a, b) => b.total - a.total);

  const total = round2(ranked.reduce((sum, row) => sum + row.total, 0));
  if (!total) return { slices: [], total: 0 };

  const head = ranked.slice(0, limit);
  const tail = ranked.slice(limit);

  const slices: CategorySlice[] = head.map((row) => ({
    category: row.category,
    total: round2(row.total),
    count: row.count,
    share: round2((row.total / total) * 100),
    isOther: false,
  }));

  if (tail.length) {
    const tailTotal = tail.reduce((sum, row) => sum + row.total, 0);
    slices.push({
      category: otherLabel,
      total: round2(tailTotal),
      count: tail.reduce((sum, row) => sum + row.count, 0),
      share: round2((tailTotal / total) * 100),
      isOther: true,
    });
  }

  return { slices, total };
}

/* ------------------------------------------------------------------ */
/* Payees                                                              */
/* ------------------------------------------------------------------ */

export interface PayeeRow {
  /** The note as most commonly written, not the normalised key. */
  payee: string;
  total: number;
  count: number;
  average: number;
  share: number;
  /** The most recent date money went here. */
  lastPaid: string;
}

/**
 * Where the money goes most often, ranked.
 *
 * There is no payee field in this app — the note is it. So grouping is done on
 * a normalised form of the note (case-folded, whitespace-collapsed) while the
 * *displayed* name is the spelling the user typed most often. That way "Grab",
 * "grab" and "GRAB " are one row and it is labelled the way they usually write
 * it, rather than whichever one happened to come first.
 *
 * Rows with no note are collected under one bucket instead of being dropped:
 * "you spend a lot without writing down where" is itself worth seeing.
 */
export function topPayees(
  transactions: Transaction[],
  limit = 8,
  unlabelled = 'No note',
): { rows: PayeeRow[]; total: number } {
  interface Bucket {
    total: number;
    count: number;
    lastPaid: string;
    /** Spelling → how often it was used, and the last date it was used. */
    spellings: Map<string, { count: number; lastUsed: string }>;
  }

  const byKey = new Map<string, Bucket>();
  let total = 0;

  for (const tx of transactions) {
    if (tx.type !== 'expense') continue;

    const raw = String(tx.note ?? '').trim().replace(/\s+/g, ' ');
    const key = raw.toLowerCase() || ' unlabelled';
    const amount = Number(tx.amount) || 0;

    const bucket = byKey.get(key) ?? {
      total: 0,
      count: 0,
      lastPaid: '',
      spellings: new Map<string, { count: number; lastUsed: string }>(),
    };

    bucket.total += amount;
    bucket.count += 1;
    if (tx.date > bucket.lastPaid) bucket.lastPaid = tx.date;

    if (raw) {
      const seen = bucket.spellings.get(raw) ?? { count: 0, lastUsed: '' };
      seen.count += 1;
      if (tx.date > seen.lastUsed) seen.lastUsed = tx.date;
      bucket.spellings.set(raw, seen);
    }

    byKey.set(key, bucket);
    total += amount;
  }

  total = round2(total);

  const rows = [...byKey.entries()]
    .map(([key, bucket]) => {
      /* Most-used spelling wins, and a tie goes to the most recent one — how
         they write it *now*. Alphabetical was the obvious tie-break and it is
         the wrong one: three one-off spellings of the same shop would be
         labelled by whichever happened to sort first, so "Grab", "grab" and
         "GRAB " showed up as GRAB. Falling back to recency at least picks an
         answer the user can recognise as their own. */
      const label =
        [...bucket.spellings.entries()].sort(
          (a, b) => b[1].count - a[1].count || b[1].lastUsed.localeCompare(a[1].lastUsed),
        )[0]?.[0] ?? unlabelled;

      return {
        payee: key === ' unlabelled' ? unlabelled : label,
        total: round2(bucket.total),
        count: bucket.count,
        average: round2(bucket.total / bucket.count),
        share: total > 0 ? round2((bucket.total / total) * 100) : 0,
        lastPaid: bucket.lastPaid,
      };
    })
    .sort((a, b) => b.total - a.total || b.count - a.count)
    .slice(0, limit);

  return { rows, total };
}
