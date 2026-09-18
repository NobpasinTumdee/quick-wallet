import { KeyboardEvent, MouseEvent, ReactNode, useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Series, Shape } from '../../lib/explorerData';
import { ChartDomains } from '../../lib/explorerChartMath';
import { formatExplorerNumber, formatInstant, formatTick } from '../../lib/explorerFormat';
import {
  bandScale,
  barPath,
  linearScale,
  nearestIndex,
  nearestPoint,
  niceDomain,
  timeTicks,
} from '../../lib/explorerScales';

/**
 * One SVG system for all four chart forms — drawn once, or once per panel.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT RECHARTS, WHICH THE REST OF ANALYTICS USES
 * ---------------------------------------------------------------------------
 *   1. The hover layer. A dense scatter needs nearest-point hit testing — an
 *      8px dot you must land on dead centre is unusable — and that needs the
 *      data→pixel scales. Recharts keeps them internal.
 *   2. Recharts has no box plot, so one form would have been hand-drawn on a
 *      second axis system that would never quite match the other three.
 *   3. Small multiples. A trellis needs every panel on a coordinate system
 *      decided *outside* the panel — see below — and a library that fits its
 *      own axes has to be fought for every one of them.
 *
 * ---------------------------------------------------------------------------
 * THIS COMPONENT DOES NOT CHOOSE ITS SCALES
 * ---------------------------------------------------------------------------
 * The Y domain and the continuous X range arrive as `domains`, computed over
 * every panel after aggregation (`chartDomains`). The band axis arrives inside
 * the shape, from a frame shared by every panel. What remains here is only
 * what depends on this panel's pixel width: how many time ticks fit, and
 * which band labels to thin. Panels in one grid are the same width, so even
 * those agree.
 *
 * ---------------------------------------------------------------------------
 * MARK SPECS
 * ---------------------------------------------------------------------------
 * Hairline recessive grid; 2px lines; 8px markers with a surface-coloured ring
 * so overlapping dots stay distinct; bars rounded 4px at the data end only and
 * separated by a 2px gap rather than outlined. Text wears text tokens — never
 * the series colour — and identity comes from the legend and swatches.
 */

const PLOT_HEIGHT = 340;
const COMPACT_PLOT_HEIGHT = 220;
const TOP = 18;
const FONT_WIDTH = 6.6;
const BAR_GAP = 2;
/** The extra row that carries the outer level of a nested band axis. */
const NEST_ROW = 16;

interface Props {
  shape: Shape;
  /** The shared coordinate system — the same object for every panel. */
  domains: ChartDomains;
  /** A panel in a grid: shorter, and no direct labels (the legend is shared). */
  compact?: boolean;
  /**
   * The colour for a series — the user's choice if they made one, otherwise
   * its validated palette slot. Decided by the page, which owns that state, so
   * this component only ever draws what it is told.
   */
  colorOf: (series: Series) => string;
  locale: string;
  xLabel: string;
  yLabel: string;
  /**
   * A band (or line bucket) key as its labelled levels, outer to inner. One
   * level for a plain axis; several when X variables are nested.
   */
  bandLabel: (key: string) => string[];
  seriesLabel: (key: string) => string;
}

interface Hover {
  index: number;
  /** Pixel anchor for the tooltip, inside the wrapper. */
  px: number;
  py: number;
}

