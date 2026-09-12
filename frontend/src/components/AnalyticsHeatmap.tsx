import { useTranslation } from 'react-i18next';

import { spendingHeatmap } from '../lib/analyticsMath';
import { cx, formatDate } from '../lib/format';
import { MoneyFormatter } from '../state/SettingsContext';
import { Transaction } from '../types';

/**
 * Spending intensity, as a month calendar.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT A CHART LIBRARY
 * ---------------------------------------------------------------------------
 * A heatmap is a grid of squares. Recharts would add a second render path and
 * an SVG coordinate system to draw something CSS Grid already does, and it
 * would fight the theme tokens the rest of the app is coloured from. Thirty-one
 * `<div>`s with one custom property each is smaller, sharper, and themeable.
 *
 * ---------------------------------------------------------------------------
 * ONE HUE, SCALED BY OPACITY
 * ---------------------------------------------------------------------------
 * Magnitude is a sequential encoding: one hue, light to dark, never a rainbow.
 * `--cell` carries the day's intensity and CSS turns it into an alpha on the
 * accent, so all thirteen themes drive it and the ramp is monotone by
 * construction rather than by a hand-picked list of steps.
 */
export function AnalyticsHeatmap({
  transactions,
  period,
  money,
  locale,
}: {
  transactions: Transaction[];
  period: string;
  money: MoneyFormatter;
  locale: string;
}) {
  const { t } = useTranslation();
  const heat = spendingHeatmap(transactions, period);

  /* Locale-correct weekday initials, generated rather than hard-coded — a Thai
     UI must not be labelled S M T W T F S. 4 Jan 1970 was a Sunday. */
  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(1970, 0, 4 + index)).toLocaleDateString(locale, {
      weekday: 'narrow',
      timeZone: 'UTC',
    }),
  );

  return (
    <div className="heat">
      <div className="heat-weekdays" aria-hidden="true">
        {weekdayLabels.map((label, index) => (
          <span key={index}>{label}</span>
        ))}
      </div>

      <div className="heat-grid" role="list">
        {Array.from({ length: heat.leadingBlanks }, (_, index) => (
          <span key={`blank-${index}`} className="heat-cell heat-cell--blank" aria-hidden="true" />
        ))}

        {heat.cells.map((cell) => {
          const label = cell.total
            ? t('analytics.heatmapDayTotal', {
                date: formatDate(cell.date, locale),
                amount: money(cell.total),
              })
            : `${formatDate(cell.date, locale)} · ${t('analytics.heatmapNoSpend')}`;

          return (
            <span
              key={cell.date}
              role="listitem"
              /* The intensity itself is a custom property, not a bucket class —
                 quantising the ramp into five steps would throw away detail for
                 nothing. The one class is the text-contrast switch, which is a
                 genuine either/or. */
              className={cx('heat-cell', cell.intensity > 0.55 && 'is-dark')}
              style={{ '--cell': cell.intensity } as React.CSSProperties}
              title={label}
              aria-label={label}
            >
              <span className="heat-day">{cell.day}</span>
            </span>
          );
        })}
      </div>

      <div className="heat-legend">
        <span>{t('analytics.heatmapLegendLess')}</span>
        {[0, 0.25, 0.5, 0.75, 1].map((step) => (
          <span
            key={step}
            className="heat-cell heat-cell--key"
            style={{ '--cell': step } as React.CSSProperties}
            aria-hidden="true"
          />
        ))}
        <span>{t('analytics.heatmapLegendMore')}</span>
      </div>
    </div>
  );
}
