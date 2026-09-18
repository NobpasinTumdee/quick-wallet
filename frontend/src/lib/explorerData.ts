import { quantile } from './boxPlotMath';
import { PALETTE_SIZE, PairScope, seriesCap } from './explorerPalette';

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
 * ---------------------------------------------------------------------------
 * THE FRAME, AND WHY FACETS NEED ONE
 * ---------------------------------------------------------------------------
 * A faceted chart is only comparable if every panel is drawn in the same
 * coordinate system. For a numeric axis that means a shared min and max. For a
 * band axis it means something a min and max cannot express: the *same
 * categories in the same order* — if "Food" is the first bar in one panel and
 * the fourth in the next, the eye compares the wrong bars. And for colour it
 * means the same set of series, decided once, not per panel.
 *
 * So shaping is two steps. `buildFrame` reads every filtered row and fixes the
 * shared structure — band order, the line's x positions, which series exist
 * and which fold into Other. `shapeWithFrame` then fills that structure from
 * one partition's rows. Without facets the partition is the whole table, and
 * the result is exactly what one step would have produced.
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
 * step by a check that reads both files.
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
export type Role = 'x' | 'y' | 'overlay' | 'page';

export interface ChartSpec {
  type: ChartType;
  /** Outer to inner. More than one only on band charts — see MAX_X_VARS. */
  xVars: string[];
  /** Plotted on one shared Y scale. More than one takes the colour channel. */
  yVars: string[];
  /** Colour by this column. Paused while several Y variables are mapped. */
  overlay: string | null;
  /** One panel per value of this column. */
  pageBy: string | null;
  aggregation: Aggregation;
  dateBucket: DateBucket;
}

/**
 * Sentinels for "no value" and "the folded tail", rendered with translated
 * labels. Plain ASCII on purpose: an earlier version used a control-character
 * prefix to make collisions impossible, and the NUL byte made git classify the
 * whole file as binary. A real category literally named `__blank__` is the
 * accepted trade.
 */
export const BLANK = '__blank__';
export const OTHER = '__other__';

/**
 * Joins the parts of a nested X key. U+241F is the printable *symbol* for a
 * unit separator — visible if it ever leaked into a label, and not something a
 * finance sheet contains. Labels are built by splitting on it and formatting
 * each level by its own column's kind.
 */
export const NEST = ' ␟ ';

export function nestKey(parts: string[]): string {
  return parts.join(NEST);
}

export function splitNestKey(key: string): string[] {
  return key.split(NEST);
}

/* ------------------------------------------------------------------ */
/* What each chart accepts                                             */
/* ------------------------------------------------------------------ */

/**
 * Column kinds each role will take, per chart. `null` means the role is not
 * used by that chart at all — a box plot has no colour overlay, because each
 * box already *is* a group and a second encoding of the same thing is noise.
 *
 * Page By takes anything with a manageable number of distinct values — never a
 * raw number, which would make a panel per amount.
 */
export const ACCEPTS: Record<ChartType, Record<Role, ColumnKind[] | null>> = {
  scatter: {
    x: ['number', 'date'],
    y: ['number'],
    overlay: ['category', 'boolean'],
    page: ['category', 'boolean', 'date'],
  },
  bar: {
    x: ['category', 'boolean', 'date'],
    y: ['number'],
    overlay: ['category', 'boolean'],
    page: ['category', 'boolean', 'date'],
  },
  line: {
    x: ['date', 'number'],
    y: ['number'],
    overlay: ['category', 'boolean'],
    page: ['category', 'boolean', 'date'],
  },
  box: {
    x: ['category', 'boolean', 'date'],
    y: ['number'],
    overlay: null,
    page: ['category', 'boolean', 'date'],
  },
};

/**
 * How many X variables a chart can nest.
 *
 * Several X columns concatenate into a nested *band* axis — "Food – Lunch" —
 * which only a band chart has. A scatter or line has a continuous X, and "two
 * numeric X columns" has no position meaning there, so those take one. Three
 * levels is the practical limit before the flattened labels stop being
 * readable at any width.
 */
