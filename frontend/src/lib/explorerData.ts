import { quantile } from './boxPlotMath';
import { PairScope, seriesCap } from './explorerPalette';

/**
 * The Deep Analytics explorer's data layer: from raw sheet rows to something a
 * chart can draw.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT JUST `rows.map(r => ({ x: r[x], y: r[y] }))`
 * ---------------------------------------------------------------------------
 * Because every chart type means something different by "put this column on
 * that axis", and the naive mapping is wrong for three of the four:
 *
 *   - a bar chart of raw rows draws one bar per *transaction*, so "Food" appears
 *     forty times. Bars need an aggregation, and the choice between sum, mean
 *     and count changes the answer.
 *   - a line over dates has gaps, and what a gap means depends on the
 *     aggregation. A month with no spending *summed* to 0; its *mean* is not 0,
 *     it is undefined. Filling both with zero lies about one of them.
 *   - a box plot is not a mapping at all, it is five statistics per group.
 *
 * So the rules live here as pure functions, where each can be tested against a
 * table of rows instead of against a rendered chart.
 */

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export type ColumnKind = 'number' | 'date' | 'category' | 'boolean';

export interface RawColumn {
  key: string;
  kind: ColumnKind;
  /** The sheet header, shown as the column's label. */
  header: string;
}

export type RawRow = Record<string, unknown>;

/** What `analytics.getRawData` returns. */
export interface RawDataset {
  source: string;
  columns: RawColumn[];
  rows: RawRow[];
  rowCount: number;
  generatedAt: string;
}

/**
 * The explorer's sources, in the order the picker lists them.
 *
 * Must equal `RAW_DATA_SOURCES` in Code.gs, which is the authority — the
 * server refuses anything not on its own allowlist whatever this says. Kept in
 * step by a check that reads both files, so a source added on one side only is
 * a failing test rather than a picker entry that 400s.
 */
export const RAW_SOURCES = [
  'transactions',
  'investments',
  'debts',
  'goals',
  'subscriptions',
  'budgets',
  'billSplits',
  'wallets',
  'watchlist',
] as const;

export type RawSource = (typeof RAW_SOURCES)[number];

export type ChartType = 'scatter' | 'bar' | 'line' | 'box';
export type Aggregation = 'count' | 'sum' | 'mean' | 'median';
export type DateBucket = 'day' | 'month' | 'year';
export type Role = 'x' | 'y' | 'group';

export interface ChartSpec {
  type: ChartType;
  x: string | null;
  y: string | null;
  group: string | null;
  aggregation: Aggregation;
  dateBucket: DateBucket;
}

/**
 * Sentinels for "no value" and "the folded tail", rendered with translated
 * labels. Plain ASCII on purpose: an earlier version used a control-character
 * prefix to make collisions impossible, and the NUL byte made git classify the
 * whole file as binary — no diffs, no blame. A real category literally named
 * `__blank__` is the accepted trade.
 */
export const BLANK = '__blank__';
export const OTHER = '__other__';

/* ------------------------------------------------------------------ */
/* What each chart accepts                                             */
/* ------------------------------------------------------------------ */

/**
 * Column kinds each role will take, per chart. `null` means the role is not
 * used by that chart at all — a box plot has no colour grouping, because each
 * box already *is* a group and a second encoding of the same thing is noise.
 */
export const ACCEPTS: Record<ChartType, Record<Role, ColumnKind[] | null>> = {
  scatter: { x: ['number', 'date'], y: ['number'], group: ['category', 'boolean'] },
  bar: { x: ['category', 'boolean', 'date'], y: ['number'], group: ['category', 'boolean'] },
  line: { x: ['date', 'number'], y: ['number'], group: ['category', 'boolean'] },
  box: { x: ['category', 'boolean', 'date'], y: ['number'], group: null },
};

/** Charts that summarise many rows into one value per position. */
export function usesAggregation(type: ChartType): boolean {
  return type === 'bar' || type === 'line';
}

/**
 * Which colour-pair rule a chart falls under. A scatter can put any two groups
 * next to each other, so it is held to every pair; bars and lines only ever
 * show neighbours side by side. See `explorerPalette`.
 */
