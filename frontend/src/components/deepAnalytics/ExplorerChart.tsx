import { KeyboardEvent, MouseEvent, ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ChartSpec, OTHER, Shape } from '../../lib/explorerData';
import { formatExplorerNumber, formatInstant, formatTick } from '../../lib/explorerFormat';
import { seriesColor } from '../../lib/explorerPalette';
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
 * One SVG system for all four chart forms.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT RECHARTS, WHICH THE REST OF ANALYTICS USES
 * ---------------------------------------------------------------------------
 * Three reasons, in order of weight:
 *
 *   1. The hover layer. A dense scatter needs nearest-point hit testing — an
 *      8px dot you must land on dead centre is unusable — and that needs the
 *      data→pixel scales. Recharts keeps them internal.
 *   2. Recharts has no box plot, so one of the four forms would have been
 *      hand-drawn regardless, on a second axis system that would never quite
 *      match the other three.
 *   3. The chunk. This module loads only when the explorer opens, and a small
 *      self-contained renderer keeps it small — Recharts would ride along into
 *      it as a second copy of work the SVG already does.
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
const TOP = 18;
const FONT_WIDTH = 6.6;
const BAR_GAP = 2;

interface Props {
  shape: Shape;
  spec: ChartSpec;
  dark: boolean;
  locale: string;
  xLabel: string;
  yLabel: string;
  /** Resolves a category or bucket key — including the blank/other sentinels. */
  categoryLabel: (key: string) => string;
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
    const measure = () => setWidth(Math.max(280, Math.round(element.clientWidth)));
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
  const { shape, dark, locale } = props;
  const { t } = useTranslation();
  const [wrapRef, width] = useWidth();
  const [hover, setHover] = useState<Hover | null>(null);

  /* A new shape invalidates whatever index was hovered — it may not exist. */
  useEffect(() => setHover(null), [shape]);

  const n = (value: number, compact = false) => formatExplorerNumber(value, locale, compact);
  const color = (slot: number | null) => seriesColor(slot, dark);

  /* ---- Y domain, shared by every form ---- */
  const yDomain = useMemo(() => {
    const values: number[] = [];
    if (shape.type === 'scatter') shape.series.forEach((s) => s.points.forEach((p) => values.push(p.y)));
    if (shape.type === 'bar' || shape.type === 'line') {
      shape.series.forEach((s) => s.values.forEach((v) => v !== null && values.push(v)));
    }
    if (shape.type === 'box') {
      shape.boxes.forEach((b) => values.push(b.lowerWhisker, b.upperWhisker, ...b.outliers));
    }
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 1;
    /* A bar's length is its value, so its axis must start at zero or a small
       difference is drawn as a large one. The other forms plot positions and
       are free to fit the data. */
    return niceDomain(min, max, 5, shape.type === 'bar');
  }, [shape]);

  const yTickLabels = yDomain.ticks.map((tick) => n(tick, true));
  const left = Math.max(44, Math.ceil(Math.max(...yTickLabels.map(textWidth))) + 16);

  const directLabels =
    shape.type === 'line' && shape.series.length >= 2 && shape.series.length <= 4;
  const right = directLabels
    ? Math.min(140, 16 + Math.max(...shape.series.map((s) => textWidth(props.seriesLabel(s.key)))))
    : 18;

  const bottom = 46;
  const height = TOP + PLOT_HEIGHT + bottom;
  const plotLeft = left;
  const plotRight = width - right;
  const plotBottom = TOP + PLOT_HEIGHT;

  const y = linearScale([yDomain.min, yDomain.max], [plotBottom, TOP], yDomain.ticks);

  /* ---- X ---- */
  const continuous = shape.type === 'scatter' || shape.type === 'line';
  const xIsTime =
    (shape.type === 'scatter' && shape.xKind === 'date') || (shape.type === 'line' && shape.xKind === 'date');

  const xContinuous = useMemo(() => {
    if (!continuous) return null;
    const xs =
      shape.type === 'scatter'
        ? shape.series.flatMap((s) => s.points.map((p) => p.x))
        : shape.type === 'line'
          ? shape.xs
          : [];
    const min = xs.length ? Math.min(...xs) : 0;
    const max = xs.length ? Math.max(...xs) : 1;
    if (xIsTime) {
      const span = max - min || 86_400_000;
      const pad = span * 0.02;
      const { ticks, unit } = timeTicks(min - pad, max + pad, Math.max(2, Math.floor((plotRight - plotLeft) / 90)));
      return { min: min - pad, max: max + pad, ticks, unit };
    }
    const nice = niceDomain(min, max, Math.max(2, Math.floor((plotRight - plotLeft) / 90)));
    return { min: nice.min, max: nice.max, ticks: nice.ticks, unit: null };
  }, [continuous, shape, xIsTime, plotLeft, plotRight]);

