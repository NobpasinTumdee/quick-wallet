import {
  BLANK,
  ChartSpec,
  RawColumn,
  RawDataset,
  RawRow,
  Shape,
  ShapeFrame,
  SpecProblem,
  buildFrame,
  columnFor,
  discreteKey,
  shapeWithFrame,
  tableTwin,
  validateSpec,
} from './explorerData';
import { niceDomain } from './explorerScales';

/**
 * Faceting and the shared coordinate system.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DOMAINS ARE COMPUTED OUT HERE AND NOT IN EACH CHART
 * ---------------------------------------------------------------------------
 * A trellis is for comparison, and comparison only works if every panel uses
 * the same scale. If each chart fitted its own Y axis, a panel whose largest
 * bar is 200 would draw it as tall as a panel whose largest is 20,000 — two
 * bars the same height meaning numbers a hundred times apart, which is the
 * single most misleading thing a small-multiples chart can do.
 *
 * So the charts stop choosing. Every panel's shape is built first, the Y range
 * is taken over *all of them* — after aggregation, since it is the sums that
 * are drawn, not the rows — and that one domain is handed to every panel.
 * The band axis is shared by construction: every panel is filled from the same
 * frame, so the categories and their order are identical.
 *
 * ---------------------------------------------------------------------------
 * THE LIMITS
 * ---------------------------------------------------------------------------
 * Panels multiply everything. Twelve is the most that stay legible in a grid
 * three wide and do not push the page into an unbounded scroll; past it the
 * explorer asks for a filter rather than drawing forty postage stamps. And the
 * scatter's point budget is *shared*, not per panel — twelve panels of four
 * thousand SVG nodes is fifty thousand, which stalls the page.
 */

export const MAX_FACETS = 12;

/** The scatter point budget across every panel together. */
export const MAX_SCATTER_TOTAL = 6000;

/** No panel is sampled below this, however many there are. */
export const MIN_POINTS_PER_FACET = 300;

export interface Facet {
  /** The Page By value, or null for the single unfaceted chart. */
  key: string | null;
  rows: RawRow[];
}

/**
 * Partition rows by the Page By column.
 *
 * Ordered the way the column reads: dates chronologically, yes/no as
 * no-then-yes, categories by how many rows they hold (the panels with the most
 * data first, where the eye lands). Rows whose date does not parse have no
 * panel and are counted as dropped.
 */
export function partition(
  rows: RawRow[],
  column: RawColumn,
  bucket: ChartSpec['dateBucket'],
): { facets: Facet[]; unplaced: number } {
  const groups = new Map<string, RawRow[]>();
  let unplaced = 0;

  for (const row of rows) {
    const key = discreteKey(row, column, bucket);
    if (key === null) {
      unplaced += 1;
      continue;
    }
    const list = groups.get(key);
    if (list) list.push(row);
    else groups.set(key, [row]);
  }

  const keys = [...groups.keys()];
  if (column.kind === 'date' || column.kind === 'boolean') keys.sort();
  else {
    keys.sort((a, b) => {
      if (a === BLANK) return 1;
      if (b === BLANK) return -1;
      return (groups.get(b)?.length ?? 0) - (groups.get(a)?.length ?? 0) || a.localeCompare(b);
    });
  }

  return { facets: keys.map((key) => ({ key, rows: groups.get(key) ?? [] })), unplaced };
}

export interface ChartDomains {
  y: { min: number; max: number; ticks: number[] };
  /** Continuous X only; null on a band chart, where the frame fixes the axis. */
  x: { min: number; max: number } | null;
}

/**
 * The one coordinate system every panel draws in.
 *
 * Y spans every value any panel plots. Bars include zero — a bar's length is
 * its value, and a baseline above zero draws a small difference as a large
 * one. The other forms plot positions and may fit the data.
 */
export function chartDomains(shapes: Shape[]): ChartDomains {
  const ys: number[] = [];
  const xs: number[] = [];

  for (const shape of shapes) {
    if (shape.type === 'scatter') {
      for (const s of shape.series) {
        for (const p of s.points) {
          ys.push(p.y);
          xs.push(p.x);
        }
      }
    } else if (shape.type === 'bar') {
      for (const s of shape.series) for (const v of s.values) if (v !== null) ys.push(v);
    } else if (shape.type === 'line') {
      xs.push(...shape.xs);
      for (const s of shape.series) for (const v of s.values) if (v !== null) ys.push(v);
    } else {
      for (const s of shape.series) {
        for (const b of s.boxes) if (b) ys.push(b.lowerWhisker, b.upperWhisker, ...b.outliers);
      }
    }
  }

  /* Spread would overflow the call stack on a large scatter; a loop does not. */
  const extent = (values: number[], fallback: [number, number]): [number, number] => {
    if (values.length === 0) return fallback;
    let min = Infinity;
    let max = -Infinity;
    for (const v of values) {
      if (v < min) min = v;
      if (v > max) max = v;
    }
    return [min, max];
  };

  const [ymin, ymax] = extent(ys, [0, 1]);
  const y = niceDomain(ymin, ymax, 5, shapes[0]?.type === 'bar');

  const continuous = shapes[0]?.type === 'scatter' || shapes[0]?.type === 'line';
  if (!continuous) return { y, x: null };

  const [xmin, xmax] = extent(xs, [0, 1]);
  return { y, x: { min: xmin, max: xmax } };
}