function useWidth(fallback = 720) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(fallback);

  useEffect(() => {
    const element = ref.current;
    if (!element) return undefined;
    const measure = () => setWidth(Math.max(260, Math.round(element.clientWidth)));
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  return [ref, width] as const;
}

const textWidth = (text: string) => text.length * FONT_WIDTH;

export function ExplorerChart(props: Props) {
  const { shape, locale, domains, compact = false } = props;
  const { t } = useTranslation();
  const hintId = useId();
  const [wrapRef, width] = useWidth(compact ? 360 : 720);
  const [hover, setHover] = useState<Hover | null>(null);

  /* A new shape invalidates whatever index was hovered — it may not exist. */
  useEffect(() => setHover(null), [shape]);

  const n = (value: number, short = false) => formatExplorerNumber(value, locale, short);
  const color = props.colorOf;
  const plotHeight = compact ? COMPACT_PLOT_HEIGHT : PLOT_HEIGHT;

  /* ---- Band keys and their labels ---- */
  const bandKeys = shape.type === 'bar' ? shape.categories : shape.type === 'box' ? shape.bands : [];
  const bandParts = useMemo(() => bandKeys.map(props.bandLabel), [bandKeys, props.bandLabel]);
  const nested = bandParts.some((parts) => parts.length > 1);

  /* ---- Y: handed down, never fitted here ---- */
  const yTickLabels = domains.y.ticks.map((tick) => n(tick, true));
  const left = Math.max(44, Math.ceil(Math.max(...yTickLabels.map(textWidth))) + 16);

  const directLabels =
    !compact && shape.type === 'line' && shape.series.length >= 2 && shape.series.length <= 4;
  const right = directLabels
    ? Math.min(140, 16 + Math.max(...shape.series.map((s) => textWidth(props.seriesLabel(s.key)))))
    : 18;

  const bottom = 46 + (nested ? NEST_ROW : 0);
  const height = TOP + plotHeight + bottom;
  const plotLeft = left;
  const plotRight = width - right;
  const plotBottom = TOP + plotHeight;

  const y = linearScale([domains.y.min, domains.y.max], [plotBottom, TOP], domains.y.ticks);

  /* ---- X: the shared range, ticked for this width ---- */
  const continuous = shape.type === 'scatter' || shape.type === 'line';
  const xIsTime = continuous && shape.xKind === 'date';
  const tickBudget = Math.max(2, Math.floor((plotRight - plotLeft) / 90));

  const xContinuous = useMemo(() => {
    if (!continuous) return null;
    const min = domains.x?.min ?? 0;
    const max = domains.x?.max ?? 1;
    if (xIsTime) {
      const span = max - min || 86_400_000;
      const pad = span * 0.02;
      const { ticks, unit } = timeTicks(min - pad, max + pad, tickBudget);
      return { min: min - pad, max: max + pad, ticks, unit };
    }
    const nice = niceDomain(min, max, tickBudget);
    return { min: nice.min, max: nice.max, ticks: nice.ticks, unit: null };
  }, [continuous, domains.x, xIsTime, tickBudget]);

  const x = xContinuous
    ? linearScale([xContinuous.min, xContinuous.max], [plotLeft, plotRight], xContinuous.ticks)
    : null;

  const band = bandScale(bandKeys.length, [plotLeft, plotRight], shape.type === 'box' ? 0.3 : 0.22);

  /* ---- Scatter points in pixel space, for drawing and hit testing ---- */
  const scatterPixels = useMemo(() => {
    if (shape.type !== 'scatter' || !x) return [];
    return shape.series.flatMap((series) =>
      series.points.map((point) => ({ px: x(point.x), py: y(point.y), point, series })),
    );
    /* `x` and `y` are rebuilt every render, so the memo keys on the inputs they
       are built from rather than on the functions themselves. */
  }, [shape, xContinuous, domains.y, plotLeft, plotRight, plotBottom]);

  /* Keyboard order for the scatter: left to right, so arrow keys sweep the plot. */
  const scatterOrder = useMemo(
    () => scatterPixels.map((_, i) => i).sort((a, b) => scatterPixels[a].px - scatterPixels[b].px),
    [scatterPixels],
  );

  const positions =
    shape.type === 'scatter' ? scatterPixels.length : shape.type === 'line' ? shape.xs.length : bandKeys.length;

  /* ---- Pointer ---- */
  function pointer(event: MouseEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const mx = ((event.clientX - rect.left) / rect.width) * width;
    const my = ((event.clientY - rect.top) / rect.height) * height;

    if (shape.type === 'scatter') {
      const index = nearestPoint(scatterPixels, mx, my, 24);
      setHover(index >= 0 ? { index, px: scatterPixels[index].px, py: scatterPixels[index].py } : null);
      return;
    }
    if (shape.type === 'line' && x) {
      if (mx < plotLeft - 8 || mx > plotRight + 8) return setHover(null);
      const index = nearestIndex(shape.xs, x.invert(mx));
      setHover(index >= 0 ? { index, px: x(shape.xs[index]), py: my } : null);
      return;
    }
    const index = band.indexAt(mx);
    setHover(index >= 0 ? { index, px: band(index) + band.bandwidth / 2, py: my } : null);
  }

  /* ---- Keyboard: the same positions the pointer can reach ---- */
  function key(event: KeyboardEvent<SVGSVGElement>) {
    if (!positions) return;
    const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
    if (event.key === 'Escape') return setHover(null);
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      return focusIndex(event.key === 'Home' ? 0 : positions - 1);
    }
    if (!step) return;
    event.preventDefault();

    const current =
      shape.type === 'scatter' && hover ? scatterOrder.indexOf(hover.index) : (hover?.index ?? -1);
    focusIndex(Math.min(positions - 1, Math.max(0, current + step)));
  }

  function focusIndex(ordinal: number) {
    if (shape.type === 'scatter') {
      const index = scatterOrder[ordinal];
      if (index === undefined) return;
      setHover({ index, px: scatterPixels[index].px, py: scatterPixels[index].py });
    } else if (shape.type === 'line' && x) {
      setHover({ index: ordinal, px: x(shape.xs[ordinal]), py: TOP + plotHeight / 3 });
    } else {
      setHover({ index: ordinal, px: band(ordinal) + band.bandwidth / 2, py: TOP + plotHeight / 3 });
    }
  }

  /* ---- Band labels: thinned rather than rotated when they collide ---- */
  const innerLabels = bandParts.map((parts) => parts[parts.length - 1] ?? '');
  const labelEvery = useMemo(() => {
    if (!innerLabels.length) return 1;
    const widest = Math.max(...innerLabels.map(textWidth));
    return Math.max(1, Math.ceil((widest + 8) / Math.max(1, band.step)));
  }, [innerLabels.join('\n'), band.step]);

  /* The outer levels of a nested axis, as runs of adjacent bands sharing a
     parent. The frame keeps children of one parent together, so each parent
     is exactly one run. */
  const outerRuns = useMemo(() => {
    if (!nested) return [];
    const runs: { label: string; from: number; to: number }[] = [];
    bandParts.forEach((parts, i) => {
      const label = parts.slice(0, -1).join(' · ');
      const last = runs[runs.length - 1];
      if (last && last.label === label) last.to = i;
      else runs.push({ label, from: i, to: i });
    });
    return runs;
  }, [bandParts, nested]);

  /* ---- Tooltip body ---- */
  function swatch(series: Series) {
    return <span className="xp-swatch" style={{ background: color(series) }} aria-hidden="true" />;
  }
  const heading = (index: number) => (bandParts[index] ?? []).join(' · ');

  function tooltipFor(): ReactNode {
    if (!hover) return null;
    if (shape.type === 'scatter') {
      const hit = scatterPixels[hover.index];
      if (!hit) return null;
      return (
        <>
          {shape.series.length > 1 && (
            <div className="xp-tip-row xp-tip-head">
              {swatch(hit.series)}
              {props.seriesLabel(hit.series.key)}
            </div>
          )}
          <div className="xp-tip-row">
            <span>{props.xLabel}</span>
            <strong>{xIsTime ? formatInstant(hit.point.x, locale) : n(hit.point.x)}</strong>
          </div>
          <div className="xp-tip-row">
            <span>{shape.series.length > 1 ? props.seriesLabel(hit.series.key) : props.yLabel}</span>
            <strong>{n(hit.point.y)}</strong>
          </div>
        </>
      );
    }
    if (shape.type === 'line' || shape.type === 'bar') {
      const head =
        shape.type === 'bar'
          ? heading(hover.index)
          : shape.xKeys?.[hover.index] !== undefined
            ? props.bandLabel(shape.xKeys[hover.index]).join(' · ')
            : n(shape.xs[hover.index]);
      return (
        <>
          <div className="xp-tip-row xp-tip-head">{head}</div>
          {shape.series.map((s) => (
            <div key={s.key} className="xp-tip-row">
              <span>
                {shape.series.length > 1 && swatch(s)}
                {shape.series.length > 1 ? props.seriesLabel(s.key) : props.yLabel}
              </span>
              <strong>{s.values[hover.index] === null ? '—' : n(s.values[hover.index] as number)}</strong>
            </div>
          ))}
        </>
      );
    }

    const drawn = shape.series
      .map((s) => ({ s, box: s.boxes[hover.index] }))
      .filter((entry): entry is { s: (typeof shape.series)[number]; box: NonNullable<typeof entry.box> } =>
        Boolean(entry.box),
      );
    if (drawn.length === 0) return null;

    /* One box: the full five-number reading. Several: one line each, or the
       tooltip would be taller than the chart. */
    if (shape.series.length === 1) {
      const { box } = drawn[0];
      return (
        <>
          <div className="xp-tip-row xp-tip-head">{heading(hover.index)}</div>
          <div className="xp-tip-row"><span>{t('explorer.statN')}</span><strong>{n(box.n)}</strong></div>
          <div className="xp-tip-row"><span>{t('explorer.statMedian')}</span><strong>{n(box.median)}</strong></div>
          <div className="xp-tip-row">
            <span>{t('explorer.statIqr')}</span>
            <strong>{n(box.q1)} – {n(box.q3)}</strong>
          </div>
          <div className="xp-tip-row">
            <span>{t('explorer.statRange')}</span>
            <strong>{n(box.min)} – {n(box.max)}</strong>
          </div>
          {box.outliers.length + box.hiddenOutliers > 0 && (
            <div className="xp-tip-row">
              <span>{t('explorer.statOutliers')}</span>
              <strong>{n(box.outliers.length + box.hiddenOutliers)}</strong>
            </div>
          )}
        </>
      );
    }
    return (
      <>
        <div className="xp-tip-row xp-tip-head">{heading(hover.index)}</div>
        {drawn.map(({ s, box }) => (
          <div key={s.key} className="xp-tip-row">
            <span>
              {swatch(s)}
              {props.seriesLabel(s.key)}
            </span>
            <strong>
              {n(box.median)} <small>({n(box.q1)} – {n(box.q3)}, n={n(box.n)})</small>
            </strong>
          </div>
        ))}
      </>
    );
  }

  const tooltip = hover ? tooltipFor() : null;

  return (
    <div className={compact ? 'xp-chart is-compact' : 'xp-chart'} ref={wrapRef}>
      {/* No legend here: the page renders one interactive legend above every
          panel, where each swatch opens a colour picker. */}
      <div className="xp-plot">
        <svg
          className="xp-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          tabIndex={0}
          aria-label={t('explorer.chartAria', { x: props.xLabel, y: props.yLabel })}
          aria-describedby={hintId}
          onMouseMove={pointer}
          onMouseLeave={() => setHover(null)}
          onKeyDown={key}
          onBlur={() => setHover(null)}
        >
          {/* ---- Y grid and ticks ---- */}
          {domains.y.ticks.map((tick, i) => (
            <g key={`y${tick}`}>
              <line className="xp-grid" x1={plotLeft} x2={plotRight} y1={y(tick)} y2={y(tick)} />
              <text className="xp-tick" x={plotLeft - 8} y={y(tick) + 3.5} textAnchor="end">
                {yTickLabels[i]}
              </text>
            </g>
          ))}

          {/* ---- X ticks ---- */}
          {x && xContinuous &&
            xContinuous.ticks.map((tick) => (
              <text key={`x${tick}`} className="xp-tick" x={x(tick)} y={plotBottom + 18} textAnchor="middle">
                {xIsTime && xContinuous.unit ? formatTick(tick, xContinuous.unit, locale) : n(tick, true)}
              </text>
            ))}
          {!x &&
            bandKeys.map((k, i) =>
              i % labelEvery === 0 ? (
                <text key={`b${k}`} className="xp-tick" x={band(i) + band.bandwidth / 2} y={plotBottom + 18} textAnchor="middle">
                  {truncate(innerLabels[i], Math.max(4, Math.floor((band.step * labelEvery) / FONT_WIDTH) - 1))}
                </text>
              ) : null,
            )}

          {/* ---- The outer level of a nested axis: one label per parent,
                   with a divider where one parent ends and the next begins ---- */}
          {outerRuns.map((run, ri) => {
            const from = band(run.from) - (band.step - band.bandwidth) / 2;
            const to = band(run.to) + band.bandwidth + (band.step - band.bandwidth) / 2;
            return (
              <g key={`o${run.from}`}>
                {ri > 0 && (
                  <line className="xp-nest-divider" x1={from} x2={from} y1={plotBottom} y2={plotBottom + 18 + NEST_ROW} />
                )}
                {run.label && (
                  <text className="xp-tick xp-tick-outer" x={(from + to) / 2} y={plotBottom + 18 + NEST_ROW} textAnchor="middle">
                    {truncate(run.label, Math.max(3, Math.floor((to - from) / FONT_WIDTH) - 1))}
                  </text>
                )}
              </g>
            );
          })}

          {/* The baseline: the only axis rule drawn at full strength. */}
          <line className="xp-axis" x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} />

          {/* ---- Band highlight, under the marks ---- */}
          {hover && !continuous && (
            <rect
              className="xp-band-hover"
              x={band(hover.index) - (band.step - band.bandwidth) / 2}
              y={TOP}
              width={band.step}
              height={plotHeight}
            />
          )}

          {/* ---- Marks ---- */}
          {shape.type === 'bar' &&
            shape.series.map((series, si) => {
              const count = shape.series.length;
              const inner = (band.bandwidth - BAR_GAP * (count - 1)) / count;
              return series.values.map((value, ci) =>
                value === null ? null : (
                  <path
                    key={`${series.key}-${ci}`}
                    className="xp-bar"
                    fill={color(series)}
                    d={barPath(band(ci) + si * (inner + BAR_GAP), inner, y(value), y(0))}
                  />
                ),
              );
            })}

          {shape.type === 'line' &&
            x &&
            shape.series.map((series) => (
              <path
                key={series.key}
                className="xp-line"
                stroke={color(series)}
                d={linePath(shape.xs.map((v) => x(v)), series.values.map((v) => (v === null ? null : y(v))))}
              />
            ))}

          {shape.type === 'line' &&
            directLabels &&
            x &&
            placeLabels(
              shape.series.map((series) => {
                const last = lastIndex(series.values);
                return {
                  key: series.key,
                  slot: series.slot,
                  y: last >= 0 ? y(series.values[last] as number) : plotBottom,
                };
              }),
            ).map((label) => (
              <g key={`dl-${label.key}`}>
                <circle cx={plotRight + 6} cy={label.y - 3.5} r={3} fill={color(label)} />
                <text className="xp-direct" x={plotRight + 13} y={label.y}>
                  {props.seriesLabel(label.key)}
                </text>
              </g>
            ))}

          {shape.type === 'scatter' &&
            scatterPixels.map((p, i) => (
              <circle key={i} className="xp-dot" cx={p.px} cy={p.py} r={4} fill={color(p.series)} />
            ))}

          {/* Box plots, clustered like bars: one box per series in each band. */}
          {shape.type === 'box' &&
            shape.series.map((series, si) => {
              const count = shape.series.length;
              const inner = (band.bandwidth - BAR_GAP * (count - 1)) / count;
              const fill = color(series);
              return series.boxes.map((box, i) => {
                if (!box) return null;
                const bx = band(i) + si * (inner + BAR_GAP);
                const cx = bx + inner / 2;
                const top = y(box.q3);
                const bottomY = y(box.q1);
                return (
                  <g key={`${series.key}-${i}`}>
                    <line className="xp-whisker" x1={cx} x2={cx} y1={y(box.upperWhisker)} y2={top} />
                    <line className="xp-whisker" x1={cx} x2={cx} y1={bottomY} y2={y(box.lowerWhisker)} />
                    <line className="xp-whisker" x1={cx - inner / 4} x2={cx + inner / 4} y1={y(box.upperWhisker)} y2={y(box.upperWhisker)} />
                    <line className="xp-whisker" x1={cx - inner / 4} x2={cx + inner / 4} y1={y(box.lowerWhisker)} y2={y(box.lowerWhisker)} />
                    <rect
                      className="xp-box"
                      x={bx}
                      y={top}
                      width={Math.max(1, inner)}
                      height={Math.max(1, bottomY - top)}
                      rx={Math.min(4, inner / 4)}
                      fill={fill}
                    />
                    <line className="xp-median" x1={bx} x2={bx + inner} y1={y(box.median)} y2={y(box.median)} />
                    {box.outliers.map((value, oi) => (
                      <circle key={oi} className="xp-dot" cx={cx} cy={y(value)} r={compact ? 3 : 4} fill={fill} />
                    ))}
                  </g>
                );
              });
            })}

          {/* ---- Hover markers, over the marks ---- */}
          {hover && shape.type === 'scatter' && scatterPixels[hover.index] && (
            <circle className="xp-focus" cx={hover.px} cy={hover.py} r={7} />
          )}
          {hover && shape.type === 'line' && x && (
            <>
              <line className="xp-crosshair" x1={hover.px} x2={hover.px} y1={TOP} y2={plotBottom} />
              {shape.series.map((series) => {
                const value = series.values[hover.index];
                return value === null ? null : (
                  <circle
                    key={`h-${series.key}`}
                    className="xp-dot"
                    cx={hover.px}
                    cy={y(value)}
                    r={4.5}
                    fill={color(series)}
                  />
                );
              })}
            </>
          )}

          {/* ---- Axis titles ---- */}
          <text className="xp-axis-title" x={plotLeft} y={TOP - 6}>
            {truncate(props.yLabel, Math.floor((plotRight - plotLeft) / FONT_WIDTH))}
          </text>
          <text className="xp-axis-title" x={(plotLeft + plotRight) / 2} y={height - 8} textAnchor="middle">
            {truncate(props.xLabel, Math.floor((plotRight - plotLeft) / FONT_WIDTH))}
          </text>
        </svg>

        {tooltip && hover && (
          <div
            className="xp-tooltip"
            role="status"
            style={{
              left: hover.px > width - 240 ? undefined : hover.px + 14,
              right: hover.px > width - 240 ? width - hover.px + 14 : undefined,
              top: Math.max(4, Math.min(hover.py - 12, height - 150)),
            }}
          >
            {tooltip}
          </div>
        )}
      </div>

      <p id={hintId} className="sr-only">
        {t('explorer.keyboardHint')}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ */

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, Math.max(1, max - 1))}…` : text;
}

function lastIndex(values: (number | null)[]): number {
  for (let i = values.length - 1; i >= 0; i -= 1) if (values[i] !== null) return i;
  return -1;
}

/**
 * A polyline that breaks at nulls.
 *
 * A null is a position with no value — the mean of an empty month — and
 * joining across it would draw a line through a place where there is no data,
 * inventing a trend. Each run of values is its own subpath.
 */
export function linePath(xs: number[], ys: (number | null)[]): string {
  let d = '';
  let pen = false;
  for (let i = 0; i < xs.length; i += 1) {
    const value = ys[i];
    if (value === null || value === undefined) {
      pen = false;
      continue;
    }
    d += `${pen ? 'L' : 'M'}${xs[i].toFixed(1)},${value.toFixed(1)}`;
    pen = true;
  }
  return d;
}

/**
 * Nudge end-of-line labels apart so two series ending near the same value do
 * not print on top of each other.
 */
function placeLabels<T extends { y: number }>(labels: T[], gap = 13): T[] {
  const sorted = [...labels].sort((a, b) => a.y - b.y).map((label) => ({ ...label }));
  for (let i = 1; i < sorted.length; i += 1) {
    if (sorted[i].y - sorted[i - 1].y < gap) sorted[i].y = sorted[i - 1].y + gap;
  }
  return sorted;
}