  const x = xContinuous
    ? linearScale([xContinuous.min, xContinuous.max], [plotLeft, plotRight], xContinuous.ticks)
    : null;

  const bandCount =
    shape.type === 'bar' ? shape.categories.length : shape.type === 'box' ? shape.boxes.length : 0;
  const band = bandScale(bandCount, [plotLeft, plotRight], shape.type === 'box' ? 0.4 : 0.22);
  const bandKeys = shape.type === 'bar' ? shape.categories : shape.type === 'box' ? shape.boxes.map((b) => b.key) : [];

  /* ---- Scatter points in pixel space, for drawing and hit testing ---- */
  const scatterPixels = useMemo(() => {
    if (shape.type !== 'scatter' || !x) return [];
    return shape.series.flatMap((series) =>
      series.points.map((point) => ({
        px: x(point.x),
        py: y(point.y),
        point,
        series,
      })),
    );
    /* `x` and `y` are rebuilt every render, so the memo keys on the inputs they
       are built from rather than on the functions themselves. */
  }, [shape, xContinuous, yDomain, plotLeft, plotRight]);

  /* Keyboard order for the scatter: left to right, so arrow keys sweep the plot. */
  const scatterOrder = useMemo(
    () => scatterPixels.map((_, i) => i).sort((a, b) => scatterPixels[a].px - scatterPixels[b].px),
    [scatterPixels],
  );