export const MAX_X_VARS: Record<ChartType, number> = { scatter: 1, line: 1, bar: 3, box: 3 };

/**
 * How many Y variables a chart can plot at once.
 *
 * Each Y variable is its own series and takes its own palette colour. The cap
 * is the palette's validated limit for the chart type — three for a scatter,
 * where every pair of colours is on screen together, eight otherwise — so that
 * a metric never has to fold into "Other". Folding metrics would *add Amount
 * to Fees*, which is not a number that means anything.
 */
export function maxYVars(type: ChartType): number {
  return seriesCap(pairScope(type));
}

/** Charts that summarise many rows into one value per position. */
export function usesAggregation(type: ChartType): boolean {
  return type === 'bar' || type === 'line';
}

/**
 * Which colour-pair rule a chart falls under. A scatter can put any two groups
 * next to each other, so it is held to every pair; bars, lines and boxes only
 * ever show neighbours side by side. See `explorerPalette`.
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

/** The Y columns actually plotted. A count counts rows and plots none of them. */
export function metricsOf(spec: ChartSpec): string[] {
  return usesAggregation(spec.type) && spec.aggregation === 'count' ? [] : spec.yVars;
}

export type SeriesMode = 'single' | 'overlay' | 'metric';

/**
 * What the colour channel means for this spec.
 *
 * Several Y variables take it over — each metric is a series — which is the
 * same constraint Tableau imposes when Measure Names is on Color. An overlay
 * column is kept in the spec but paused, so removing a Y variable brings it
 * back rather than making the user pick it again.
 */
export function seriesMode(spec: ChartSpec): SeriesMode {
  if (metricsOf(spec).length > 1) return 'metric';
  if (spec.overlay && ACCEPTS[spec.type].overlay) return 'overlay';
  return 'single';
}

/** Whether the date-bucket control means anything for this selection. */
export function usesDateBucket(spec: ChartSpec, columns: RawColumn[]): boolean {
  const xDate =
    spec.type !== 'scatter' && spec.xVars.some((key) => columnFor(columns, key)?.kind === 'date');
  return xDate || columnFor(columns, spec.pageBy)?.kind === 'date';
}

export type SpecProblem =
  | 'needX'
  | 'badX'
  | 'tooManyX'
  | 'needY'
  | 'badY'
  | 'tooManyY'
  | 'badOverlay'
  | 'badPage'
  | 'tooManyBuckets'
  | 'tooManyFacets';

/**
 * The first reason this spec cannot be drawn, or null.
 *
 * Returned as a code so the UI can say it in the user's language, and so a test
 * can assert on the reason rather than on English prose.
 */
export function validateSpec(spec: ChartSpec, columns: RawColumn[]): SpecProblem | null {
  if (spec.xVars.length === 0) return 'needX';
  if (spec.xVars.some((key) => !acceptsColumn(spec.type, 'x', columnFor(columns, key)))) return 'badX';
  if (spec.xVars.length > MAX_X_VARS[spec.type]) return 'tooManyX';

  /* A count counts rows and needs no measure; everything else needs one. */
  const countOnly = usesAggregation(spec.type) && spec.aggregation === 'count';
  if (!countOnly) {
    const metrics = metricsOf(spec);
    if (metrics.length === 0) return 'needY';
    if (metrics.some((key) => !acceptsColumn(spec.type, 'y', columnFor(columns, key)))) return 'badY';
    if (metrics.length > maxYVars(spec.type)) return 'tooManyY';
  }

  if (spec.overlay && seriesMode(spec) !== 'metric') {
    if (!acceptsColumn(spec.type, 'overlay', columnFor(columns, spec.overlay))) return 'badOverlay';
  }

  if (spec.pageBy && !acceptsColumn(spec.type, 'page', columnFor(columns, spec.pageBy))) {
    return 'badPage';
  }

  return null;
}

/* Column keys the defaults reach for first. Keys, not headers — the headers are
   display text and may one day be translated. */
