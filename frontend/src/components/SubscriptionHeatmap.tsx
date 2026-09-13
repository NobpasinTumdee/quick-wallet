import {
  CalendarClock,
  CreditCard,
  Landmark,
  Receipt,
  Repeat2,
  TrendingDown,
  TrendingUp,
  X,
} from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { HeatmapData } from '../hooks/useHeatmapData';
import { cx, formatDate } from '../lib/format';
import { HeatmapDay, LiabilityKind, LiabilityYear } from '../lib/liabilityMath';
import { TranslationKey } from '../locales';
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

/* Typed as a full Record, so a new LiabilityKind is a compile error here rather
   than an `undefined` icon that crashes the detail panel at render. */
const KIND_ICON: Record<LiabilityKind, typeof Repeat2> = {
  subscription: Repeat2,
  card: CreditCard,
  debt: Landmark,
  installment: Receipt,
};

const KIND_LABEL: Record<LiabilityKind, TranslationKey> = {
  subscription: 'liability.kindSubscription',
  card: 'liability.kindCard',
  debt: 'liability.kindDebt',
  installment: 'liability.kindInstallment',
};

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
  /* Keyed on the date rather than the day number: in the year view the 5th
     happens twelve times, and a day-of-month key would highlight all of them. */
  const [selected, setSelected] = useState<string | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);

  const source = data.year ? data.year.days : data.days;
  const selectedDay = selected === null ? null : (source.find((d) => d.date === selected) ?? null);

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

  /* ---- The year view ----
     A different layout for a different question. The month grid is read by
     date; a year is read as a shape, so weeks become columns, weekdays become
     rows, and the dates come off entirely. */
  if (data.year) {
    return (
      <div className="liab liab--year">
        <YearGrid
          year={data.year}
          locale={locale}
          selected={selected}
          onPick={setSelected}
          label={dayLabel}
        />
        {selectedDay && selectedDay.items.length > 0 && (
          <DayDetail
            day={selectedDay}
            money={money}
            locale={locale}
            panelRef={panelRef}
            label={dayLabel(selectedDay)}
            onClose={() => setSelected(null)}
          />
        )}
        <LiabilityInsights data={data} money={money} locale={locale} />
      </div>
    );
  }

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
                selected === day.date && 'is-selected',
              )}
              /* The tint rides on a custom property so the stylesheet owns how
                 intensity becomes colour, and this owns only the number. */
              style={{ '--liab-cell': day.intensity } as React.CSSProperties}
              aria-label={dayLabel(day)}
              aria-pressed={selected === day.date}
              /* Nothing to open on a day with no bills, but it stays focusable
                 so arrow-key travel across the month is not full of holes. */
              onClick={() =>
                setSelected((current) =>
                  current === day.date || !day.items.length ? null : day.date,
                )
              }
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

      {selectedDay && selectedDay.items.length > 0 && (
        <DayDetail
          day={selectedDay}
          money={money}
          locale={locale}
          panelRef={panelRef}
          label={dayLabel(selectedDay)}
          onClose={() => setSelected(null)}
        />
      )}

      <LiabilityInsights data={data} money={money} locale={locale} />
    </div>
  );
}

/**
 * One day's bills, as a panel under whichever grid opened it.
 *
 * Extracted when the year view arrived: both grids needed the identical panel,
 * and the alternative was duplicating forty lines of JSX or having the year
 * reach into the month view's markup. Shared here, the two can never drift into
 * showing the same day differently.
 */
