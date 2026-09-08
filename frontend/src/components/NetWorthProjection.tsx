import { Info, TrendingUp } from 'lucide-react';
import { useId, useMemo, useState } from 'react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import {
  DEFAULT_ANNUAL_RETURN_PERCENT,
  ProjectionPoint,
  SAVINGS_LOOKBACK_MONTHS,
  TrendMonth,
  estimateMonthlySavings,
  projectNetWorth,
} from '../lib/projectionMath';
import { cx, formatPercent } from '../lib/format';
import { MoneyFormatter } from '../state/SettingsContext';
import { Icon } from './Icon';

/**
 * Where today's savings rate lands in ten years.
 *
 * ---------------------------------------------------------------------------
 * WHY A STACKED AREA, AND WHY THOSE TWO BANDS
 * ---------------------------------------------------------------------------
 * The point of the chart is not the final number — that is a figure, and it is
 * printed as one above the plot. The point is the *gap* between what you put in
 * and what the balance became, because that gap is compounding, and it is the
 * only argument for starting early that people find convincing.
 *
 * So the two bands are Contributions and Growth, stacked, summing to the total.
 * The reader sees one band grow linearly and the other curve away from it.
 * Overlapping two areas instead would have made the total something you read by
 * eye off the taller one, which is exactly the wrong emphasis.
 *
 * ---------------------------------------------------------------------------
 * COLOUR
 * ---------------------------------------------------------------------------
 * One hue, one neutral — not two hues. Contributions are context and take a
 * recessive grey; Growth is the subject and takes the positive token. That
 * keeps the salient band unambiguous, and it sidesteps a two-hue palette across
 * thirteen user-switchable themes, which is not something that could be
 * validated once and trusted.
 *
 * Both fills are tokens, never literals, so every theme drives the chart — the
 * same rule IncomeSpendingChart follows. The gradient stops live in CSS for the
 * same reason: `fill="var(--positive)"` is not resolvable as an SVG attribute.
 *
 * The fill alpha is not a taste decision. The dark theme's `--positive` is
 * lighter than the OKLCH band a mark should occupy on a dark surface; composited
 * at 0.65 it lands inside the band in both light and dark, with adjacent-pair
 * separation of ΔE 24 (dark) and 11 (light) under deuteranopia — comfortably
 * above the ≥8 target. The bands sit below 3:1 against the surface, which is why
 * the exact figures are printed above the plot rather than left to the colour.
 */

/** One point per month is right for the maths and far too many for an axis. */
const TICKS_PER_DECADE = 6;

const MIN_RETURN = 0;
const MAX_RETURN = 12;

interface Props {
  /** Today's net worth, live market values included. */
  startingNetWorth: number;
  /** The dashboard's own trend, reused rather than refetched. */
  trend: TrendMonth[];
  money: MoneyFormatter;
  locale: string;
}

function ProjectionTip({
  active,
  payload,
  money,
}: {
  active?: boolean;
  payload?: { payload: ProjectionPoint }[];
  money: MoneyFormatter;
}) {
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;
  const years = Math.floor(point.month / 12);
  const months = point.month % 12;

  const when =
    point.month === 0
      ? 'Today'
      : [
          years > 0 ? `${years} year${years === 1 ? '' : 's'}` : '',
          months > 0 ? `${months} month${months === 1 ? '' : 's'}` : '',
        ]
          .filter(Boolean)
          .join(' ');

  /* Same anatomy as the cash-flow tooltip: the headline figure, what it is,
     then the parts. Reusing those classes keeps one tooltip look across the
     app rather than a second one that drifts. */
  return (
    <div className="chart-tip" role="tooltip">
      <div className="chart-tip-value">{money(point.value)}</div>
      <div className="chart-tip-muted">in {when}</div>

      <div className="chart-tip-flow">
        <span className="chart-tip-key proj-key--growth" aria-hidden="true" />
        <span className="chart-tip-name">Growth</span>
        <span className="ischart-tip-amount">{money(point.growth)}</span>
      </div>
      <div className="chart-tip-flow">
        <span className="chart-tip-key proj-key--contributed" aria-hidden="true" />
        <span className="chart-tip-name">Contributed</span>
        <span className="ischart-tip-amount">{money(point.contributed)}</span>
      </div>
    </div>
  );
}

