import { Transaction } from '../types';

/**
 * Five-number summaries per spending category, plus the points themselves.
 *
 * ---------------------------------------------------------------------------
 * WHY A BOX PLOT AND NOT ANOTHER BAR CHART
 * ---------------------------------------------------------------------------
 * Every other spending view in this app answers "how much" — a total, a share,
 * a trend. None of them can distinguish 30 coffees from one flight, and those
 * are completely different facts about a month. A distribution shows the
 * typical transaction, the spread around it, and — the reason to build it — the
 * individual purchases that sit far outside both.
 *
 * ---------------------------------------------------------------------------
 * WHY THE RAW POINTS ARE CARRIED TOO
 * ---------------------------------------------------------------------------
 * A box alone is a summary of a summary. With eight transactions in a category
 * the quartiles are nearly meaningless, and a box drawn from them looks exactly
 * as authoritative as one drawn from eight hundred. Overlaying every point
 * (the "jitter") makes the sample size visible, which is the honest way to show
 * a distribution someone might act on.
 */

/** Percentile by linear interpolation between closest ranks (R type 7). */
export function quantile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const position = (sorted.length - 1) * p;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

export interface JitterPoint {
  /** The transaction id — a stable key, and what the jitter offset hashes on. */
  id: string;
  amount: number;
  date: string;
  note: string;
  /** −0.5…0.5. Deterministic, so a point does not move between renders. */
  offset: number;
  /** Beyond 1.5 × IQR from the nearer quartile. */
  outlier: boolean;
}

export interface CategoryBox {
  category: string;
  count: number;
  /** Every transaction in the category, for the jitter layer. */
  points: JitterPoint[];

  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  /** q3 − q1. */
  iqr: number;
  /** Furthest point still within 1.5 × IQR below q1. */
  lowerWhisker: number;
  /** …and above q3. */
  upperWhisker: number;
  outlierCount: number;

  mean: number;
  total: number;
}

export interface BoxPlotData {
  categories: CategoryBox[];
  /** Largest amount anywhere in the set — the y-axis ceiling before padding. */
  maxAmount: number;
  /** Transactions considered, after filtering to expenses. */
  sampleSize: number;
  /** Categories dropped for having too few points to say anything about. */
  omittedCategories: number;
}

/**
 * A stable pseudo-random offset in −0.5…0.5, hashed from the transaction id.
 *
 * `Math.random()` would be the obvious way to jitter, and it is wrong here for
 * two reasons: the points would jump on every re-render (a hover, a theme
 * change, a parent's state update), and two renders of the same data would
 * disagree, which makes the chart untrustworthy in exactly the way a chart of
 * outliers must not be. Hashing the id gives the same scatter every time while
 * still looking unstructured.
 *
 * FNV-1a: short, no dependencies, and well-distributed over short strings.
 */
export function jitterOffset(id: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  // >>> 0 to read it unsigned; the modulus keeps the ratio well away from 1.
  return ((hash >>> 0) % 1000) / 1000 - 0.5;
}

export interface BoxPlotOptions {
  /** How many categories to draw. The rest are counted and dropped. */
  topN?: number;
  /**
   * Fewest transactions a category needs to earn a box.
   *
   * Two is the floor: one point has no spread, and a "box" of zero height
   * drawn at a single value reads as a precise finding rather than a sample of
   * one. Below this the category is omitted and counted.
   */
  minPoints?: number;
}

const DEFAULT_TOP_N = 8;
const DEFAULT_MIN_POINTS = 2;

/**
 * Build the plot from a ledger slice.
 *
 * Expenses only, at absolute value. Income would share an axis with spending
 * while meaning the opposite, and transfers are money that never left — both
 * would inflate the spread with amounts that are not purchases. The same
 * exclusions the spending heatmap makes, for the same reason.
 */