  const positions =
    shape.type === 'scatter' ? scatterPixels.length : shape.type === 'line' ? shape.xs.length : bandCount;

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
    const next = Math.min(positions - 1, Math.max(0, current + step));
    focusIndex(next);
  }

  function focusIndex(ordinal: number) {
    if (shape.type === 'scatter') {
      const index = scatterOrder[ordinal];
      if (index === undefined) return;
      setHover({ index, px: scatterPixels[index].px, py: scatterPixels[index].py });
    } else if (shape.type === 'line' && x) {
      setHover({ index: ordinal, px: x(shape.xs[ordinal]), py: TOP + PLOT_HEIGHT / 3 });
    } else {
      setHover({ index: ordinal, px: band(ordinal) + band.bandwidth / 2, py: TOP + PLOT_HEIGHT / 3 });
    }
  }

  /* ---- Band labels: thinned rather than rotated when they collide ---- */
  const labelEvery = useMemo(() => {
    if (!bandKeys.length) return 1;
    const widest = Math.max(...bandKeys.map((k) => textWidth(props.categoryLabel(k))));
    return Math.max(1, Math.ceil((widest + 8) / Math.max(1, band.step)));
  }, [bandKeys, band.step, props]);

  /* ---- Tooltip body ---- */
  let tooltip: ReactNode = null;
  if (hover) tooltip = tooltipFor();

  function swatch(slot: number | null) {
    return <span className="xp-swatch" style={{ background: color(slot) }} aria-hidden="true" />;
  }

  function tooltipFor(): ReactNode {
    if (!hover) return null;
    if (shape.type === 'scatter') {
      const hit = scatterPixels[hover.index];
      if (!hit) return null;
      return (
        <>
          {shape.series.length > 1 && (
            <div className="xp-tip-row xp-tip-head">
              {swatch(hit.series.slot)}
              {props.seriesLabel(hit.series.key)}
            </div>
          )}
          <div className="xp-tip-row">
            <span>{props.xLabel}</span>
            <strong>{xIsTime ? formatInstant(hit.point.x, locale) : n(hit.point.x)}</strong>
          </div>
          <div className="xp-tip-row">
            <span>{props.yLabel}</span>
            <strong>{n(hit.point.y)}</strong>
          </div>
        </>
      );
    }
    if (shape.type === 'line') {
      const heading =
        shape.xKeys?.[hover.index] !== undefined
          ? props.categoryLabel(shape.xKeys[hover.index])
          : n(shape.xs[hover.index]);
      return (
        <>
          <div className="xp-tip-row xp-tip-head">{heading}</div>
          {shape.series.map((s) => (
            <div key={s.key} className="xp-tip-row">
              <span>
                {shape.series.length > 1 && swatch(s.slot)}
                {shape.series.length > 1 ? props.seriesLabel(s.key) : props.yLabel}
              </span>
              <strong>{s.values[hover.index] === null ? '—' : n(s.values[hover.index] as number)}</strong>
            </div>
          ))}
        </>
      );
    }
    if (shape.type === 'bar') {
      return (
        <>
          <div className="xp-tip-row xp-tip-head">{props.categoryLabel(shape.categories[hover.index])}</div>
          {shape.series.map((s) => (
            <div key={s.key} className="xp-tip-row">
              <span>
                {shape.series.length > 1 && swatch(s.slot)}
                {shape.series.length > 1 ? props.seriesLabel(s.key) : props.yLabel}
              </span>
              <strong>{s.values[hover.index] === null ? '—' : n(s.values[hover.index] as number)}</strong>
            </div>
          ))}
        </>
      );
    }
    const box = shape.boxes[hover.index];
    if (!box) return null;
    return (
      <>
        <div className="xp-tip-row xp-tip-head">{props.categoryLabel(box.key)}</div>
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

  /* ---- Legend: always for two or more series, none for one ---- */
  const legendSeries =
    shape.type === 'scatter' || shape.type === 'bar' || shape.type === 'line' ? shape.series : [];

  return (
    <div className="xp-chart" ref={wrapRef}>
      {legendSeries.length >= 2 && (
        <ul className="xp-legend">
          {legendSeries.map((s) => (
            <li key={s.key} className={s.key === OTHER ? 'is-other' : undefined}>
              {swatch(s.slot)}
              {props.seriesLabel(s.key)}
            </li>
          ))}
        </ul>
      )}

      <div className="xp-plot">
        <svg
          className="xp-svg"
          width={width}
          height={height}
          viewBox={`0 0 ${width} ${height}`}
          role="img"
          tabIndex={0}
          aria-label={t('explorer.chartAria', { x: props.xLabel, y: props.yLabel })}
          aria-describedby="xp-keyboard-hint"
          onMouseMove={pointer}
          onMouseLeave={() => setHover(null)}
          onKeyDown={key}
          onBlur={() => setHover(null)}
        >
          {/* ---- Y grid and ticks ---- */}
          {yDomain.ticks.map((tick, i) => (
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
                  {truncate(props.categoryLabel(k), Math.max(4, Math.floor((band.step * labelEvery) / FONT_WIDTH) - 1))}
                </text>
              ) : null,
            )}

          {/* The baseline: the only axis rule drawn at full strength. */}
          <line className="xp-axis" x1={plotLeft} x2={plotRight} y1={plotBottom} y2={plotBottom} />

          {/* ---- Band highlight, under the marks ---- */}
          {hover && !continuous && (
            <rect
              className="xp-band-hover"
              x={band(hover.index) - (band.step - band.bandwidth) / 2}
              y={TOP}
              width={band.step}
              height={PLOT_HEIGHT}
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
                    fill={color(series.slot)}
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
                stroke={color(series.slot)}
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
                <circle cx={plotRight + 6} cy={label.y - 3.5} r={3} fill={color(label.slot)} />
                <text className="xp-direct" x={plotRight + 13} y={label.y}>
                  {props.seriesLabel(label.key)}
                </text>
              </g>
            ))}

          {shape.type === 'scatter' &&
            scatterPixels.map((p, i) => (
              <circle
                key={i}
                className="xp-dot"
                cx={p.px}
                cy={p.py}
                r={4}
                fill={color(p.series.slot)}
              />
            ))}

          {shape.type === 'box' &&
            shape.boxes.map((box, i) => {
              const cx = band(i) + band.bandwidth / 2;
              const bw = band.bandwidth;
              const top = y(box.q3);
              const bottomY = y(box.q1);
              const fill = color(0);
              return (
                <g key={box.key}>
                  <line className="xp-whisker" x1={cx} x2={cx} y1={y(box.upperWhisker)} y2={top} />
                  <line className="xp-whisker" x1={cx} x2={cx} y1={bottomY} y2={y(box.lowerWhisker)} />
                  <line className="xp-whisker" x1={cx - bw / 4} x2={cx + bw / 4} y1={y(box.upperWhisker)} y2={y(box.upperWhisker)} />
                  <line className="xp-whisker" x1={cx - bw / 4} x2={cx + bw / 4} y1={y(box.lowerWhisker)} y2={y(box.lowerWhisker)} />
                  <rect
                    className="xp-box"
                    x={band(i)}
                    y={top}
                    width={bw}
                    height={Math.max(1, bottomY - top)}
                    rx={4}
                    fill={fill}
                  />
                  <line className="xp-median" x1={band(i)} x2={band(i) + bw} y1={y(box.median)} y2={y(box.median)} />
                  {box.outliers.map((value, oi) => (
                    <circle key={oi} className="xp-dot" cx={cx} cy={y(value)} r={4} fill={fill} />
                  ))}
                </g>
              );
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
                    fill={color(series.slot)}
                  />
                );
              })}
            </>
          )}

          {/* ---- Axis titles ---- */}
          <text className="xp-axis-title" x={plotLeft} y={TOP - 6}>
            {props.yLabel}
          </text>
          <text className="xp-axis-title" x={(plotLeft + plotRight) / 2} y={height - 8} textAnchor="middle">
            {props.xLabel}
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

      <p id="xp-keyboard-hint" className="sr-only">
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