export function pairScope(type: ChartType): PairScope {
  return type === 'scatter' ? 'all' : 'adjacent';
}

export function columnFor(columns: RawColumn[], key: string | null): RawColumn | null {
  if (!key) return null;
  return columns.find((column) => column.key === key) ?? null;
}

export function acceptsColumn(type: ChartType, role: Role, column: RawColumn | null): boolean {
  const kinds = ACCEPTS[type][role];
  return Boolean(kinds && column && kinds.includes(column.kind));
}

/** Whether the date-bucket control means anything for this selection. */
export function usesDateBucket(spec: ChartSpec, columns: RawColumn[]): boolean {
  return spec.type !== 'scatter' && columnFor(columns, spec.x)?.kind === 'date';
}

export type SpecProblem =
  | 'needX'
  | 'badX'
  | 'needY'
  | 'badY'
  | 'badGroup'
  | 'tooManyBuckets';

/**
 * The first reason this spec cannot be drawn, or null.
 *
 * Returned as a code rather than a sentence so the UI can say it in the user's
 * language — and so a test can assert on the reason, not on English prose.
 */
export function validateSpec(spec: ChartSpec, columns: RawColumn[]): SpecProblem | null {
  const x = columnFor(columns, spec.x);
  if (!x) return 'needX';
  if (!acceptsColumn(spec.type, 'x', x)) return 'badX';

  /* A count needs no measure — it counts rows. Every other aggregation, and
     every chart that does not aggregate, needs a numeric Y. */
  const countOnly = usesAggregation(spec.type) && spec.aggregation === 'count';
  const y = columnFor(columns, spec.y);
  if (!countOnly) {
    if (!y) return 'needY';
    if (!acceptsColumn(spec.type, 'y', y)) return 'badY';
  }

  if (spec.group) {
    if (!ACCEPTS[spec.type].group) return 'badGroup';
    if (!acceptsColumn(spec.type, 'group', columnFor(columns, spec.group))) return 'badGroup';
  }

  return null;
}

/* Column keys the defaults reach for first. Keys, not headers — the headers are
   display text and may one day be translated. */
const TIME_KEYS = ['date', 'buyDate', 'nextDueDate', 'deadline', 'period', 'createdAt'];
const CATEGORY_KEYS = ['category', 'type', 'status', 'frequency', 'symbol', 'title', 'name'];

/**
 * X preferences depend on the chart, because each form has a natural reading.
 * A bar or box compares groups, so it opens on categories — "spend by
 * category". A line or scatter shows change, so it opens on time. One global
 * list would have opened every bar chart as "amount by month", which is a line
 * chart's job done worse.
 */
const PREFERRED_X: Record<ChartType, string[]> = {
  bar: [...CATEGORY_KEYS, ...TIME_KEYS],
  box: [...CATEGORY_KEYS, ...TIME_KEYS],
  line: TIME_KEYS,
  scatter: TIME_KEYS,
};

const PREFERRED: Record<Exclude<Role, 'x'>, string[]> = {
  y: ['amount', 'totalAmount', 'currentBalance', 'targetAmount', 'buyPrice', 'quantity'],
  group: ['type', 'category', 'status', 'frequency'],
};

function pick(type: ChartType, role: Role, columns: RawColumn[], avoid: string[] = []): string | null {
  const ok = columns.filter(
    (column) => acceptsColumn(type, role, column) && !avoid.includes(column.key),
  );
  const preferred = role === 'x' ? PREFERRED_X[type] : PREFERRED[role];
  for (const key of preferred) {
    const hit = ok.find((column) => column.key === key);
    if (hit) return hit.key;
  }
  return ok[0]?.key ?? null;
}

/**
 * A sensible starting spec for this chart type and this table.
 *
 * Keeps whatever the user already chose wherever it is still valid, so
 * switching from a bar to a line does not throw away a Y they picked on
 * purpose. Only the roles the new chart cannot use are replaced.
 */
