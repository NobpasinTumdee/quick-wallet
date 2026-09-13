import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { BoxPlotData, CategoryBox, JitterPoint, buildBoxPlot, niceScale } from '../lib/boxPlotMath';
import { cx, formatDate } from '../lib/format';
import { MoneyFormatter } from '../state/SettingsContext';
import { Transaction } from '../types';

/**
 * Transaction amounts per category, as a box plot with the points overlaid.
 *
 * ---------------------------------------------------------------------------
 * WHY HAND-DRAWN SVG AND NOT RECHARTS
 * ---------------------------------------------------------------------------
 * Recharts is already a dependency and is the right tool for the other four
 * charts here. It has no box plot. Building one means a `ComposedChart` of
 * stacked invisible bars with custom shapes for the whiskers, a second
 * `Scatter` series per category for the jitter, and a shared band scale the two
 * layers have to agree on — more code than the SVG below, in a shape nobody can
 * read, to reach the same 200 lines of `<rect>` and `<line>`.
 *
 * Drawing it directly also keeps every colour a theme token. A charting library
 * wants hex strings, and thirteen palettes plus a user-settable accent make a
 * hard-coded colour a bug waiting for someone to switch theme.
 *
 * ---------------------------------------------------------------------------
 * WHY THE POINTS ARE DRAWN AT ALL
 * ---------------------------------------------------------------------------
 * A box from eight transactions looks exactly as authoritative as one from
 * eight hundred. The jitter is what makes the sample size visible — and the
 * outliers, which are the actual reason to open this chart, are individual
 * purchases rather than a statistic.
 */

/* Geometry, in the SVG's own user units. The viewBox scales to the container,
   so these are proportions rather than pixels. */
const PLOT_HEIGHT = 260;
const AXIS_WIDTH = 56;
const TOP_PAD = 12;
const BOTTOM_PAD = 44;
const BAND_WIDTH = 92;
const BOX_WIDTH = 42;
/** How far a jittered point may stray from the category's centre line. */
const JITTER_SPREAD = 30;

