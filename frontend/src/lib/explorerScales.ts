/**
 * Scales, ticks and hit-testing for the explorer's SVG charts.
 *
 * Owned here rather than borrowed from a chart library for one reason that
 * decides it: the hover layer. A dense scatter needs nearest-point hit
 * testing — an 8px dot you must land on dead centre is not usable — and that
 * needs the data→pixel mapping in hand. Recharts keeps its scales internal.
 * With them here, "which point is under the cursor" is a loop over numbers.
 */

export interface LinearScale {
  domain: [number, number];
  range: [number, number];
  (value: number): number;
  invert(pixel: number): number;
  ticks: number[];
}

/**
 * Round the domain out to 1/2/5 × 10ⁿ steps, so gridlines land on numbers a
 * person recognises rather than on 3,847 and 7,694.
 *
 * `includeZero` is for bars: a bar's length *is* its value, so a baseline that
 * is not zero makes one bar look twice as long as another it barely exceeds.
 * Scatter and line do not need it, and forcing it there squashes the data into
 * a thin band at the top of the plot.
 */
export function niceDomain(
  min: number,
  max: number,
  targetTicks = 5,
  includeZero = false,
): { min: number; max: number; ticks: number[] } {
  let lo = Number.isFinite(min) ? min : 0;
  let hi = Number.isFinite(max) ? max : 0;
  if (includeZero) {
    lo = Math.min(0, lo);
    hi = Math.max(0, hi);
  }

  /* A flat series has no span to divide. Give it one around the value, so a
     single point sits mid-plot instead of on an axis with one tick. */
  if (hi === lo) {
    const pad = Math.abs(hi) > 0 ? Math.abs(hi) * 0.5 : 1;
    lo = includeZero && lo >= 0 ? 0 : lo - pad;
    hi = hi + pad;
  }

  const step = niceStep((hi - lo) / Math.max(1, targetTicks));
  const niceMin = Math.floor(lo / step) * step;
  const niceMax = Math.ceil(hi / step) * step;

  const ticks: number[] = [];
  for (let value = niceMin; value <= niceMax + step / 2; value += step) {
    // Rounded so 0.1 + 0.2 does not become a tick labelled 0.30000000000000004.
    ticks.push(Number(value.toPrecision(12)));
    if (ticks.length > 50) break;
  }

  return { min: niceMin, max: niceMax, ticks };
}

export function niceStep(raw: number): number {
  if (!(raw > 0) || !Number.isFinite(raw)) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const factor = normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10;
  return factor * magnitude;
}

export function linearScale(
  domain: [number, number],
  range: [number, number],
  ticks: number[] = [],
): LinearScale {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  const span = d1 - d0 || 1;
  const scale = ((value: number) => r0 + ((value - d0) / span) * (r1 - r0)) as LinearScale;
  scale.invert = (pixel: number) => d0 + ((pixel - r0) / (r1 - r0 || 1)) * span;
  scale.domain = domain;
  scale.range = range;
  scale.ticks = ticks;
  return scale;
}

/* ------------------------------------------------------------------ */
/* Time                                                                */
/* ------------------------------------------------------------------ */

export type TimeUnit = 'day' | 'month' | 'quarter' | 'year';

const DAY = 86_400_000;

/**
 * Ticks on calendar boundaries.
 *
 * Linear ticks over milliseconds land on arbitrary instants — "3 Feb 14:22" —
 * because 1/2/5 × 10ⁿ milliseconds have nothing to do with the calendar. These
 * snap to the first of a day, month, quarter or year, choosing the finest unit
 * that keeps the count under `maxTicks`.
 */
export function timeTicks(min: number, max: number, maxTicks = 7): { ticks: number[]; unit: TimeUnit } {
  if (!Number.isFinite(min) || !Number.isFinite(max) || max < min) return { ticks: [], unit: 'day' };

  const span = max - min;
  const candidates: { unit: TimeUnit; step: number; approx: number }[] = [
    { unit: 'day', step: 1, approx: DAY },
    { unit: 'day', step: 7, approx: 7 * DAY },
    { unit: 'month', step: 1, approx: 30 * DAY },
    { unit: 'quarter', step: 3, approx: 91 * DAY },
    { unit: 'month', step: 6, approx: 182 * DAY },
    { unit: 'year', step: 1, approx: 365 * DAY },
    { unit: 'year', step: 2, approx: 730 * DAY },
    { unit: 'year', step: 5, approx: 1826 * DAY },
    { unit: 'year', step: 10, approx: 3652 * DAY },
  ];
  const choice =
    candidates.find((c) => span / c.approx <= maxTicks) ?? candidates[candidates.length - 1];

  const ticks: number[] = [];
  const start = new Date(min);
  let cursor: Date;

  if (choice.unit === 'day') {
    cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate()));
    if (cursor.getTime() < min) cursor = new Date(cursor.getTime() + DAY);
  } else if (choice.unit === 'year') {
    const year = Math.ceil(start.getUTCFullYear() / choice.step) * choice.step;
    cursor = new Date(Date.UTC(year, 0, 1));
    if (cursor.getTime() < min) cursor = new Date(Date.UTC(year + choice.step, 0, 1));
  } else {
    const month = Math.ceil(start.getUTCMonth() / choice.step) * choice.step;
    cursor = new Date(Date.UTC(start.getUTCFullYear(), month, 1));
    if (cursor.getTime() < min) {
      cursor = new Date(Date.UTC(start.getUTCFullYear(), month + choice.step, 1));
    }
  }

  for (let guard = 0; guard < 200 && cursor.getTime() <= max; guard += 1) {
    ticks.push(cursor.getTime());
    if (choice.unit === 'day') cursor = new Date(cursor.getTime() + choice.step * DAY);
    else if (choice.unit === 'year') {
      cursor = new Date(Date.UTC(cursor.getUTCFullYear() + choice.step, 0, 1));
    } else {
      cursor = new Date(Date.UTC(cursor.getUTCFullYear(), cursor.getUTCMonth() + choice.step, 1));
    }
  }

  return { ticks, unit: choice.unit };
}

