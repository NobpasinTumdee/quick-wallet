import { CalendarClock, CreditCard, Repeat2, TrendingDown, TrendingUp, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HeatmapData } from '../hooks/useHeatmapData';
import { cx, formatDate } from '../lib/format';
import { HeatmapDay } from '../lib/liabilityMath';
import { MoneyFormatter } from '../state/SettingsContext';
import { Icon } from './Icon';

/**
 * A month of committed outgoings, as a calendar you can read at a glance.
 *
 * ---------------------------------------------------------------------------
 * WHY FOUR STEPS AND NOT A CONTINUOUS RAMP
 * ---------------------------------------------------------------------------
 * The spending heatmap next door encodes magnitude as one hue at varying
 * opacity, which is right for "how much went out". This asks a different
 * question — "is this day a problem" — and that answer is categorical. Nobody
 * reads 0.55 opacity as meaningfully worse than 0.48, but everybody reads amber
 * as worse than grey. So the level is the encoding and the tint is a supporting
 * detail, not the other way round.
 *
 * The steps are still ordered and still one journey (grey → amber → red), which
 * keeps it a sequential scale rather than a categorical palette wearing one.
 *
 * ---------------------------------------------------------------------------
 * WHY COLOUR IS NEVER THE ONLY SIGNAL
 * ---------------------------------------------------------------------------
 * Red-green colour blindness is the common one and this scale avoids green
 * entirely, but amber-vs-red is still a hard pair for some readers, and none of
 * it survives a greyscale print. So every cell also carries a dot per bill and
 * the amount in its accessible name, and the insights panel states the same
 * conclusions in words. The colour is the fast path, not the only one.
 *
 * ---------------------------------------------------------------------------
 * WHY THE DETAIL PANEL SITS UNDER THE GRID
 * ---------------------------------------------------------------------------
 * The brief asked for a popover. A popover anchored to a 40px cell on a 360px
 * phone has nowhere to go: it either covers the grid it is describing or gets
 * clipped by the card, and it needs collision logic to do either. Rendering the
 * detail immediately below the grid keeps it a popover in every way that
 * matters — transient, tied to the selection, dismissible with Escape — while
 * never being clipped, never covering the data, and staying legible at 320px.
 */

const KIND_ICON = {
  subscription: Repeat2,
  card: CreditCard,
} as const;