export function buildBoxPlot(
  transactions: Transaction[],
  options: BoxPlotOptions = {},
): BoxPlotData {
  const topN = options.topN ?? DEFAULT_TOP_N;
  const minPoints = options.minPoints ?? DEFAULT_MIN_POINTS;

  const groups = new Map<string, Transaction[]>();
  let sampleSize = 0;

  for (const tx of transactions) {
    if (tx.type !== 'expense') continue;
    const amount = Math.abs(Number(tx.amount) || 0);
    if (!(amount > 0)) continue;

    const category = String(tx.category ?? '').trim() || 'Uncategorised';
    const bucket = groups.get(category);
    if (bucket) bucket.push(tx);
    else groups.set(category, [tx]);
    sampleSize += 1;
  }

  const boxes: CategoryBox[] = [];
  let omittedCategories = 0;

  for (const [category, rows] of groups) {
    if (rows.length < minPoints) {
      omittedCategories += 1;
      continue;
    }

    const amounts = rows.map((tx) => Math.abs(Number(tx.amount) || 0)).sort((a, b) => a - b);

    const q1 = quantile(amounts, 0.25);
    const median = quantile(amounts, 0.5);
    const q3 = quantile(amounts, 0.75);
    const iqr = q3 - q1;

    /* Tukey fences. The whiskers stop at the furthest *actual* point inside
       them rather than at the fence itself — a whisker drawn to a value no
       transaction has is a line pointing at nothing. */
    const lowerFence = q1 - 1.5 * iqr;
    const upperFence = q3 + 1.5 * iqr;
    const inside = amounts.filter((value) => value >= lowerFence && value <= upperFence);
    const lowerWhisker = inside.length ? inside[0] : amounts[0];
    const upperWhisker = inside.length ? inside[inside.length - 1] : amounts[amounts.length - 1];

    const total = amounts.reduce((sum, value) => sum + value, 0);

    const points: JitterPoint[] = rows.map((tx) => {
      const amount = Math.abs(Number(tx.amount) || 0);
      return {
        id: tx.id,
        amount,
        date: tx.date,
        note: tx.note,
        offset: jitterOffset(tx.id),
        outlier: amount < lowerWhisker || amount > upperWhisker,
      };
    });

    boxes.push({
      category,
      count: rows.length,
      points,
      min: amounts[0],
      q1,
      median,
      q3,
      max: amounts[amounts.length - 1],
      iqr,
      lowerWhisker,
      upperWhisker,
      outlierCount: points.filter((point) => point.outlier).length,
      mean: total / amounts.length,
      total,
    });
  }

  /* Ranked by total spend, not by transaction count: the categories worth
     studying are the ones the money is in. A tie breaks on count, then name, so
     the order is stable across renders of the same data. */
  boxes.sort(
    (a, b) => b.total - a.total || b.count - a.count || a.category.localeCompare(b.category),
  );

  const kept = boxes.slice(0, topN);
  omittedCategories += Math.max(0, boxes.length - kept.length);

  return {
    categories: kept,
    maxAmount: kept.reduce((max, box) => Math.max(max, box.max), 0),
    sampleSize,
    omittedCategories,
  };
}

/**
 * Axis ticks that land on round numbers.
 *
 * A linear scale from 0 to the exact maximum puts labels at 3,847 and 7,694,
 * which nobody reads. This rounds the ceiling up to a 1/2/5 × 10ⁿ step so the
 * gridlines fall on numbers a person recognises.
 */
export function niceScale(max: number, targetTicks = 5): { max: number; ticks: number[] } {
  if (!(max > 0)) return { max: 1, ticks: [0, 1] };

  const rawStep = max / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rawStep));
  const normalised = rawStep / magnitude;
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;

  const ceiling = Math.ceil(max / step) * step;
  const ticks: number[] = [];
  for (let value = 0; value <= ceiling + step / 2; value += step) {
    ticks.push(Math.round(value * 100) / 100);
  }
  return { max: ceiling, ticks };
}
