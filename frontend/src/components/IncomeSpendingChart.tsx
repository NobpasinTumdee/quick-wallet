/**
 * Income vs spending — a scrollable year of monthly cash flow.
 *
 * ---------------------------------------------------------------------------
 * WHY IT SCROLLS INSTEAD OF SQUEEZING
 * ---------------------------------------------------------------------------
 * Twelve months inside a half-width bento card leaves ~40px per month, which is
 * not enough for two bars, two amounts and a legible axis tick. Rather than drop
 * the labels or the months, the plot keeps a fixed per-month width and the card
 * scrolls horizontally, pinned to the newest month. The card's own width never
 * changes, so the bento grid is untouched.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NUMBERS APPEAR TWICE
 * ---------------------------------------------------------------------------
 * On-chart labels are compact ("50k", "1.2m") because an exact amount at every
 * data point is a wall of digits that overlaps at this density. The exact
 * figure — converted, with its currency — lives in the tooltip, which is where
 * someone goes when they want the number rather than the shape.
 *
 * ---------------------------------------------------------------------------
 * WHY NOTHING HERE HARD-CODES A COLOUR
 * ---------------------------------------------------------------------------
 * Same rule as the Sankey: marks are styled from classes in app.css so all
 * thirteen themes drive the chart. The two gradients live in a zero-size <svg>
 * whose stops are CSS-styled, because `fill="var(--positive)"` is not something
 * an SVG presentation attribute can resolve.
 */

import { ChartArea, ChartColumn, ChartLine, Equal, TrendingDown, TrendingUp } from 'lucide-react';
import { useEffect, useId, useMemo, useRef, useState } from 'react';
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  LabelList,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  MonthPoint,
  MonthlyCashFlow,
  SeriesStats,
  TrendPoint,
  buildMonthlyCashFlow,
} from '../lib/cashflow';
import { cx } from '../lib/format';
import { MoneyFormatter, useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Transaction } from '../types';
import { Icon } from './Icon';
import { Card, EmptyState, Segmented } from './ui';

/* ------------------------------------------------------------------ */
/* Geometry                                                            */
/* ------------------------------------------------------------------ */

const CHART_HEIGHT = 268;
/** Room for two bars, two compact labels and a month tick without collisions. */
const MONTH_WIDTH = 92;
/** Headroom above the tallest mark so its label is not clipped by the frame. */
const HEADROOM = 1.22;
/** Scales the shared gradients down where the two area fills overlap. */
const AREA_FILL = 0.32;

type ChartKind = 'bar' | 'line' | 'area';

const KINDS: { value: ChartKind; icon: typeof ChartColumn; label: string }[] = [
  { value: 'bar', icon: ChartColumn, label: 'Bar chart' },
  { value: 'line', icon: ChartLine, label: 'Line chart' },
  { value: 'area', icon: ChartArea, label: 'Area chart' },
];

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/**
 * "50k", "1.2m", "840" — the on-chart label.
 *
 * Deliberately currency-free: the card subtitle and every tooltip already carry
 * the symbol, and repeating it 24 times inside the plot is ink that encodes
 * nothing. Zero returns "" so empty months stay empty rather than printing a
 * row of noughts along the baseline.
 */
function compactLabel(value: number, locale: string): string {
  if (!Number.isFinite(value) || value === 0) return '';
  const abs = Math.abs(value);
  try {
    if (abs < 1000) {
      return new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(value);
    }
    return new Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 })
      .format(value)
      // Lowercase reads quieter at 10px; a no-op in locales without K/M/B/T.
      .replace(/[KMBT]/g, (unit) => unit.toLowerCase());
  } catch {
    return String(Math.round(value));
  }
}

/* ------------------------------------------------------------------ */
/* Motion                                                              */
/* ------------------------------------------------------------------ */

/**
 * Recharts animates in JS, so the `prefers-reduced-motion` block in app.css
 * cannot reach it — the preference has to be read and passed as a prop.
 */
function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const onChange = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);

  return reduced;
}