export function defaultSpec(
  type: ChartType,
  columns: RawColumn[],
  previous?: Partial<ChartSpec>,
): ChartSpec {
  const keep = (role: Role, key: string | null | undefined) =>
    key && acceptsColumn(type, role, columnFor(columns, key)) ? key : null;

  const x = keep('x', previous?.x) ?? pick(type, 'x', columns);
  const y = keep('y', previous?.y) ?? pick(type, 'y', columns, x ? [x] : []);
  const group = ACCEPTS[type].group ? keep('group', previous?.group) : null;

  return {
    type,
    x,
    y,
    group,
    aggregation: previous?.aggregation ?? 'sum',
    dateBucket: previous?.dateBucket ?? 'month',
  };
}

/* ------------------------------------------------------------------ */
/* Value coercion                                                      */
/* ------------------------------------------------------------------ */

export function toNumber(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value.replace(/[, ]/g, ''));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

/**
 * A date cell as UTC milliseconds.
 *
 * Parsed in UTC on purpose. `new Date('2026-03-01')` is UTC but
 * `new Date('2026-03-01T00:00')` is local time, and a bucket computed in local
 * time drifts a day either side of midnight depending on where the reader
 * lives — which would put the 1st of the month into the previous month for
 * everyone west of Greenwich.
 */
export function toTime(value: unknown): number | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const text = value.trim();

  const period = /^(\d{4})-(\d{2})$/.exec(text);
  if (period) return Date.UTC(Number(period[1]), Number(period[2]) - 1, 1);

  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text);
  if (day) return Date.UTC(Number(day[1]), Number(day[2]) - 1, Number(day[3]));

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

export function toCategory(value: unknown): string {
  if (value === null || value === undefined) return BLANK;
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  const text = String(value).trim();
  return text === '' ? BLANK : text;
}

