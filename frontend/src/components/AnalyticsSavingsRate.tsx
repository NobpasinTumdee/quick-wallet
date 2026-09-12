import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { SavingsRatePoint, savingsRateSeries } from '../lib/analyticsMath';
import { TrendMonth } from '../lib/projectionMath';
import { formatPercent, formatPeriod } from '../lib/format';
import { MoneyFormatter } from '../state/SettingsContext';

/**
 * Savings rate, month by month.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS A ZERO LINE AND WHY IT IS NOT THE AXIS FLOOR
 * ---------------------------------------------------------------------------
 * A savings rate goes negative — that is the month you spent more than you
 * earned, and it is the single most important month on the chart. Clamping the
 * domain at zero would flatten it against the floor and make a disaster look
 * like a merely quiet month, so the axis carries whatever range the data needs
 * and a reference line marks zero explicitly.
 *
 * One series, so no legend: the card title names it.
 */
function RateTip({
  active,
  payload,
  money,
  locale,
}: {
  active?: boolean;
  payload?: { payload: SavingsRatePoint }[];
  money: MoneyFormatter;
  locale: string;
}) {
  const { t } = useTranslation();
  if (!active || !payload?.length) return null;
  const point = payload[0].payload;

  return (
    <div className="chart-tip" role="tooltip">
      <div className="chart-tip-value">
        {point.undefinedRate ? '—' : formatPercent(point.ratePercent, 1)}
      </div>
      <div className="chart-tip-muted">{formatPeriod(point.period, locale)}</div>

      <div className="chart-tip-flow">
        <span className="chart-tip-key chart-tip-key--income" aria-hidden="true" />
        <span className="chart-tip-name">{t('dashboard.income')}</span>
        <span className="ischart-tip-amount">{money(point.income)}</span>
      </div>
      <div className="chart-tip-flow">
        <span className="chart-tip-key chart-tip-key--expense" aria-hidden="true" />
        <span className="chart-tip-name">{t('dashboard.spent')}</span>
        <span className="ischart-tip-amount">{money(point.expense)}</span>
      </div>
    </div>
  );
}

export function AnalyticsSavingsRate({
  trend,
  money,
  locale,
}: {
  trend: TrendMonth[];
  money: MoneyFormatter;
  locale: string;
}) {
  const { t } = useTranslation();
  const gradientId = useId();
  const series = savingsRateSeries(trend);

  /* Months with no income carry `null`, not 0. Recharts only breaks a line on a
     genuine null — a 0 would be drawn as "saved nothing", which is a claim the
     data does not support. The rest of the point rides along for the tooltip. */
  const plot = series.points.map((point) => ({
    ...point,
    plotted: point.undefinedRate ? null : point.ratePercent,
  }));

  return (
    <div className="arate">
      <div className="arate-head">
        <div className="arate-figure">
          <span className="section-label">{t('analytics.savingsRateTitle')}</span>
          <strong>{formatPercent(series.averagePercent, 1)}</strong>
        </div>
        <span className="arate-meta">
          {t('analytics.savingsRateAverage', {
            value: formatPercent(series.averagePercent, 1),
            count: series.monthsUsed,
          })}
        </span>
      </div>

      <ResponsiveContainer width="100%" height={180}>
        <AreaChart data={plot} margin={{ top: 4, right: 4, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id={`${gradientId}-rate`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" className="arate-stop--top" />
              <stop offset="100%" className="arate-stop--bottom" />
            </linearGradient>
          </defs>

          <CartesianGrid className="ischart-grid" vertical={false} strokeDasharray="3 6" />

          <XAxis
            dataKey="period"
            tickFormatter={(period: string) => period.slice(5)}
            axisLine={false}
            tickLine={false}
            className="proj-axis"
          />
          <YAxis
            width={44}
            axisLine={false}
            tickLine={false}
            className="proj-axis"
            tickFormatter={(value: number) => `${Math.round(value)}%`}
          />

          {/* Zero is the line that matters — above it you kept something. */}
          <ReferenceLine y={0} className="arate-zero" />

          <Tooltip
            isAnimationActive={false}
            cursor={{ className: 'proj-cursor' }}
            content={<RateTip money={money} locale={locale} />}
          />

          <Area
            type="monotone"
            dataKey="plotted"
            className="arate-area"
            fill={`url(#${gradientId}-rate)`}
            strokeWidth={2}
            /* A month with no income has no rate. `connectNulls={false}` plus a
               null value leaves a gap, which is honest; plotting it as 0% would
               claim they saved nothing. */
            connectNulls={false}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>

      {series.hasNegative && (
        <p className="arate-note">{t('analytics.savingsRateNegative')}</p>
      )}
    </div>
  );
}