/* ------------------------------------------------------------------ */
/* Tooltip                                                             */
/* ------------------------------------------------------------------ */

interface TipEntry {
  payload?: MonthPoint;
}

/** The exact numbers, in full — the compact labels' counterpart. */
function MonthTip({
  active,
  payload,
  money,
}: {
  active?: boolean;
  payload?: TipEntry[];
  money: MoneyFormatter;
}) {
  const point = active ? payload?.[0]?.payload : undefined;
  if (!point) return null;

  return (
    <div className="chart-tip" role="tooltip">
      <div className="chart-tip-value">{money(point.net, { signed: true })}</div>
      <div className="chart-tip-muted">{point.labelLong} · net</div>

      <div className="chart-tip-flow">
        <span className="chart-tip-key chart-tip-key--income" aria-hidden="true" />
        <span className="chart-tip-name">Income</span>
        <span className="ischart-tip-amount">{money(point.income)}</span>
      </div>
      <div className="chart-tip-flow">
        <span className="chart-tip-key chart-tip-key--expense" aria-hidden="true" />
        <span className="chart-tip-name">Spending</span>
        <span className="ischart-tip-amount">{money(point.expense)}</span>
      </div>

      {point.count > 0 && (
        <div className="chart-tip-muted">
          {point.count} transaction{point.count === 1 ? '' : 's'}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Statistical summary                                                 */
/* ------------------------------------------------------------------ */

/**
 * Max / mean / min for one series.
 *
 * The month name sits under each figure because "highest 42k" is a piece of
 * trivia while "highest 42k, March" is something you can go and look at.
 */
function StatGroup({
  series,
  stats,
  sampleSize,
  money,
}: {
  series: 'income' | 'expense';
  stats: SeriesStats;
  /** Months the mean was taken over — named so the figure is not a mystery. */
  sampleSize: number;
  money: MoneyFormatter;
}) {
  const valueOf = (point: MonthPoint) => (series === 'income' ? point.income : point.expense);

  const cells = [
    { key: 'max', label: 'Highest', icon: TrendingUp, point: stats.max },
    { key: 'mean', label: 'Average', icon: Equal, point: null },
    { key: 'min', label: 'Lowest', icon: TrendingDown, point: stats.min },
  ] as const;

  return (
    <div className={cx('ischart-stat-group', `ischart-stat-group--${series}`)}>
      <div className="ischart-stat-series">
        <span className={`chart-tip-key chart-tip-key--${series}`} aria-hidden="true" />
        {series === 'income' ? 'Income' : 'Spending'}
      </div>
      <div className="ischart-stat-row">
        {cells.map((cell) => (
          <div key={cell.key} className="ischart-stat">
            <span className="ischart-stat-label">
              <Icon icon={cell.icon} size="sm" />
              {cell.label}
            </span>
            <span className="ischart-stat-value">
              {money(cell.point ? valueOf(cell.point) : stats.mean, { compact: true })}
            </span>
            <span className="ischart-stat-meta">
              {cell.key === 'mean'
                ? `over ${sampleSize} month${sampleSize === 1 ? '' : 's'}`
                : (cell.point?.labelLong ?? '—')}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Chart                                                               */
/* ------------------------------------------------------------------ */

export function IncomeSpendingChart({
  transactions,
  trend,
  period,
  months = 12,
  loading = false,
  stale = false,
  className,
}: {
  /** Rows covering the window. Empty while they load — `trend` covers the gap. */
  transactions: Transaction[];
  /** The server's six-month rollup, drawn until the rows arrive. */
  trend?: TrendPoint[];
  /** Newest month in the window, `YYYY-MM`. */
  period: string;
  months?: number;
  loading?: boolean;
  /** Refetching over data already on screen: dim, never re-skeleton. */
  stale?: boolean;
  className?: string;
}) {
  const money = useMoneyFormatter();
  const { settings } = useSettings();
  const reducedMotion = useReducedMotion();
  const [kind, setKind] = useState<ChartKind>('bar');
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const uid = useId().replace(/:/g, '');

  // The only expensive thing on this card: one pass over up to a year of rows.
  const flow: MonthlyCashFlow = useMemo(
    () =>
      buildMonthlyCashFlow(transactions, {
        period,
        months,
        locale: settings.locale,
        fallback: trend,
      }),
    [transactions, period, months, settings.locale, trend],
  );

  /* History reads right-to-left here: the newest month is the one you came to
     see, so the scroller starts pinned to it rather than to the oldest. */
  useEffect(() => {
    const element = scrollRef.current;
    if (element) element.scrollLeft = element.scrollWidth;
  }, [flow.points.length, kind]);

  const gradient = (series: 'income' | 'expense') => `${uid}-${series}`;
  const label = (value: unknown) => compactLabel(money.convert(Number(value) || 0), settings.locale);

  const subtitle = flow.hasData
    ? `${flow.points.length} month${flow.points.length === 1 ? '' : 's'} · ${money(flow.income.total, { compact: true })} in · ${money(flow.expense.total, { compact: true })} out`
    : loading
      ? `Last ${months} months`
      : 'Nothing recorded yet';

  /* The hover marker is a filled band behind the bars but a vertical rule on a
     line or area, so it takes the two different prop sets. `currentColor` is
     the one theme-aware value an SVG attribute accepts — it resolves against
     the card's own text colour. */
  const cursor =
    kind === 'bar'
      ? { fill: 'currentColor', fillOpacity: 0.06 }
      : { stroke: 'currentColor', strokeOpacity: 0.3, strokeDasharray: '3 4' };

  /* Shared by all three variants, so switching type cannot silently change the
     scale, the ticks or the tooltip — only the mark. */
  const axes = (
    <>
      <CartesianGrid className="ischart-grid" vertical={false} strokeDasharray="3 6" />
      <XAxis dataKey="label" interval={0} tickLine={false} axisLine={false} tickMargin={10} />
      {/* Hidden because every point already prints its own amount; it exists
          only to reserve headroom so the topmost label is not clipped. */}
      <YAxis hide domain={[0, (max: number) => Math.max(1, max * HEADROOM)]} />
      <Tooltip isAnimationActive={false} cursor={cursor} content={<MonthTip money={money} />} />
    </>
  );

  const animation = { isAnimationActive: !reducedMotion, animationDuration: 420 };
  const plotWidth = Math.max(1, flow.points.length) * MONTH_WIDTH;

  const chart = () => {
    if (kind === 'bar') {
      return (
        <BarChart data={flow.points} margin={{ top: 18, right: 6, bottom: 0, left: 6 }} barGap={4}>
          {axes}
          <Bar dataKey="income" fill={`url(#${gradient('income')})`} radius={[6, 6, 2, 2]} {...animation}>
            <LabelList dataKey="income" position="top" className="ischart-label" formatter={label} />
          </Bar>
          <Bar dataKey="expense" fill={`url(#${gradient('expense')})`} radius={[6, 6, 2, 2]} {...animation}>
            <LabelList dataKey="expense" position="top" className="ischart-label" formatter={label} />
          </Bar>
        </BarChart>
      );
    }

    if (kind === 'line') {
      return (
        <LineChart data={flow.points} margin={{ top: 20, right: 14, bottom: 0, left: 14 }}>
          {axes}
          {/* Income labels ride above their point and spending below, so the two
              never collide in the months where the lines cross. */}
          <Line
            type="monotone"
            dataKey="income"
            className="ischart-series ischart-series--income"
            strokeWidth={2.5}
            dot={{ r: 3, strokeWidth: 2 }}
            activeDot={{ r: 5 }}
            {...animation}
          >
            <LabelList dataKey="income" position="top" className="ischart-label" formatter={label} />
          </Line>
          <Line
            type="monotone"
            dataKey="expense"
            className="ischart-series ischart-series--expense"
            strokeWidth={2.5}
            dot={{ r: 3, strokeWidth: 2 }}
            activeDot={{ r: 5 }}
            {...animation}
          >
            <LabelList dataKey="expense" position="bottom" className="ischart-label" formatter={label} />
          </Line>
        </LineChart>
      );
    }

    return (
      <AreaChart data={flow.points} margin={{ top: 20, right: 14, bottom: 0, left: 14 }}>
        {axes}
        {/* Spending is painted last so it stays readable on top of income, which
            is the taller series in a month that went well. Both fills are
            a third of the bar chart's: at full strength the upper series hides
            the lower one instead of overlapping it, and the shared base goes
            muddy rather than reading as the two fills crossing. */}
        <Area
          type="monotone"
          dataKey="income"
          className="ischart-series ischart-series--income"
          strokeWidth={2.5}
          fill={`url(#${gradient('income')})`}
          fillOpacity={AREA_FILL}
          {...animation}
        >
          <LabelList dataKey="income" position="top" className="ischart-label" formatter={label} />
        </Area>
        <Area
          type="monotone"
          dataKey="expense"
          className="ischart-series ischart-series--expense"
          strokeWidth={2.5}
          fill={`url(#${gradient('expense')})`}
          fillOpacity={AREA_FILL}
          {...animation}
        >
          <LabelList dataKey="expense" position="bottom" className="ischart-label" formatter={label} />
        </Area>
      </AreaChart>
    );
  };

  return (
    <Card
      className={cx('card--chart', className)}
      title="Income vs spending"
      subtitle={subtitle}
      actions={
        <Segmented<ChartKind>
          value={kind}
          ariaLabel="Chart type"
          onChange={setKind}
          options={KINDS.map((option) => ({
            value: option.value,
            label: <Icon icon={option.icon} size="sm" label={option.label} />,
          }))}
        />
      }
    >
      {!flow.hasData ? (
        <EmptyState
          icon={<Icon icon={ChartColumn} size="xl" />}
          title={loading ? 'Loading your history…' : 'No history yet'}
          description={
            loading ? undefined : 'Record some income and expenses and the last year shows up here.'
          }
        />
      ) : (
        <div className={cx('ischart', stale && 'is-stale')}>
          <div className="ischart-stats">
            <StatGroup series="income" stats={flow.income} sampleSize={flow.sampleSize} money={money} />
            <StatGroup series="expense" stats={flow.expense} sampleSize={flow.sampleSize} money={money} />
          </div>

          {/* Zero-size carrier for the gradients — same reason as the Sankey:
              the stops need CSS to reach `var(--positive)`, and Recharts owns
              the chart's own <Surface>. */}
          <svg className="ischart-defs" aria-hidden="true" focusable="false">
            <defs>
              {(['income', 'expense'] as const).map((series) => (
                <linearGradient key={series} id={gradient(series)} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" className={`ischart-stop--${series}`} stopOpacity={0.92} />
                  <stop offset="100%" className={`ischart-stop--${series}`} stopOpacity={0.28} />
                </linearGradient>
              ))}
            </defs>
          </svg>

          {/* tabIndex makes the overflow box reachable by keyboard, which is the
              only way to reach the older months without a pointer. */}
          <div
            ref={scrollRef}
            className="ischart-scroll"
            tabIndex={0}
            role="group"
            aria-label={`Monthly income and spending, ${flow.points.length} months, scrollable`}
          >
            <div className="ischart-plot" style={{ minWidth: `${plotWidth}px` }} key={kind}>
              <ResponsiveContainer width="100%" height={CHART_HEIGHT}>
                {chart()}
              </ResponsiveContainer>
            </div>
          </div>

          <div className="ischart-foot">
            <span className="ischart-legend-item">
              <span className="chart-tip-key chart-tip-key--income" aria-hidden="true" /> Income
            </span>
            <span className="ischart-legend-item">
              <span className="chart-tip-key chart-tip-key--expense" aria-hidden="true" /> Spending
            </span>
            <span className="ischart-foot-note">
              {flow.source === 'summary'
                ? 'six-month summary · loading the full year'
                : `scroll for older months · stats over ${flow.sampleSize} active month${flow.sampleSize === 1 ? '' : 's'}`}
            </span>
          </div>
        </div>
      )}
    </Card>
  );
}