export interface FacetShape {
  key: string | null;
  rowCount: number;
  shape: Shape;
}

export interface ChartNotes {
  sampled: { shown: number; total: number } | null;
  foldedBands: number;
  foldedGroups: number;
  dropped: number;
  hiddenOutliers: number;
}

export type ChartBuild =
  | {
      ok: true;
      frame: ShapeFrame;
      facets: FacetShape[];
      domains: ChartDomains;
      notes: ChartNotes;
      faceted: boolean;
    }
  | { ok: false; problem: SpecProblem; facetCount?: number };

/**
 * Everything the page draws, from the filtered rows.
 *
 *   validate → partition (if paged) → frame over ALL filtered rows
 *     → shape each panel with that frame → domains over ALL panels
 */
export function buildChart(
  dataset: RawDataset,
  filtered: RawDataset,
  spec: ChartSpec,
  customColored: ReadonlySet<string> = new Set(),
): ChartBuild {
  const problem = validateSpec(spec, dataset.columns);
  if (problem) return { ok: false, problem };

  const pageColumn = columnFor(dataset.columns, spec.pageBy);
  let facets: Facet[] = [{ key: null, rows: filtered.rows }];
  let unplaced = 0;

  if (pageColumn) {
    const split = partition(filtered.rows, pageColumn, spec.dateBucket);
    if (split.facets.length > MAX_FACETS) {
      return { ok: false, problem: 'tooManyFacets', facetCount: split.facets.length };
    }
    facets = split.facets;
    unplaced = split.unplaced;
  }

  /* The frame reads every filtered row — not one panel's — so band order,
     line positions and the series set are the same in every panel. */
  const framed = buildFrame(filtered.rows, spec, dataset.columns, {
    rankRows: dataset.rows,
    customColored,
  });
  if (!framed.ok) return framed;

  const maxPoints = pageColumn
    ? Math.max(MIN_POINTS_PER_FACET, Math.floor(MAX_SCATTER_TOTAL / Math.max(1, facets.length)))
    : undefined;

  const shaped = facets.map((facet) => ({
    key: facet.key,
    rowCount: facet.rows.length,
    shape: shapeWithFrame(facet.rows, spec, dataset.columns, framed.frame, { maxPoints }),
  }));

  const notes: ChartNotes = {
    sampled: null,
    foldedBands: framed.frame.foldedBands,
    foldedGroups: framed.frame.foldedGroups,
    dropped: unplaced,
    hiddenOutliers: 0,
  };
  let shown = 0;
  let total = 0;
  let anySampled = false;
  for (const { shape } of shaped) {
    notes.dropped += shape.dropped;
    if (shape.type === 'scatter') {
      shown += shape.shown;
      total += shape.total;
      anySampled ||= shape.sampled;
    }
    if (shape.type === 'box') {
      for (const s of shape.series) for (const b of s.boxes) if (b) notes.hiddenOutliers += b.hiddenOutliers;
    }
  }
  if (anySampled) notes.sampled = { shown, total };

  return {
    ok: true,
    frame: framed.frame,
    facets: shaped,
    domains: chartDomains(shaped.map((f) => f.shape)),
    notes,
    faceted: Boolean(pageColumn),
  };
}

/**
 * The table twin for a faceted chart: one table, with the panel as its first
 * column — a reader comparing panels in a table wants them side by side, not
 * in twelve separate tables.
 */
export function facetTwin(facets: FacetShape[]): { headers: string[]; rows: (string | number | null)[][] } {
  const first = facets[0];
  if (!first) return { headers: [], rows: [] };
  const base = tableTwin(first.shape);
  if (first.key === null) return base;
  return {
    headers: ['page', ...base.headers],
    rows: facets.flatMap((facet) => tableTwin(facet.shape).rows.map((row) => [facet.key, ...row])),
  };
}