const TIME_KEYS = ['date', 'buyDate', 'nextDueDate', 'deadline', 'period', 'createdAt'];
const CATEGORY_KEYS = ['category', 'type', 'status', 'frequency', 'symbol', 'title', 'name'];

/**
 * X preferences depend on the chart, because each form has a natural reading.
 * A bar or box compares groups, so it opens on categories. A line or scatter
 * shows change, so it opens on time.
 */
const PREFERRED_X: Record<ChartType, string[]> = {
  bar: [...CATEGORY_KEYS, ...TIME_KEYS],
  box: [...CATEGORY_KEYS, ...TIME_KEYS],
  line: TIME_KEYS,
  scatter: TIME_KEYS,
};
const PREFERRED_Y = ['amount', 'totalAmount', 'currentBalance', 'targetAmount', 'buyPrice', 'quantity'];

function pick(type: ChartType, role: 'x' | 'y', columns: RawColumn[], avoid: string[] = []): string | null {
  const ok = columns.filter(
    (column) => acceptsColumn(type, role, column) && !avoid.includes(column.key),
  );
  for (const key of role === 'x' ? PREFERRED_X[type] : PREFERRED_Y) {
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
 * purpose. Variables the new chart cannot use are dropped; lists longer than
 * the new chart allows are trimmed from the end, keeping the outermost X and the
 * first Y — the ones the user chose first.
 */
export function defaultSpec(
  type: ChartType,
  columns: RawColumn[],
  previous?: Partial<ChartSpec>,
): ChartSpec {
  const keepAll = (role: 'x' | 'y', keys: string[] | undefined, limit: number) =>
    [...new Set(keys ?? [])]
      .filter((key) => acceptsColumn(type, role, columnFor(columns, key)))
      .slice(0, limit);
  const keepOne = (role: Role, key: string | null | undefined) =>
    key && acceptsColumn(type, role, columnFor(columns, key)) ? key : null;

  let xVars = keepAll('x', previous?.xVars, MAX_X_VARS[type]);
  if (xVars.length === 0) {
    const x = pick(type, 'x', columns);
    xVars = x ? [x] : [];
  }

  let yVars = keepAll('y', previous?.yVars, maxYVars(type));
  if (yVars.length === 0) {
    const y = pick(type, 'y', columns, xVars);
    yVars = y ? [y] : [];
  }

  return {
    type,
    xVars,
    yVars,
    overlay: keepOne('overlay', previous?.overlay),
    pageBy: keepOne('page', previous?.pageBy),
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
 * Parsed in UTC on purpose. A bucket computed in local time drifts a day either
 * side of midnight depending on where the reader lives, which would put the 1st
 * of the month into the previous month for everyone west of Greenwich.
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

export function nextBucket(key: string, bucket: DateBucket): string {
  const date = new Date(bucketStart(key));
  if (bucket === 'year') date.setUTCFullYear(date.getUTCFullYear() + 1);
  else if (bucket === 'month') date.setUTCMonth(date.getUTCMonth() + 1);
  else date.setUTCDate(date.getUTCDate() + 1);
  return bucketKey(date.getTime(), bucket);
}

/**
 * A row's value in a *discrete* column: the category, true/false, or the date
 * bucket. Null when a date does not parse — that row has no position here.
 */
export function discreteKey(row: RawRow, column: RawColumn, bucket: DateBucket): string | null {
  const raw = row[column.key];
  if (column.kind === 'date') {
    const time = toTime(raw);
    return time === null ? null : bucketKey(time, bucket);
  }
  return toCategory(raw);
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
 * What an empty position means, for a given aggregation. Nothing summed or
 * counted is 0; the mean or median of nothing does not exist.
 */
export function emptyValue(how: Aggregation): number | null {
  return how === 'sum' || how === 'count' ? 0 : null;
}

/* ------------------------------------------------------------------ */
/* Series                                                              */
/* ------------------------------------------------------------------ */

export interface Series {
  /**
   * Identity. An overlay value, a Y column's key, or '' for the single series.
   * Custom colours are stored against it, so it must stay stable across
   * filters and facets.
   */
  key: string;
  /** Rank in the stable ordering, or null for the folded "Other" bucket. */
  slot: number | null;
}

/**
 * Every value of the group column, most frequent first — over the *whole
 * table*, so a colour follows its entity through any filter or facet.
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
 * Map each group value to a series, folding the rest into Other.
 *
 * `ranking` is over the *unfiltered* table and gives each value its slot, and
 * its slot is its colour. `visible` is what survives the filters; of those, the
 * first `cap` that *can* be coloured are drawn as their own series. A value can
 * be coloured if it has one of the eight palette slots or the user chose a
 * colour for it — a ninth series is never a generated or recycled hue.
 */
export function groupSlots(
  ranking: string[],
  cap: number,
  visible: Iterable<string> = ranking,
  customColored: ReadonlySet<string> = new Set(),
): Map<string, Series> {
  const index = new Map(ranking.map((value, i) => [value, i]));
  const shown = [...new Set(visible)].sort(
    (a, b) => (index.get(a) ?? Infinity) - (index.get(b) ?? Infinity) || compareLabels(a, b),
  );

  const map = new Map<string, Series>();
  let drawn = 0;
  for (const value of shown) {
    const slot = index.get(value) ?? -1;
    const colorable = (slot >= 0 && slot < PALETTE_SIZE) || customColored.has(value);
    if (colorable && drawn < cap) {
      map.set(value, { key: value, slot: slot >= 0 ? slot : null });
      drawn += 1;
    } else {
      map.set(value, { key: OTHER, slot: null });
    }
  }
  return map;
}

/* ------------------------------------------------------------------ */
/* Limits                                                              */
/* ------------------------------------------------------------------ */

/**
 * A scatter draws one SVG node per point. Past a few thousand, hover and resize
 * stutter and the extra points only overplot. Above this they are sampled, and
 * the UI says so.
 */
export const MAX_SCATTER_POINTS = 4000;

/** Past this a bar chart is a barcode. The tail folds into Other. */
export const MAX_BAR_CATEGORIES = 24;

/** Past this a box plot is unreadable. The tail folds into Other. */
export const MAX_BOXES = 16;

/**
 * A time axis with more bars than this is noise at any screen size. Rather than
 * draw it — or fold months into "Other", which means nothing — the explorer
 * asks for a coarser bucket.
 */
export const MAX_DATE_BARS = 180;

/** Outliers per box, beyond which the rest are counted rather than drawn. */
export const MAX_OUTLIERS_DRAWN = 200;

/* ------------------------------------------------------------------ */
/* The frame                                                           */
/* ------------------------------------------------------------------ */

export interface ShapeOptions {
  /**
   * The rows group colours are ranked over — the unfiltered table. Defaults to
   * the rows being drawn, which is right only when nothing is filtered.
   */
  rankRows?: RawRow[];
  /** Group values (or Y columns) the user has given a colour of their own. */
  customColored?: ReadonlySet<string>;
  /** Point budget for a scatter. Facets split it between panels. */
  maxPoints?: number;
}

export interface ShapeFrame {
  mode: SeriesMode;
  /** Every series any panel may draw, in slot order, Other last. */
  series: Series[];
  /** Overlay value → the series it is drawn as. Overlay mode only. */
  seriesOf: Map<string, Series> | null;
  /** Band keys, globally ordered, the tail already folded to OTHER. */
  bands: string[] | null;
  /** Raw band key → the band it is drawn in (itself, or OTHER). */
  bandOf: Map<string, string> | null;
  /** Bands folded into Other, for the note. */
  foldedBands: number;
  /** Overlay values folded into Other, for the note. */
  foldedGroups: number;
  /** Line X positions — date bucket keys (gaps filled) or numbers. */
  lineKeys: string[] | null;
  xKind: 'number' | 'date' | 'band';
}

export type FrameResult = { ok: true; frame: ShapeFrame } | { ok: false; problem: SpecProblem };

/** A row's nested band key across every X level, or null if a level has none. */
function bandKeyOf(row: RawRow, levels: RawColumn[], bucket: DateBucket): string | null {
  const parts: string[] = [];
  for (const level of levels) {
    const part = discreteKey(row, level, bucket);
    if (part === null) return null;
    parts.push(part);
  }
  return nestKey(parts);
}

/**
 * Order the band keys so the nesting survives.
 *
 * Sorting flat keys by value would scatter "Food – Lunch" and "Food – Dinner"
 * across the axis and destroy the grouping the second X variable was added to
 * show. So each level is ranked on its own — dates chronologically, yes/no as
 * no-then-yes, categories by `levelWeight` — and keys sort by that tuple, outer
 * level first. With one level this is the old behaviour exactly.
 */
function orderBands(
  keys: string[],
  levels: RawColumn[],
  weight: (level: number, value: string) => number,
): string[] {
  const rankOf = levels.map((level, depth) => {
    const values = [...new Set(keys.map((key) => splitNestKey(key)[depth]))];
    if (level.kind === 'date') values.sort();
    else if (level.kind === 'boolean') values.sort();
    else values.sort((a, b) => weight(depth, b) - weight(depth, a) || compareLabels(a, b));
    return new Map(values.map((value, i) => [value, i]));
  });

  return [...keys].sort((a, b) => {
    const pa = splitNestKey(a);
    const pb = splitNestKey(b);
    for (let depth = 0; depth < levels.length; depth += 1) {
      const diff = (rankOf[depth].get(pa[depth]) ?? 0) - (rankOf[depth].get(pb[depth]) ?? 0);
      if (diff) return diff;
    }
    return 0;
  });
}

/**
 * The structure every panel shares, read from all the filtered rows.
 */
export function buildFrame(
  rows: RawRow[],
  spec: ChartSpec,
  columns: RawColumn[],
  options: ShapeOptions = {},
): FrameResult {
  const problem = validateSpec(spec, columns);
  if (problem) return { ok: false, problem };

  const mode = seriesMode(spec);
  const metrics = metricsOf(spec);
  const xLevels = spec.xVars.map((key) => columnFor(columns, key) as RawColumn);

  /* ---- Series ---- */
  let series: Series[];
  let seriesOf: Map<string, Series> | null = null;
  let foldedGroups = 0;

  if (mode === 'metric') {
    /* One series per Y column, in the order the user added them. The cap is
       enforced by validation, so every metric has a real palette slot. */
    series = metrics.map((key, slot) => ({ key, slot }));
  } else if (mode === 'overlay') {
    const overlay = spec.overlay as string;
    seriesOf = groupSlots(
      rankGroups(options.rankRows ?? rows, overlay),
      seriesCap(pairScope(spec.type)),
      rows.map((row) => toCategory(row[overlay])),
      options.customColored,
    );
    const unique = new Map<string, Series>();
    for (const [value, s] of seriesOf) {
      if (s.key === OTHER && value !== OTHER) foldedGroups += 1;
      if (!unique.has(s.key)) unique.set(s.key, s);
    }
    series = [...unique.values()].sort((a, b) => (a.slot ?? Infinity) - (b.slot ?? Infinity));
  } else {
    series = [{ key: '', slot: 0 }];
  }

  /* ---- Bands ---- */
  let bands: string[] | null = null;
  let bandOf: Map<string, string> | null = null;
  let foldedBands = 0;

  if (spec.type === 'bar' || spec.type === 'box') {
    const firstMetric = metrics[0] ?? null;
    const counts = new Map<string, number>();
    /* Per-level weights: a bar's categories rank by their total, a box's by
       how many rows they hold — the same orderings the one-level charts had. */
    const levelValues = xLevels.map(() => new Map<string, number[]>());

    for (const row of rows) {
      const key = bandKeyOf(row, xLevels, spec.dateBucket);
      if (key === null) continue;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      const parts = splitNestKey(key);
      const y = firstMetric ? toNumber(row[firstMetric]) : 1;
      if (y === null) continue;
      parts.forEach((part, depth) => {
        const list = levelValues[depth].get(part) ?? [];
        list.push(y);
        levelValues[depth].set(part, list);
      });
    }

    const weight = (depth: number, value: string) => {
      const values = levelValues[depth].get(value) ?? [];
      if (spec.type === 'box') return values.length;
      return aggregate(values, firstMetric ? spec.aggregation : 'count') ?? 0;
    };

    let keys = orderBands([...counts.keys()], xLevels, weight);
    const hasDate = xLevels.some((level) => level.kind === 'date');
    const limit = spec.type === 'box' ? MAX_BOXES : MAX_BAR_CATEGORIES;
    bandOf = new Map(keys.map((key) => [key, key]));

    if (hasDate) {
      /* Time is never folded: "Other" months mean nothing. Too many, and the
         explorer asks for a coarser bucket instead. */
      if (keys.length > (spec.type === 'box' ? MAX_BOXES : MAX_DATE_BARS)) {
        return { ok: false, problem: 'tooManyBuckets' };
      }
    } else if (keys.length > limit) {
      const tail = keys.slice(limit - 1);
      foldedBands = tail.length;
      for (const key of tail) bandOf.set(key, OTHER);
      keys = [...keys.slice(0, limit - 1), OTHER];
    }
    bands = keys;
  }

  /* ---- Line positions ---- */
  let lineKeys: string[] | null = null;
  if (spec.type === 'line') {
    const x = xLevels[0];
    const seen = new Set<string>();
    for (const row of rows) {
      if (x.kind === 'date') {
        const time = toTime(row[x.key]);
        if (time !== null) seen.add(bucketKey(time, spec.dateBucket));
      } else {
        const value = toNumber(row[x.key]);
        if (value !== null) seen.add(String(value));
      }
    }
    const sorted =
      x.kind === 'date' ? [...seen].sort() : [...seen].sort((a, b) => Number(a) - Number(b));

    /* On a date axis the empty buckets between the first and last are real
       positions — a month with no rows is still a month. Filled once, here, so
       every panel shares the same months even where its own data is sparse. */
    if (x.kind === 'date' && sorted.length > 1) {
      lineKeys = [];
      let cursor = sorted[0];
      const last = sorted[sorted.length - 1];
      for (let guard = 0; guard < 10_000; guard += 1) {
        lineKeys.push(cursor);
        if (cursor === last) break;
        cursor = nextBucket(cursor, spec.dateBucket);
      }
    } else {
      lineKeys = sorted;
    }
  }

  const xKind: ShapeFrame['xKind'] =
    spec.type === 'bar' || spec.type === 'box'
      ? 'band'
      : xLevels[0].kind === 'date'
        ? 'date'
        : 'number';

  return {
    ok: true,
    frame: { mode, series, seriesOf, bands, bandOf, foldedBands, foldedGroups, lineKeys, xKind },
  };
}

/* ------------------------------------------------------------------ */
/* Shapes                                                              */
/* ------------------------------------------------------------------ */

export interface ScatterPoint {
  x: number;
  y: number;
  /** Index into the rows being shaped, for sampling. */
  row: number;
}

export interface ScatterShape {
  type: 'scatter';
  xKind: 'number' | 'date';
  series: (Series & { points: ScatterPoint[] })[];
  /** Points with a usable X and Y. */
  total: number;
  shown: number;
  /** Rows left out for having no usable value. */
  dropped: number;
  sampled: boolean;
}

export interface BarShape {
  type: 'bar';
  xKind: 'band';
  categories: string[];
  series: (Series & { values: (number | null)[] })[];
  dropped: number;
  folded: number;
}

export interface LineShape {
  type: 'line';
  xKind: 'number' | 'date';
  /** Sorted, and shared by every series — and every panel. */
  xs: number[];
  /** Bucket keys alongside `xs` when the axis is dates, for labelling. */
  xKeys: string[] | null;
  series: (Series & { values: (number | null)[] })[];
  dropped: number;
}

export interface BoxStats {
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
  xKind: 'band';
  bands: string[];
  /** One entry per band per series; null where a band has no rows. */
  series: (Series & { boxes: (BoxStats | null)[] })[];
  dropped: number;
  folded: number;
}

export type Shape = ScatterShape | BarShape | LineShape | BoxShape;

export type ShapeResult = { ok: true; shape: Shape } | { ok: false; problem: SpecProblem };

/**
 * FNV-1a over the row index: a stable pseudo-random keep/drop decision.
 * Stride sampling aliases with anything periodic in the data; hashing does not,
 * and still gives the same sample on every render.
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

/**
 * The (series, value) pairs one row contributes.
 *
 * In metric mode a row contributes once per Y column — the same transaction
 * is a point for Amount and a point for Fees. Otherwise it contributes once, to
 * its overlay series. A row with no usable value for a metric contributes
 * nothing for that metric only.
 */
function contributions(
  row: RawRow,
  frame: ShapeFrame,
  spec: ChartSpec,
): { series: string; value: number }[] | null {
  const metrics = metricsOf(spec);

  if (frame.mode === 'metric') {
    const out: { series: string; value: number }[] = [];
    for (const key of metrics) {
      const value = toNumber(row[key]);
      if (value !== null) out.push({ series: key, value });
    }
    return out.length ? out : null;
  }

  const seriesKey =
    frame.mode === 'overlay'
      ? (frame.seriesOf?.get(toCategory(row[spec.overlay as string]))?.key ?? OTHER)
      : '';

  if (metrics.length === 0) return [{ series: seriesKey, value: 1 }];
  const value = toNumber(row[metrics[0]]);
  return value === null ? null : [{ series: seriesKey, value }];
}

/**
 * Fill the frame from one partition's rows.
 */
export function shapeWithFrame(
  rows: RawRow[],
  spec: ChartSpec,
  columns: RawColumn[],
  frame: ShapeFrame,
  options: ShapeOptions = {},
): Shape {
  const xLevels = spec.xVars.map((key) => columnFor(columns, key) as RawColumn);

  if (spec.type === 'scatter') {
    const x = xLevels[0];
    const usable: { point: ScatterPoint; series: string }[] = [];
    let dropped = 0;

    rows.forEach((row, index) => {
      const xv = x.kind === 'date' ? toTime(row[x.key]) : toNumber(row[x.key]);
      const hits = xv === null ? null : contributions(row, frame, spec);
      if (xv === null || !hits) {
        dropped += 1;
        return;
      }
      for (const hit of hits) usable.push({ point: { x: xv, y: hit.value, row: index }, series: hit.series });
    });

    const budget = options.maxPoints ?? MAX_SCATTER_POINTS;
    const sampled = usable.length > budget;
    const ratio = sampled ? budget / usable.length : 1;
    const bySeries = new Map(frame.series.map((s) => [s.key, { ...s, points: [] as ScatterPoint[] }]));

    let shown = 0;
    for (const { point, series } of usable) {
      if (sampled && !keepSample(point.row, ratio)) continue;
      const target = bySeries.get(series);
      if (!target) continue;
      target.points.push(point);
      shown += 1;
    }

    return {
      type: 'scatter',
      xKind: x.kind === 'date' ? 'date' : 'number',
      /* Every frame series is kept, even when empty in this panel, so the
         legend and the colours are identical across facets. */
      series: [...bySeries.values()],
      total: usable.length,
      shown,
      dropped,
      sampled,
    };
  }

  /* ---- Bar, line: aggregate per (position, series) ---- */
  if (spec.type === 'bar' || spec.type === 'line') {
    const cells = new Map<string, Map<string, number[]>>();
    let dropped = 0;

    for (const row of rows) {
      let position: string | null;
      if (spec.type === 'bar') {
        const raw = bandKeyOf(row, xLevels, spec.dateBucket);
        position = raw === null ? null : (frame.bandOf?.get(raw) ?? null);
      } else {
        const x = xLevels[0];
        if (x.kind === 'date') {
          const time = toTime(row[x.key]);
          position = time === null ? null : bucketKey(time, spec.dateBucket);
        } else {
          const value = toNumber(row[x.key]);
          position = value === null ? null : String(value);
        }
      }
      const hits = position === null ? null : contributions(row, frame, spec);
      if (position === null || !hits) {
        dropped += 1;
        continue;
      }
      const bySeries = cells.get(position) ?? new Map<string, number[]>();
      for (const hit of hits) {
        const list = bySeries.get(hit.series) ?? [];
        list.push(hit.value);
        bySeries.set(hit.series, list);
      }
      cells.set(position, bySeries);
    }

    const how: Aggregation = metricsOf(spec).length === 0 ? 'count' : spec.aggregation;
    const valueAt = (position: string, series: string) => {
      const values = cells.get(position)?.get(series);
      return values ? aggregate(values, how) : emptyValue(how);
    };

    if (spec.type === 'bar') {
      const categories = frame.bands ?? [];
      return {
        type: 'bar',
        xKind: 'band',
        categories,
        series: frame.series.map((s) => ({ ...s, values: categories.map((c) => valueAt(c, s.key)) })),
        dropped,
        folded: frame.foldedBands,
      };
    }

    const keys = frame.lineKeys ?? [];
    const isDate = xLevels[0].kind === 'date';
    return {
      type: 'line',
      xKind: isDate ? 'date' : 'number',
      xs: keys.map((key) => (isDate ? bucketStart(key) : Number(key))),
      xKeys: isDate ? keys : null,
      series: frame.series.map((s) => ({ ...s, values: keys.map((key) => valueAt(key, s.key)) })),
      dropped,
    };
  }

  /* ---- Box: five numbers per (band, series) ---- */
  const groups = new Map<string, Map<string, number[]>>();
  let dropped = 0;
  for (const row of rows) {
    const raw = bandKeyOf(row, xLevels, spec.dateBucket);
    const band = raw === null ? null : (frame.bandOf?.get(raw) ?? null);
    const hits = band === null ? null : contributions(row, frame, spec);
    if (band === null || !hits) {
      dropped += 1;
      continue;
    }
    const bySeries = groups.get(band) ?? new Map<string, number[]>();
    for (const hit of hits) {
      const list = bySeries.get(hit.series) ?? [];
      list.push(hit.value);
      bySeries.set(hit.series, list);
    }
    groups.set(band, bySeries);
  }

  const bands = frame.bands ?? [];
  return {
    type: 'box',
    xKind: 'band',
    bands,
    series: frame.series.map((s) => ({
      ...s,
      boxes: bands.map((band) => {
        const values = groups.get(band)?.get(s.key);
        return values && values.length ? boxStats(values) : null;
      }),
    })),
    dropped,
    folded: frame.foldedBands,
  };
}

/**
 * One chart, no facets — the frame built from the same rows it is filled from.
 */
export function shapeData(dataset: RawDataset, spec: ChartSpec, options: ShapeOptions = {}): ShapeResult {
  const framed = buildFrame(dataset.rows, spec, dataset.columns, options);
  if (!framed.ok) return framed;
  return { ok: true, shape: shapeWithFrame(dataset.rows, spec, dataset.columns, framed.frame, options) };
}

/** Tukey's five numbers, with whiskers stopping at real data points. */
export function boxStats(values: number[]): BoxStats {
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
  /** Header cells. 'x' marks the X column and 'series' the series column. */
  headers: string[];
  rows: (string | number | null)[][];
}

/**
 * The chart's numbers as a table — the relief the palette validator requires
 * for low-contrast marks, and the accessible route through a dense scatter.
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
        headers: ['x', 'series', 'n', 'min', 'q1', 'median', 'q3', 'max'],
        rows: shape.bands.flatMap((band, i) =>
          shape.series
            .map((s) => ({ s, b: s.boxes[i] }))
            .filter(({ b }) => b !== null)
            .map(({ s, b }) => [band, s.key, b!.n, b!.min, b!.q1, b!.median, b!.q3, b!.max]),
        ),
      };
    case 'scatter':
      return {
        headers: ['series', 'x', 'y'],
        rows: shape.series.flatMap((s) => s.points.map((p) => [s.key, p.x, p.y])),
      };
  }
}