export function SubscriptionHeatmap({
  data,
  money,
  locale,
}: {
  data: HeatmapData;
  money: MoneyFormatter;
  locale: string;
}) {
  const { t } = useTranslation();
  const [selected, setSelected] = useState<number | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const selectedDay = selected === null ? null : (data.days[selected - 1] ?? null);

  /* Escape closes the detail — the one keyboard affordance a transient panel
     owes you, and the same idiom the gesture arc uses. */
  useEffect(() => {
    if (selected === null) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setSelected(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selected]);

  /* A day picked further down the month would otherwise open a panel below the
     fold. Only ever scrolls the panel into view, never the page to the top. */
  useEffect(() => {
    if (selected === null) return;
    panelRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }, [selected]);

  /* Locale-correct weekday initials, generated rather than hard-coded — a Thai
     UI must not be labelled S M T W T F S. 4 Jan 1970 was a Sunday. */
  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(1970, 0, 4 + index)).toLocaleDateString(locale, {
      weekday: 'narrow',
      timeZone: 'UTC',
    }),
  );

  if (data.isEmpty) {
    return (
      <div className="liab liab--empty">
        <span className="liab-empty-mark" aria-hidden="true">
          <Icon icon={CalendarClock} size="xl" />
        </span>
        <p className="liab-empty-title">{t('liability.empty')}</p>
        <p className="liab-empty-hint">{t('liability.emptyHint')}</p>
      </div>
    );
  }

  const dayLabel = (day: HeatmapDay) =>
    day.items.length
      ? t('liability.daySummary', {
          date: formatDate(day.date, locale),
          amount: money(day.total),
          count: day.items.length,
        })
      : t('liability.dayEmpty', { date: formatDate(day.date, locale) });

  return (
    <div className="liab">
      <div className="liab-grid-wrap">
        <div className="liab-weekdays" aria-hidden="true">
          {weekdayLabels.map((label, index) => (
            <span key={index}>{label}</span>
          ))}
        </div>

        <div className="liab-grid">
          {Array.from({ length: data.leadingBlanks }, (_, index) => (
            <span key={`blank-${index}`} className="liab-cell liab-cell--blank" aria-hidden="true" />
          ))}

          {data.days.map((day) => (
            <button
              key={day.date}
              type="button"
              className={cx(
                'liab-cell',
                `is-${day.level}`,
                day.isPayday && 'is-payday',
                day.isToday && 'is-today',
                day.isPast && 'is-past',
                selected === day.day && 'is-selected',
              )}
              /* The tint rides on a custom property so the stylesheet owns how
                 intensity becomes colour, and this owns only the number. */
              style={{ '--liab-cell': day.intensity } as React.CSSProperties}
              aria-label={dayLabel(day)}
              aria-pressed={selected === day.day}
              /* Nothing to open on a day with no bills, but it stays focusable
                 so arrow-key travel across the month is not full of holes. */
              onClick={() => setSelected((current) => (current === day.day || !day.items.length ? null : day.day))}
            >
              <span className="liab-cell-day">{day.day}</span>

              {/* One dot per bill: the count survives greyscale and colour
                  blindness, which the fill alone does not. Capped at three
                  because a fourth dot is not legible at this size — and three
                  is already the threshold for the danger tier. */}
              {day.items.length > 0 && (
                <span className="liab-cell-dots" aria-hidden="true">
                  {Array.from({ length: Math.min(day.items.length, 3) }, (_, index) => (
                    <i key={index} />
                  ))}
                </span>
              )}
            </button>
          ))}
        </div>

        <div className="liab-legend">
          <span>{t('liability.legendQuiet')}</span>
          <span className="liab-key is-low" aria-hidden="true" />
          <span className="liab-key is-medium" aria-hidden="true" />
          <span className="liab-key is-high" aria-hidden="true" />
          <span>{t('liability.legendHeavy')}</span>
          {data.paydays.length > 0 && (
            <span className="liab-legend-payday">
              <span className="liab-key is-payday" aria-hidden="true" />
              {t('liability.legendPayday')}
            </span>
          )}
        </div>
      </div>

      {/* ---- The detail ---- */}
      {selectedDay && selectedDay.items.length > 0 && (
        <div className="liab-detail" ref={panelRef} role="group" aria-label={dayLabel(selectedDay)}>
          <div className="liab-detail-head">
            <div>
              <span className="section-label">
                {t('liability.dueOn', { date: formatDate(selectedDay.date, locale) })}
              </span>
              <strong className="liab-detail-total">{money(selectedDay.total)}</strong>
            </div>
            <button
              type="button"
              className="liab-detail-close"
              aria-label={t('liability.close')}
              onClick={() => setSelected(null)}
            >
              <Icon icon={X} size="sm" />
            </button>
          </div>

          <ul className="liab-detail-list">
            {selectedDay.items.map((item) => (
              <li key={item.key}>
                <span className="liab-detail-icon" aria-hidden="true">
                  <Icon icon={KIND_ICON[item.kind]} size="sm" />
                </span>
                <span className="liab-detail-name">
                  {item.name}
                  <small>
                    {t(item.kind === 'card' ? 'liability.kindCard' : 'liability.kindSubscription')}
                  </small>
                </span>
                <span className="liab-detail-amount">{money(item.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <LiabilityInsights data={data} money={money} locale={locale} />
    </div>
  );
}

/**
 * The conclusions, in words.
 *
 * Every figure here is also somewhere on the grid, which is the point: a
 * heatmap shows you a shape and leaves you to work out what it means. These are
 * the three readings worth having done for you — when the crunch is, how big
 * the month is, and whether the crunch lands before you get paid.
 */
function LiabilityInsights({
  data,
  money,
  locale,
}: {
  data: HeatmapData;
  money: MoneyFormatter;
  locale: string;
}) {
  const { t } = useTranslation();

  return (
    <div className="liab-insights">
      {data.peakWeek && (
        <div className="liab-insight">
          <span className="liab-insight-label">{t('liability.peakWeek')}</span>
          <span className="liab-insight-value">
            {t('liability.peakWeekValue', {
              week: data.peakWeek.index,
              from: data.peakWeek.startDay,
              to: data.peakWeek.endDay,
              amount: money(data.peakWeek.total),
            })}
          </span>
          {data.peakDay && (
            <span className="liab-insight-hint">
              {t('liability.peakDay')} ·{' '}
              {t('liability.peakDayValue', {
                date: formatDate(data.peakDay.date, locale),
                amount: money(data.peakDay.total),
              })}
            </span>
          )}
        </div>
      )}

      <div className="liab-insight">
        <span className="liab-insight-label">{t('liability.totalLiabilities')}</span>
        <span className="liab-insight-value liab-insight-value--strong">{money(data.total)}</span>
        <span className="liab-insight-hint">
          {t('liability.fromSubscriptions', { amount: money(data.subscriptionTotal) })}
          {data.cardTotal > 0 && (
            <> · {t('liability.fromCards', { amount: money(data.cardTotal) })}</>
          )}
        </span>
      </div>

      {/* The warning the widget exists for.

          With one payday this is the original reading: money that has to come
          out of last month's balance because it lands before the next cheque.
          With several, that split says almost nothing — paid on the 1st and the
          16th, "after payday" is the whole month — so the heaviest *pay period*
          is shown instead, which is the same question asked correctly. */}
      {data.paydays.length === 0 ? (
        <div className="liab-insight liab-insight--muted">
          <span className="liab-insight-hint">{t('liability.paydayUnset')}</span>
        </div>
      ) : data.paydays.length === 1 ? (
        <div className={cx('liab-insight', data.beforePayday > data.afterPayday && 'is-warning')}>
          <span className="liab-insight-label">
            <Icon icon={TrendingDown} size="sm" />
            {t('liability.beforePayday')}
          </span>
          <span className="liab-insight-value">{money(data.beforePayday)}</span>
          <span className="liab-insight-hint">
            {t('liability.afterPayday')} · {money(data.afterPayday)}
          </span>
        </div>
      ) : (
        <div className="liab-insight">
          <span className="liab-insight-label">
            <Icon icon={TrendingDown} size="sm" />
            {t('liability.peakPayPeriod')}
          </span>
          <span className="liab-insight-value">
            {data.peakPayPeriod
              ? money(data.peakPayPeriod.total)
              : money(0)}
          </span>
          <span className="liab-insight-hint">
            {data.peakPayPeriod
              ? data.peakPayPeriod.fundedBy === null
                ? t('liability.payPeriodLeading', {
                    to: data.peakPayPeriod.endDay,
                  })
                : t('liability.payPeriodFunded', {
                    from: data.peakPayPeriod.startDay,
                    to: data.peakPayPeriod.endDay,
                  })
              : t('liability.paydayCount', { count: data.paydays.length })}
          </span>
        </div>
      )}

      {/* Shared bills point the other way — money coming back, not going out.
          Kept visually apart for that reason: it is the one figure here that
          improves the month rather than costing it. */}
      {data.expectedBack > 0 && (
        <div className="liab-insight is-credit">
          <span className="liab-insight-label">
            <Icon icon={TrendingUp} size="sm" />
            {t('liability.expectedBack')}
          </span>
          <span className="liab-insight-value">{money(data.expectedBack)}</span>
          <span className="liab-insight-hint">
            {t('liability.expectedBackHint', { count: data.openSplitCount })}
          </span>
        </div>
      )}
    </div>
  );
}