export function NetWorthProjection({ startingNetWorth, trend, money, locale }: Props) {
  const gradientId = useId();

  const estimate = useMemo(() => estimateMonthlySavings(trend), [trend]);

  const [years, setYears] = useState(10);
  const [returnPercent, setReturnPercent] = useState(DEFAULT_ANNUAL_RETURN_PERCENT);
  /**
   * Null means "follow the estimate". Once the user drags the slider it holds
   * their number, so a background dashboard refresh cannot silently move an
   * input they are actively using.
   */
  const [contributionOverride, setContributionOverride] = useState<number | null>(null);
  const contribution = contributionOverride ?? estimate.monthly;

  const projection = useMemo(
    () =>
      projectNetWorth({
        startingNetWorth,
        monthlyContribution: contribution,
        annualReturnPercent: returnPercent,
        years,
      }),
    [startingNetWorth, contribution, returnPercent, years],
  );

  /* Ticks at whole years, thinned so the axis never collides with itself. */
  const tickMonths = useMemo(() => {
    const step = Math.max(1, Math.round(years / TICKS_PER_DECADE));
    const ticks: number[] = [];
    for (let year = 0; year <= years; year += step) ticks.push(year * 12);
    if (ticks[ticks.length - 1] !== years * 12) ticks.push(years * 12);
    return ticks;
  }, [years]);

  const { final } = projection;
  /** The whole argument for the chart, as one ratio. */
  const growthShare = final.value !== 0 ? (final.growth / final.value) * 100 : 0;

  /** A slider that cannot reach a sensible range is worse than a number field. */
  const contributionCeiling = Math.max(2_000, Math.ceil(Math.abs(estimate.monthly) * 3));

  return (
    <div className="proj">
      {/* ---- The headline. Also the relief for a sub-3:1 fill contrast: every
              band's value is available as text, not only as colour. ---- */}
      <div className="proj-headline">
        <div>
          <span className="section-label">Projected in {years} years</span>
          <div className="proj-total">{money(final.value, { compact: true })}</div>
        </div>
        <dl className="proj-figures">
          <div>
            <dt>
              <span className="chart-tip-key proj-key--contributed" aria-hidden="true" />
              Contributed
            </dt>
            <dd>{money(final.contributed, { compact: true })}</dd>
          </div>
          <div>
            <dt>
              <span className="chart-tip-key proj-key--growth" aria-hidden="true" />
              Growth
            </dt>
            <dd>
              {money(final.growth, { compact: true })}
              <span className="proj-share">{formatPercent(growthShare, 0)} of the total</span>
            </dd>
          </div>
        </dl>
      </div>

      {/* ---- The plot ---- */}
      <div className="proj-plot">
        <ResponsiveContainer width="100%" height={220}>
          <AreaChart data={projection.points} margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
            <defs>
              {/* Stops are styled in CSS so all thirteen themes reach them. */}
              <linearGradient id={`${gradientId}-growth`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" className="proj-stop--growth-top" />
                <stop offset="100%" className="proj-stop--growth-bottom" />
              </linearGradient>
            </defs>

            <CartesianGrid className="ischart-grid" vertical={false} strokeDasharray="3 6" />

            <XAxis
              dataKey="month"
              ticks={tickMonths}
              tickFormatter={(month: number) => (month === 0 ? 'now' : `${month / 12}y`)}
              axisLine={false}
              tickLine={false}
              className="proj-axis"
              interval={0}
            />
            <YAxis
              width={52}
              axisLine={false}
              tickLine={false}
              className="proj-axis"
              tickFormatter={(value: number) =>
                Intl.NumberFormat(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(
                  money.convert(value),
                )
              }
            />

            <Tooltip
              isAnimationActive={false}
              cursor={{ className: 'proj-cursor' }}
              content={<ProjectionTip money={money} />}
            />

            {/* Order matters: contributions are the base of the stack, growth
                rides on top, and the top edge is therefore the total. */}
            <Area
              type="monotone"
              dataKey="contributed"
              stackId="worth"
              className="proj-area proj-area--contributed"
              strokeWidth={2}
              isAnimationActive={false}
            />
            <Area
              type="monotone"
              dataKey="growth"
              stackId="worth"
              className="proj-area proj-area--growth"
              fill={`url(#${gradientId}-growth)`}
              strokeWidth={2}
              isAnimationActive={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      {/* ---- Controls ---- */}
      <div className="proj-controls">
        <label className="proj-control">
          <span className="proj-control-head">
            Expected annual return
            <strong>{returnPercent.toFixed(1)}%</strong>
          </span>
          <input
            type="range"
            min={MIN_RETURN}
            max={MAX_RETURN}
            step={0.5}
            value={returnPercent}
            onChange={(event) => setReturnPercent(Number(event.target.value))}
            aria-label="Expected annual return, percent"
          />
        </label>

        <label className="proj-control">
          <span className="proj-control-head">
            Monthly savings
            <strong>{money(contribution, { compact: true })}</strong>
          </span>
          <input
            type="range"
            min={0}
            max={contributionCeiling}
            step={Math.max(10, Math.round(contributionCeiling / 200))}
            value={Math.min(Math.max(contribution, 0), contributionCeiling)}
            onChange={(event) => setContributionOverride(Number(event.target.value))}
            aria-label="Monthly savings added"
          />
        </label>

        <div className="proj-horizon" role="group" aria-label="Projection horizon">
          {[5, 10].map((option) => (
            <button
              key={option}
              type="button"
              className={cx('user-chip', years === option && 'is-active')}
              onClick={() => setYears(option)}
            >
              {option}y
            </button>
          ))}
        </div>
      </div>

      {/* ---- Where the numbers came from, and what they are not ---- */}
      <p className="proj-note">
        <Icon icon={Info} size="sm" />
        <span>
          {contributionOverride !== null ? (
            <>
              Using your figure of {money(contribution)} a month.{' '}
              <button type="button" className="proj-reset" onClick={() => setContributionOverride(null)}>
                Use my actual average
              </button>
            </>
          ) : estimate.monthsUsed > 0 ? (
            <>
              Based on {money(estimate.monthly)} saved a month, averaged over your last{' '}
              {estimate.monthsUsed} complete month{estimate.monthsUsed === 1 ? '' : 's'}
              {estimate.sparse && ' — too few to be a reliable rate yet'}.
            </>
          ) : (
            <>
              No complete month of history yet, so the contribution starts at zero — drag it to try
              a figure.
            </>
          )}{' '}
          Figures are nominal and ignore inflation, tax on gains and the fact that real returns
          arrive unevenly.
        </span>
      </p>
    </div>
  );
}

/** Shown while the chunk loads, sized to match so the card does not jump. */
export function NetWorthProjectionSkeleton() {
  return (
    <div className="proj proj--loading" aria-hidden="true">
      <Icon icon={TrendingUp} size="lg" />
    </div>
  );
}

/** Re-exported so the lookback is quotable in copy without a second import. */
export { SAVINGS_LOOKBACK_MONTHS };