function DayDetail({
  day,
  money,
  locale,
  label,
  panelRef,
  onClose,
}: {
  day: HeatmapDay;
  money: MoneyFormatter;
  locale: string;
  label: string;
  panelRef: React.MutableRefObject<HTMLDivElement | null>;
  onClose: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className="liab-detail" ref={panelRef} role="group" aria-label={label}>
      <div className="liab-detail-head">
        <div>
          <span className="section-label">
            {t('liability.dueOn', { date: formatDate(day.date, locale) })}
          </span>
          <strong className="liab-detail-total">{money(day.total)}</strong>
        </div>
        <button
          type="button"
          className="liab-detail-close"
          aria-label={t('liability.close')}
          onClick={onClose}
        >
          <Icon icon={X} size="sm" />
        </button>
      </div>

      <ul className="liab-detail-list">
        {day.items.map((item) => (
          <li key={item.key}>
            <span className="liab-detail-icon" aria-hidden="true">
              <Icon icon={KIND_ICON[item.kind]} size="sm" />
            </span>
            <span className="liab-detail-name">
              {item.name}
              <small>{t(KIND_LABEL[item.kind])}</small>
            </span>
            <span className="liab-detail-amount">{money(item.amount)}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Twelve months as a contribution graph.
 *
 * ---------------------------------------------------------------------------
 * WHY THE AXES SWAP
 * ---------------------------------------------------------------------------
 * The month grid runs weeks down the page because that is a calendar, and
 * calendars are read by date. A year cannot be read that way — 365 labelled
 * cells is not something anyone scans — so weeks become columns and weekdays
 * become rows. That is the shape that fits a year into one horizontal band and
 * makes clusters visible at a glance, which is the only question a year answers.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SCROLLER IS ALWAYS THERE
 * ---------------------------------------------------------------------------
 * Fifty-three columns at a legible cell size is ~800px: fine on a laptop, not
 * on a phone. Rather than hiding the view below a breakpoint — a year is just
 * as useful on a phone, and hiding it decides for the user — the band scrolls
 * inside its own container. The page layout never widens, and on a narrow
 * screen it degrades to something you swipe rather than something you cannot
 * have.
 */
function YearGrid({
  year,
  locale,
  selected,
  onPick,
  label,
}: {
  year: LiabilityYear;
  locale: string;
  selected: string | null;
  onPick: (date: string | null) => void;
  label: (day: HeatmapDay) => string;
}) {
  const { t } = useTranslation();

  /* Every other row labelled, the way a contribution graph does it: seven
     stacked labels at this cell size is unreadable, and three is enough to
     orient. 4 Jan 1970 was a Sunday. */
  const weekdayLabels = Array.from({ length: 7 }, (_, index) =>
    new Date(Date.UTC(1970, 0, 4 + index)).toLocaleDateString(locale, {
      weekday: 'short',
      timeZone: 'UTC',
    }),
  );

  const monthName = (period: string) => {
    const [year_, month] = period.split('-').map(Number);
    return new Date(year_, month - 1, 1).toLocaleDateString(locale, { month: 'short' });
  };

  return (
    <div className="liabyear">
      <div className="liabyear-scroll">
        <div className="liabyear-inner">
          {/* Month labels ride above the column each month starts in, so they
              land over their own data rather than at even intervals that drift
              a week or two out by December. */}
          <div className="liabyear-months" aria-hidden="true">
            {year.columns.map((column, index) => (
              <span key={index} className="liabyear-month">
                {column.monthLabel ? monthName(column.monthLabel) : ''}
              </span>
            ))}
          </div>

          <div className="liabyear-body">
            <div className="liabyear-weekdays" aria-hidden="true">
              {weekdayLabels.map((day, index) => (
                <span key={index}>{index % 2 === 1 ? day : ''}</span>
              ))}
            </div>

            <div className="liabyear-grid" role="grid" aria-label={t('liability.yearAria')}>
              {year.columns.map((column, index) => (
                <div key={index} className="liabyear-col" role="row">
                  {column.days.map((day, row) =>
                    day === null ? (
                      <span key={row} className="liabyear-cell is-blank" aria-hidden="true" />
                    ) : (
                      <button
                        key={row}
                        type="button"
                        role="gridcell"
                        className={cx(
                          'liabyear-cell',
                          `is-${day.level}`,
                          day.isPayday && 'is-payday',
                          day.isToday && 'is-today',
                          day.isPast && 'is-past',
                          selected === day.date && 'is-selected',
                        )}
                        style={{ '--liab-cell': day.intensity } as React.CSSProperties}
                        title={label(day)}
                        aria-label={label(day)}
                        onClick={() =>
                          onPick(selected === day.date || !day.items.length ? null : day.date)
                        }
                      />
                    ),
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="liab-legend">
        <span>{t('liability.legendQuiet')}</span>
        <span className="liab-key is-low" aria-hidden="true" />
        <span className="liab-key is-medium" aria-hidden="true" />
        <span className="liab-key is-high" aria-hidden="true" />
        <span>{t('liability.legendHeavy')}</span>
        {/* The one hole in a year projection, admitted rather than left for the
            reader to discover. See the note on buildLiabilityYear. */}
        {year.cardsUnprojected && (
          <span className="liabyear-caveat">{t('liability.cardsUnprojected')}</span>
        )}
      </div>
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

  /* The year has its own figures, and showing the month's under a year graph
     would be the worst kind of wrong — plausible numbers describing a different
     window. The payday split is deliberately absent here: it answers "before
     your next cheque", which is a question about the next few weeks, not about
     next August. */
  if (data.year) {
    const year = data.year;
    return (
      <div className="liab-insights">
        {year.peakMonth && (
          <div className="liab-insight">
            <span className="liab-insight-label">{t('liability.peakMonth')}</span>
            <span className="liab-insight-value">
              {t('liability.yearPeakMonth', {
                month: new Date(
                  Number(year.peakMonth.period.slice(0, 4)),
                  Number(year.peakMonth.period.slice(5, 7)) - 1,
                  1,
                ).toLocaleDateString(locale, { month: 'long', year: 'numeric' }),
                amount: money(year.peakMonth.total),
              })}
            </span>
            {year.peakDay && (
              <span className="liab-insight-hint">
                {t('liability.peakDay')} ·{' '}
                {t('liability.peakDayValue', {
                  date: formatDate(year.peakDay.date, locale),
                  amount: money(year.peakDay.total),
                })}
              </span>
            )}
          </div>
        )}

        <div className="liab-insight">
          <span className="liab-insight-label">{t('liability.totalLiabilities')}</span>
          <span className="liab-insight-value liab-insight-value--strong">
            {money(year.total)}
          </span>
          <span className="liab-insight-hint">
            {t('liability.fromSubscriptions', { amount: money(year.subscriptionTotal) })}
            {year.debtTotal > 0 && (
              <> · {t('liability.fromDebts', { amount: money(year.debtTotal) })}</>
            )}
            {year.installmentTotal > 0 && (
              <> · {t('liability.fromInstallments', { amount: money(year.installmentTotal) })}</>
            )}
          </span>
        </div>

        <div className="liab-insight">
          <span className="liab-insight-label">{t('liability.monthlyAverage')}</span>
          <span className="liab-insight-value">{money(year.total / 12)}</span>
          <span className="liab-insight-hint">
            {t('liability.acrossMonths', { count: year.months.length })}
          </span>
        </div>

        {year.expectedBack > 0 && (
          <div className="liab-insight is-credit">
            <span className="liab-insight-label">
              <Icon icon={TrendingUp} size="sm" />
              {t('liability.expectedBack')}
            </span>
            <span className="liab-insight-value">{money(year.expectedBack)}</span>
            <span className="liab-insight-hint">
              {t('liability.expectedBackHint', { count: year.openSplitCount })}
            </span>
          </div>
        )}
      </div>
    );
  }

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