/* ------------------------------------------------------------------ */
/* Bands                                                               */
/* ------------------------------------------------------------------ */

export interface BandScale {
  (index: number): number;
  bandwidth: number;
  step: number;
  /** Which band a pixel falls in, or -1. */
  indexAt(pixel: number): number;
}

/**
 * Evenly spaced bands for categories. `padding` is the share of each step left
 * empty between bands.
 */
export function bandScale(count: number, range: [number, number], padding = 0.25): BandScale {
  const [r0, r1] = range;
  const step = count > 0 ? (r1 - r0) / count : 0;
  const bandwidth = step * (1 - padding);
  const offset = (step - bandwidth) / 2;
  const scale = ((index: number) => r0 + index * step + offset) as BandScale;
  scale.bandwidth = bandwidth;
  scale.step = step;
  scale.indexAt = (pixel: number) => {
    if (step <= 0) return -1;
    const index = Math.floor((pixel - r0) / step);
    return index >= 0 && index < count ? index : -1;
  };
  return scale;
}

/* ------------------------------------------------------------------ */
/* Hit testing                                                         */
/* ------------------------------------------------------------------ */

/**
 * The point nearest the cursor, within `maxDistance` pixels.
 *
 * A linear scan, deliberately: at the scatter's 4,000-point cap this is a few
 * microseconds, well under a frame, and a spatial index would be more code for
 * a saving nobody can perceive. The radius is the point — it gives each dot a
 * hit area far larger than the dot itself, which is what makes a dense scatter
 * usable with a mouse, and returns nothing when the cursor is in empty space so
 * the tooltip does not cling to a distant point.
 */
export function nearestPoint(
  points: { px: number; py: number }[],
  x: number,
  y: number,
  maxDistance = 24,
): number {
  let best = -1;
  let bestDistance = maxDistance * maxDistance;
  for (let i = 0; i < points.length; i += 1) {
    const dx = points[i].px - x;
    const dy = points[i].py - y;
    const distance = dx * dx + dy * dy;
    if (distance <= bestDistance) {
      bestDistance = distance;
      best = i;
    }
  }
  return best;
}

/** Index of the value in a sorted array closest to `target`. */
export function nearestIndex(sorted: number[], target: number): number {
  if (sorted.length === 0) return -1;
  let lo = 0;
  let hi = sorted.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] < target) lo = mid + 1;
    else hi = mid;
  }
  if (lo > 0 && Math.abs(sorted[lo - 1] - target) <= Math.abs(sorted[lo] - target)) return lo - 1;
  return lo;
}

/**
 * A bar's path: square at the baseline, 4px rounded at the data end.
 *
 * Rounded at the value end only, because the baseline is where every bar is
 * compared from — rounding it too would make the bars appear to float, and a
 * reader measures length from that edge. Handles negative bars by rounding
 * whichever end is further from zero.
 */
export function barPath(x: number, width: number, yValue: number, yBase: number, radius = 4): string {
  const w = Math.max(0, width);
  const height = Math.abs(yBase - yValue);
  const r = Math.max(0, Math.min(radius, w / 2, height));
  const up = yValue <= yBase;
  const top = Math.min(yValue, yBase);
  const bottom = Math.max(yValue, yBase);

  if (r === 0 || height === 0) return `M${x},${top}h${w}V${bottom}h${-w}Z`;

  return up
    ? `M${x},${bottom}V${top + r}Q${x},${top} ${x + r},${top}H${x + w - r}Q${x + w},${top} ${x + w},${top + r}V${bottom}Z`
    : `M${x},${top}H${x + w}V${bottom - r}Q${x + w},${bottom} ${x + w - r},${bottom}H${x + r}Q${x},${bottom} ${x},${bottom - r}Z`;
}