/** The bucket a timestamp falls in, as a sortable key. */
export function bucketKey(time: number, bucket: DateBucket): string {
  const date = new Date(time);
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  if (bucket === 'year') return String(year);
  if (bucket === 'month') return `${year}-${month}`;
  return `${year}-${month}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

/** The first instant of a bucket key, for placing it on a time axis. */
export function bucketStart(key: string): number {
  const [year, month = '01', day = '01'] = key.split('-');
  return Date.UTC(Number(year), Number(month) - 1, Number(day));
}

/* ------------------------------------------------------------------ */
/* Aggregation                                                         */
/* ------------------------------------------------------------------ */

export function aggregate(values: number[], how: Aggregation): number | null {
  if (how === 'count') return values.length;
  if (values.length === 0) return null;
  if (how === 'sum') return round(values.reduce((sum, value) => sum + value, 0));
  if (how === 'mean') return round(values.reduce((sum, value) => sum + value, 0) / values.length);
  return round(quantile([...values].sort((a, b) => a - b), 0.5));
}

/** Enough precision to be exact for money, without float noise in a tooltip. */
function round(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

/**
 * What an empty position means, for a given aggregation.
 *
 * Nothing summed is 0 and nothing counted is 0 — a month with no spending
 * genuinely spent zero. But the mean or median of nothing is not zero, it does
 * not exist, and drawing it as zero would pull the line down to the axis for a
 * month that simply had no data.
 */
export function emptyValue(how: Aggregation): number | null {
  return how === 'sum' || how === 'count' ? 0 : null;
}

/* ------------------------------------------------------------------ */
/* Groups                                                              */
/* ------------------------------------------------------------------ */

export interface Series {
  key: string;
  /** Rank in the stable ordering, or null for the folded "Other" bucket. */
  slot: number | null;
}

/**
 * Every value of the group column, most frequent first.
 *
 * Ranked over the *whole table*, not over whatever survives the current X and
 * Y. That is what makes a colour follow its entity: change the Y, switch from a
 * bar to a line, and "Food" is still the same rank and still the same hue. Rank
 * after filtering would repaint the survivors every time the selection changed,
 * which teaches the reader a colour and then takes it back.
 */
export function rankGroups(rows: RawRow[], key: string): string[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const value = toCategory(row[key]);
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || compareLabels(a[0], b[0]))
    .map(([value]) => value);
}

function compareLabels(a: string, b: string): number {
  // The blank bucket sorts last whatever its frequency tie.
  if (a === BLANK) return 1;
  if (b === BLANK) return -1;
  return a.localeCompare(b);
}

/**
 * Map each group value to a series, folding everything past `cap` into Other.
 */
export function groupSlots(ranking: string[], cap: number): Map<string, Series> {
  const map = new Map<string, Series>();
  ranking.forEach((value, index) => {
    map.set(value, index < cap ? { key: value, slot: index } : { key: OTHER, slot: null });
  });
  return map;
}

/** The distinct series a slot map produces, in slot order, Other last. */
function seriesList(slots: Map<string, Series> | null): Series[] {
  if (!slots) return [{ key: '', slot: 0 }];
  const seen = new Map<string, Series>();
  for (const series of slots.values()) if (!seen.has(series.key)) seen.set(series.key, series);
  return [...seen.values()].sort((a, b) => (a.slot ?? Infinity) - (b.slot ?? Infinity));
}

/* ------------------------------------------------------------------ */
/* Shaping                                                             */
/* ------------------------------------------------------------------ */

/**
 * A scatter plot draws one SVG node per point. Past a few thousand, hover and
 * resize start to stutter, and the extra points add nothing a reader can see —
 * they overplot. Above this the points are sampled, and the UI says so.
 */
export const MAX_SCATTER_POINTS = 4000;

/** Past this a bar chart is a barcode. The tail folds into Other. */
export const MAX_BAR_CATEGORIES = 24;

/** Past this a box plot is unreadable. The tail folds into Other. */
export const MAX_BOXES = 16;

/**
 * A time axis with more bars than this is noise at any screen size. Rather
 * than draw it, the explorer asks for a coarser bucket.
 */
export const MAX_DATE_BARS = 180;

/** Outliers per box, beyond which the rest are counted rather than drawn. */
export const MAX_OUTLIERS_DRAWN = 200;

export interface ScatterPoint {
  x: number;
  y: number;
  /** Index into the dataset's rows, for the tooltip and the table. */
  row: number;
}

export interface ScatterShape {
  type: 'scatter';
  xKind: 'number' | 'date';
  series: (Series & { points: ScatterPoint[] })[];
  /** Rows with a usable X and Y. */
  total: number;
  shown: number;
  /** Rows left out for having no usable value. */
  dropped: number;
  sampled: boolean;
}

export interface BarShape {
  type: 'bar';
  xKind: 'category' | 'date';
  categories: string[];
  series: (Series & { values: (number | null)[] })[];
  dropped: number;
  folded: number;
}

export interface LineShape {
  type: 'line';
  xKind: 'number' | 'date';
  /** Sorted, and shared by every series. */
  xs: number[];
  /** Bucket keys alongside `xs` when the axis is dates, for labelling. */
  xKeys: string[] | null;
  series: (Series & { values: (number | null)[] })[];
  dropped: number;
}

export interface BoxStats {
  key: string;
  n: number;
  min: number;
  q1: number;
  median: number;
  q3: number;
  max: number;
  lowerWhisker: number;
  upperWhisker: number;
  outliers: number[];
  /** Outliers beyond `MAX_OUTLIERS_DRAWN`, counted but not drawn. */
  hiddenOutliers: number;
}

export interface BoxShape {
  type: 'box';
  xKind: 'category' | 'date';
  boxes: BoxStats[];
  dropped: number;
  folded: number;
}

export type Shape = ScatterShape | BarShape | LineShape | BoxShape;

export type ShapeResult = { ok: true; shape: Shape } | { ok: false; problem: SpecProblem };

/**
 * FNV-1a over the row index: a stable pseudo-random keep/drop decision.
 *
 * Stride sampling (every nth row) aliases with anything periodic in the data —
 * rows written monthly and sampled every 30th keeps the same day of every
 * month. Hashing avoids that while still giving the same sample on every
 * render, so points do not shimmer when the chart re-renders.
 */
function keepSample(index: number, ratio: number): boolean {
  let hash = 0x811c9dc5;
  const text = String(index);
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return ((hash >>> 0) % 100_000) / 100_000 < ratio;
}

/** An X value as its position key: a date bucket, a category, or a number. */
function xKeyOf(
  row: RawRow,
  column: RawColumn,
  bucket: DateBucket,
): { key: string; time: number | null } | null {
  const raw = row[column.key];
  if (column.kind === 'date') {
    const time = toTime(raw);
    if (time === null) return null;
    const key = bucketKey(time, bucket);
    return { key, time: bucketStart(key) };
  }
  if (column.kind === 'number') {
    const value = toNumber(raw);
    return value === null ? null : { key: String(value), time: value };
  }
  return { key: toCategory(raw), time: null };
}

export function shapeData(dataset: RawDataset, spec: ChartSpec): ShapeResult {
  const problem = validateSpec(spec, dataset.columns);
  if (problem) return { ok: false, problem };

  const xColumn = columnFor(dataset.columns, spec.x) as RawColumn;
  const yColumn = columnFor(dataset.columns, spec.y);
  const groupColumn = columnFor(dataset.columns, spec.group);

  const slots = groupColumn
    ? groupSlots(rankGroups(dataset.rows, groupColumn.key), seriesCap(pairScope(spec.type)))
    : null;
  const seriesOf = (row: RawRow): Series =>
    slots && groupColumn
      ? (slots.get(toCategory(row[groupColumn.key])) as Series)
      : { key: '', slot: 0 };

  switch (spec.type) {
    case 'scatter':
      return { ok: true, shape: shapeScatter(dataset, xColumn, yColumn as RawColumn, slots, seriesOf) };
    case 'bar':
      return shapeBar(dataset, spec, xColumn, yColumn, slots, seriesOf);
    case 'line':
      return { ok: true, shape: shapeLine(dataset, spec, xColumn, yColumn, slots, seriesOf) };
    case 'box':
      return { ok: true, shape: shapeBox(dataset, spec, xColumn, yColumn as RawColumn) };
  }
}

function shapeScatter(
  dataset: RawDataset,
  xColumn: RawColumn,
  yColumn: RawColumn,
  slots: Map<string, Series> | null,
  seriesOf: (row: RawRow) => Series,
): ScatterShape {
  const usable: { point: ScatterPoint; series: Series }[] = [];
  let dropped = 0;

  dataset.rows.forEach((row, index) => {
    const x = xColumn.kind === 'date' ? toTime(row[xColumn.key]) : toNumber(row[xColumn.key]);
    const y = toNumber(row[yColumn.key]);
    if (x === null || y === null) {
      dropped += 1;
      return;
    }
    usable.push({ point: { x, y, row: index }, series: seriesOf(row) });
  });

  const sampled = usable.length > MAX_SCATTER_POINTS;
  const ratio = sampled ? MAX_SCATTER_POINTS / usable.length : 1;

  const bySeries = new Map<string, Series & { points: ScatterPoint[] }>();
  for (const series of seriesList(slots)) bySeries.set(series.key, { ...series, points: [] });

  let shown = 0;
  for (const { point, series } of usable) {
    if (sampled && !keepSample(point.row, ratio)) continue;
    bySeries.get(series.key)?.points.push(point);
    shown += 1;
  }

  return {
    type: 'scatter',
    xKind: xColumn.kind === 'date' ? 'date' : 'number',
    series: [...bySeries.values()].filter((series) => series.points.length > 0),
    total: usable.length,
    shown,
    dropped,
    sampled,
  };
}

/** Collect Y values per (x position, series). Count ignores Y entirely. */
function collect(
  dataset: RawDataset,
  spec: ChartSpec,
  xColumn: RawColumn,
  yColumn: RawColumn | null,
  seriesOf: (row: RawRow) => Series,
) {
  const cells = new Map<string, Map<string, number[]>>();
  const times = new Map<string, number | null>();
  let dropped = 0;

  for (const row of dataset.rows) {
    const x = xKeyOf(row, xColumn, spec.dateBucket);
    if (!x) {
      dropped += 1;
      continue;
    }

    let value = 1;
    if (spec.aggregation !== 'count') {
      const y = yColumn ? toNumber(row[yColumn.key]) : null;
      if (y === null) {
        dropped += 1;
        continue;
      }
      value = y;
    }

    const series = seriesOf(row).key;
    times.set(x.key, x.time);
    const bySeries = cells.get(x.key) ?? new Map<string, number[]>();
    const list = bySeries.get(series) ?? [];
    list.push(value);
    bySeries.set(series, list);
    cells.set(x.key, bySeries);
  }

  return { cells, times, dropped };
}

function shapeBar(
  dataset: RawDataset,
  spec: ChartSpec,
  xColumn: RawColumn,
  yColumn: RawColumn | null,
  slots: Map<string, Series> | null,
  seriesOf: (row: RawRow) => Series,
): ShapeResult {
  const { cells, dropped } = collect(dataset, spec, xColumn, yColumn, seriesOf);
  const series = seriesList(slots);
  const isDate = xColumn.kind === 'date';

  const totalOf = (key: string) => {
    let sum = 0;
    for (const values of cells.get(key)?.values() ?? []) {
      const v = aggregate(values, spec.aggregation);
      if (v !== null) sum += v;
    }
    return sum;
  };

  let keys = [...cells.keys()];
  let folded = 0;

  if (isDate) {
    keys.sort();
    if (keys.length > MAX_DATE_BARS) return { ok: false, problem: 'tooManyBuckets' };
  } else {
    /* Largest first — a sorted bar chart can be read top-down; one in sheet
       order has to be scanned. Booleans keep their natural false/true order. */
    if (xColumn.kind === 'boolean') keys.sort();
    else keys.sort((a, b) => totalOf(b) - totalOf(a) || compareLabels(a, b));

    if (keys.length > MAX_BAR_CATEGORIES) {
      const head = keys.slice(0, MAX_BAR_CATEGORIES - 1);
      const tail = keys.slice(MAX_BAR_CATEGORIES - 1);
      folded = tail.length;
      /* The tail's raw values are merged and re-aggregated — not its
         aggregates summed, which would make "Other" the mean of means. */
      const merged = new Map<string, number[]>();
      for (const key of tail) {
        for (const [s, values] of cells.get(key) ?? []) {
          merged.set(s, [...(merged.get(s) ?? []), ...values]);
        }
        cells.delete(key);
      }
      cells.set(OTHER, merged);
      keys = [...head, OTHER];
    }
  }

  return {
    ok: true,
    shape: {
      type: 'bar',
      xKind: isDate ? 'date' : 'category',
      categories: keys,
      series: series.map((s) => ({
        ...s,
        values: keys.map((key) => {
          const values = cells.get(key)?.get(s.key);
          return values ? aggregate(values, spec.aggregation) : emptyValue(spec.aggregation);
        }),
      })),
      dropped,
      folded,
    },
  };
}

function shapeLine(
  dataset: RawDataset,
  spec: ChartSpec,
  xColumn: RawColumn,
  yColumn: RawColumn | null,
  slots: Map<string, Series> | null,
  seriesOf: (row: RawRow) => Series,
): LineShape {
  const { cells, times, dropped } = collect(dataset, spec, xColumn, yColumn, seriesOf);
  const isDate = xColumn.kind === 'date';

  const keys = [...cells.keys()].sort((a, b) => (times.get(a) ?? 0) - (times.get(b) ?? 0));

  /* For a date axis the empty buckets between the first and last are real
     positions — a month with no rows is still a month — so they are filled in
     and given `emptyValue`. A numeric axis has no such notion of "in between". */
  let axisKeys = keys;
  if (isDate && keys.length > 1) {
    axisKeys = [];
    let cursor = keys[0];
    const last = keys[keys.length - 1];
    for (let guard = 0; guard < 10_000; guard += 1) {
      axisKeys.push(cursor);
      if (cursor === last) break;
      cursor = nextBucket(cursor, spec.dateBucket);
    }
  }

  return {
    type: 'line',
    xKind: isDate ? 'date' : 'number',
    xs: axisKeys.map((key) => (isDate ? bucketStart(key) : Number(key))),
    xKeys: isDate ? axisKeys : null,
    series: seriesList(slots).map((s) => ({
      ...s,
      values: axisKeys.map((key) => {
        const values = cells.get(key)?.get(s.key);
        return values ? aggregate(values, spec.aggregation) : emptyValue(spec.aggregation);
      }),
    })),
    dropped,
  };
}

export function nextBucket(key: string, bucket: DateBucket): string {
  const start = bucketStart(key);
  const date = new Date(start);
  if (bucket === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else if (bucket === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCDate(date.getUTCDate() + 1);
  return bucketKey(date.getTime(), bucket);
}

function shapeBox(
  dataset: RawDataset,
  spec: ChartSpec,
  xColumn: RawColumn,
  yColumn: RawColumn,
): BoxShape {
  const groups = new Map<string, number[]>();
  let dropped = 0;

  for (const row of dataset.rows) {
    const x = xKeyOf(row, xColumn, spec.dateBucket);
    const y = toNumber(row[yColumn.key]);
    if (!x || y === null) {
      dropped += 1;
      continue;
    }
    const list = groups.get(x.key) ?? [];
    list.push(y);
    groups.set(x.key, list);
  }

  const isDate = xColumn.kind === 'date';
  let keys = [...groups.keys()];
  let folded = 0;

  if (isDate) keys.sort();
  else keys.sort((a, b) => (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0) || compareLabels(a, b));

  if (keys.length > MAX_BOXES) {
    const tail = keys.slice(MAX_BOXES - 1);
    folded = tail.length;
    const merged = tail.flatMap((key) => groups.get(key) ?? []);
    keys = [...keys.slice(0, MAX_BOXES - 1), OTHER];
    groups.set(OTHER, merged);
  }

  return {
    type: 'box',
    xKind: isDate ? 'date' : 'category',
    boxes: keys.map((key) => boxStats(key, groups.get(key) ?? [])),
    dropped,
    folded,
  };
}

/** Tukey's five numbers, with whiskers stopping at real data points. */
export function boxStats(key: string, values: number[]): BoxStats {
  const sorted = [...values].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.5);
  const q3 = quantile(sorted, 0.75);
  const iqr = q3 - q1;
  const low = q1 - 1.5 * iqr;
  const high = q3 + 1.5 * iqr;
  const inside = sorted.filter((v) => v >= low && v <= high);
  const lowerWhisker = inside[0] ?? sorted[0] ?? 0;
  const upperWhisker = inside[inside.length - 1] ?? sorted[sorted.length - 1] ?? 0;
  const outliers = sorted.filter((v) => v < lowerWhisker || v > upperWhisker);

  return {
    key,
    n: sorted.length,
    min: sorted[0] ?? 0,
    q1,
    median,
    q3,
    max: sorted[sorted.length - 1] ?? 0,
    lowerWhisker,
    upperWhisker,
    outliers: outliers.slice(0, MAX_OUTLIERS_DRAWN),
    hiddenOutliers: Math.max(0, outliers.length - MAX_OUTLIERS_DRAWN),
  };
}

/* ------------------------------------------------------------------ */
/* The table twin                                                      */
/* ------------------------------------------------------------------ */

export interface TableTwin {
  /** Header cells. `null` marks the X column, labelled by the caller. */
  headers: string[];
  rows: (string | number | null)[][];
}

/**
 * The chart's numbers as a table.
 *
 * Not an afterthought: several of the validated series colours fall below 3:1
 * contrast on some themes, and the palette validator's relief rule is that a
 * low-contrast mark must never be the only way to read a value. This is that
 * other way. It is also the only accessible route through a dense scatter.
 */
export function tableTwin(shape: Shape): TableTwin {
  switch (shape.type) {
    case 'bar':
      return {
        headers: ['x', ...shape.series.map((s) => s.key)],
        rows: shape.categories.map((category, i) => [category, ...shape.series.map((s) => s.values[i])]),
      };
    case 'line':
      return {
        headers: ['x', ...shape.series.map((s) => s.key)],
        rows: shape.xs.map((x, i) => [shape.xKeys?.[i] ?? x, ...shape.series.map((s) => s.values[i])]),
      };
    case 'box':
      return {
        headers: ['x', 'n', 'min', 'q1', 'median', 'q3', 'max'],
        rows: shape.boxes.map((b) => [b.key, b.n, b.min, b.q1, b.median, b.q3, b.max]),
      };
    case 'scatter':
      return {
        headers: ['series', 'x', 'y'],
        rows: shape.series.flatMap((s) => s.points.map((p) => [s.key, p.x, p.y])),
      };
  }
}