export function CategoryBoxPlot({
  transactions,
  money,
  locale,
  /** Shown as a caption; the loader lives on the page, not in here. */
  rangeLabel,
}: {
  transactions: Transaction[];
  money: MoneyFormatter;
  locale: string;
  rangeLabel: string;
}) {
  const { t } = useTranslation();
  const [hovered, setHovered] = useState<{ box: CategoryBox; point: JitterPoint | null } | null>(
    null,
  );

  const data = useMemo(() => buildBoxPlot(transactions), [transactions]);
  const scale = useMemo(() => niceScale(data.maxAmount), [data.maxAmount]);

  if (data.categories.length === 0) {
    return (
      <div className="boxplot boxplot--empty">
        <p>{t('boxplot.empty')}</p>
        <p className="boxplot-hint">{t('boxplot.emptyHint')}</p>
      </div>
    );
  }

  const width = AXIS_WIDTH + data.categories.length * BAND_WIDTH;
  const plotTop = TOP_PAD;
  const plotBottom = PLOT_HEIGHT - BOTTOM_PAD;
  const plotHeight = plotBottom - plotTop;

  /** Amount → y, with 0 at the bottom. */
  const y = (amount: number) => plotBottom - (amount / scale.max) * plotHeight;
  /** Category index → the centre of its band. */
  const bandCentre = (index: number) => AXIS_WIDTH + index * BAND_WIDTH + BAND_WIDTH / 2;

  return (
    <div className="boxplot">
      <div className="boxplot-scroll">
        <svg
          className="boxplot-svg"
          viewBox={`0 0 ${width} ${PLOT_HEIGHT}`}
          style={{ minWidth: width }}
          role="img"
          aria-label={t('boxplot.ariaLabel', { count: data.categories.length })}
        >
          {/* ---- Gridlines and the amount axis ---- */}
          {scale.ticks.map((tick) => (
            <g key={tick}>
              <line
                className="boxplot-grid"
                x1={AXIS_WIDTH}
                x2={width}
                y1={y(tick)}
                y2={y(tick)}
              />
              <text className="boxplot-tick" x={AXIS_WIDTH - 8} y={y(tick) + 3} textAnchor="end">
                {money(tick, { compact: true })}
              </text>
            </g>
          ))}

          {data.categories.map((box, index) => {
            const cx0 = bandCentre(index);
            const boxTop = y(box.q3);
            const boxBottom = y(box.q1);
            const active = hovered?.box.category === box.category;

            return (
              <g
                key={box.category}
                className={cx('boxplot-band', active && 'is-active')}
                onMouseLeave={() => setHovered(null)}
              >
                {/* A full-height target, so the box is hoverable from anywhere
                    in its column rather than only on the 42px rectangle. */}
                <rect
                  className="boxplot-hit"
                  x={cx0 - BAND_WIDTH / 2}
                  y={plotTop}
                  width={BAND_WIDTH}
                  height={plotHeight}
                  onMouseEnter={() => setHovered({ box, point: null })}
                />

                {/* ---- Whiskers ---- */}
                <line
                  className="boxplot-whisker"
                  x1={cx0}
                  x2={cx0}
                  y1={y(box.upperWhisker)}
                  y2={boxTop}
                />
                <line
                  className="boxplot-whisker"
                  x1={cx0}
                  x2={cx0}
                  y1={boxBottom}
                  y2={y(box.lowerWhisker)}
                />
                {/* The caps. Half the box width — wide enough to read as an end
                    stop, narrow enough not to compete with the quartiles. */}
                <line
                  className="boxplot-cap"
                  x1={cx0 - BOX_WIDTH / 4}
                  x2={cx0 + BOX_WIDTH / 4}
                  y1={y(box.upperWhisker)}
                  y2={y(box.upperWhisker)}
                />
                <line
                  className="boxplot-cap"
                  x1={cx0 - BOX_WIDTH / 4}
                  x2={cx0 + BOX_WIDTH / 4}
                  y1={y(box.lowerWhisker)}
                  y2={y(box.lowerWhisker)}
                />

                {/* ---- The interquartile box ----
                    A floor of 1 unit so a category whose amounts are all
                    identical still draws a line rather than nothing at all. */}
                <rect
                  className="boxplot-box"
                  x={cx0 - BOX_WIDTH / 2}
                  y={boxTop}
                  width={BOX_WIDTH}
                  height={Math.max(1, boxBottom - boxTop)}
                  rx={3}
                />

                {/* ---- Median ---- */}
                <line
                  className="boxplot-median"
                  x1={cx0 - BOX_WIDTH / 2}
                  x2={cx0 + BOX_WIDTH / 2}
                  y1={y(box.median)}
                  y2={y(box.median)}
                />

                {/* ---- Jitter ----
                    Drawn last so the points sit above the box. Outliers get a
                    ring rather than only a colour, which survives greyscale and
                    every kind of colour blindness. */}
                {box.points.map((point) => (
                  <circle
                    key={point.id}
                    className={cx('boxplot-point', point.outlier && 'is-outlier')}
                    cx={cx0 + point.offset * JITTER_SPREAD}
                    cy={y(point.amount)}
                    r={point.outlier ? 3 : 2.2}
                    onMouseEnter={() => setHovered({ box, point })}
                  />
                ))}

                {/* ---- Category label ---- */}
                <text
                  className="boxplot-label"
                  x={cx0}
                  y={PLOT_HEIGHT - BOTTOM_PAD + 18}
                  textAnchor="middle"
                >
                  {box.category.length > 11 ? `${box.category.slice(0, 10)}…` : box.category}
                </text>
                <text
                  className="boxplot-count"
                  x={cx0}
                  y={PLOT_HEIGHT - BOTTOM_PAD + 31}
                  textAnchor="middle"
                >
                  {t('boxplot.pointCount', { count: box.count })}
                </text>
              </g>
            );
          })}
        </svg>
      </div>

      {/* ---- Tooltip ----
          Rendered as HTML below the chart rather than as an SVG overlay: it
          reflows, it wraps, it inherits the type scale, and it can never be
          clipped by the viewBox or fall off the edge of a scrolled plot. */}
      <div className={cx('boxplot-readout', hovered && 'is-active')} aria-live="polite">
        {hovered ? (
          hovered.point ? (
            <>
              <strong>{money(hovered.point.amount)}</strong>
              <span>
                {hovered.point.note || hovered.box.category} ·{' '}
                {formatDate(hovered.point.date, locale)}
              </span>
              {hovered.point.outlier && (
                <span className="boxplot-readout-flag">{t('boxplot.outlier')}</span>
              )}
            </>
          ) : (
            <>
              <strong>{hovered.box.category}</strong>
              <span>
                {t('boxplot.median')} {money(hovered.box.median)} · {t('boxplot.iqrRange', {
                  from: money(hovered.box.q1),
                  to: money(hovered.box.q3),
                })}
              </span>
              <span>
                {t('boxplot.rangeSummary', {
                  from: money(hovered.box.min),
                  to: money(hovered.box.max),
                })}
                {hovered.box.outlierCount > 0 && (
                  <> · {t('boxplot.outlierCount', { count: hovered.box.outlierCount })}</>
                )}
              </span>
            </>
          )
        ) : (
          <span className="boxplot-readout-idle">{t('boxplot.hoverHint')}</span>
        )}
      </div>

      <p className="boxplot-caption">
        {t('boxplot.caption', { range: rangeLabel, count: data.sampleSize })}
        {data.omittedCategories > 0 && (
          <> · {t('boxplot.omitted', { count: data.omittedCategories })}</>
        )}
      </p>
    </div>
  );
}

export type { BoxPlotData };
