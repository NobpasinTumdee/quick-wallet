import { ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { ReactNode, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { currentPeriod, cx, shiftPeriod } from '../lib/format';
import { Icon } from './Icon';
import { Button, Modal } from './ui';

/**
 * A month's label that, when the month changes, slides in 6px from the side
 * it is coming from (later months from the right) over 160ms — Full motion
 * only; Reduced fades it, Off swaps it. Keyed on the month, so only a change
 * replays it; a first render stays still.
 */
export function MonthLabel({ period, className, children }: { period: string; className?: string; children: ReactNode }) {
  const shown = useRef(period);
  const direction = useRef<'next' | 'prev' | undefined>(undefined);
  if (shown.current !== period) {
    direction.current = period > shown.current ? 'next' : 'prev';
    shown.current = period;
  }
  return (
    <span key={period} className={cx('month-swap', className)} data-dir={direction.current}>
      {children}
    </span>
  );
}

/**
 * The month stepper in the new phone layout: "‹ Nov 2026 ›" on the top bar's
 * subtitle line instead of a full-width row of its own.
 *
 * The same state and the same three moves as the classic stepper — previous,
 * next, back to this month — plus a month sheet behind the label. The pill is
 * small; each control's tap area is not (see .period-pill in app.css). Away
 * from the current month the pill turns accent-coloured and a one-tap "back
 * to this month" button appears beside it.
 */
export function PeriodPill({
  period,
  locale,
  onChange,
}: {
  /** "YYYY-MM". */
  period: string;
  locale: string;
  onChange: (period: string) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const today = currentPeriod();
  const away = period !== today;
  const label = monthLabel(period, locale, 'short');

  return (
    <>
      <div className={cx('period-pill', away && 'is-away')}>
        <button
          type="button"
          className="period-pill-step"
          aria-label={t('common.previousMonth')}
          onClick={() => onChange(shiftPeriod(period, -1))}
        >
          <Icon icon={ChevronLeft} size="sm" />
        </button>
        <button
          type="button"
          className="period-pill-label"
          aria-haspopup="dialog"
          aria-label={t('period.open', { month: monthLabel(period, locale, 'long') })}
          onClick={() => setOpen(true)}
        >
          <MonthLabel period={period}>{label}</MonthLabel>
        </button>
        <button
          type="button"
          className="period-pill-step"
          aria-label={t('common.nextMonth')}
          onClick={() => onChange(shiftPeriod(period, 1))}
        >
          <Icon icon={ChevronRight} size="sm" />
        </button>
      </div>
      {away && (
        <button
          type="button"
          className="period-pill-today"
          aria-label={t('period.backToToday')}
          title={t('period.backToToday')}
          onClick={() => onChange(today)}
        >
          <Icon icon={RotateCcw} size="sm" />
        </button>
      )}

      <MonthSheet
        open={open}
        period={period}
        locale={locale}
        onClose={() => setOpen(false)}
        onPick={(next) => {
          onChange(next);
          setOpen(false);
        }}
      />
    </>
  );
}

function monthLabel(period: string, locale: string, month: 'short' | 'long'): string {
  const [year, m] = period.split('-').map(Number);
  return new Date(year, m - 1, 1).toLocaleDateString(locale, { month, year: 'numeric' });
}

/** A year stepper over twelve months, and "This month". On the shared Modal,
 *  so Back and Escape close it like every other sheet. */
function MonthSheet({
  open,
  period,
  locale,
  onClose,
  onPick,
}: {
  open: boolean;
  period: string;
  locale: string;
  onClose: () => void;
  onPick: (period: string) => void;
}) {
  const { t } = useTranslation();
  const selectedYear = Number(period.slice(0, 4));
  const [year, setYear] = useState(selectedYear);
  const [shownFor, setShownFor] = useState(period);
  /* Each opening starts on the selected month's year. */
  if (open && shownFor !== period) {
    setShownFor(period);
    setYear(selectedYear);
  }
  const today = currentPeriod();
  const yearLabel = new Date(year, 0, 1).toLocaleDateString(locale, { year: 'numeric' });

  return (
    <Modal
      open={open}
      title={t('period.pickTitle')}
      onClose={onClose}
      width={400}
      footer={
        <Button variant="primary" onClick={() => onPick(today)} disabled={period === today}>
          {t('period.thisMonth')}
        </Button>
      }
    >
      <div className="month-sheet">
        <div className="month-sheet-year">
          <button
            type="button"
            className="month-sheet-step"
            aria-label={t('period.previousYear')}
            onClick={() => setYear((y) => y - 1)}
          >
            <Icon icon={ChevronLeft} size="sm" />
          </button>
          <strong aria-live="polite">{yearLabel}</strong>
          <button
            type="button"
            className="month-sheet-step"
            aria-label={t('period.nextYear')}
            onClick={() => setYear((y) => y + 1)}
          >
            <Icon icon={ChevronRight} size="sm" />
          </button>
        </div>
        <div className="month-sheet-grid">
          {Array.from({ length: 12 }, (_, index) => {
            const value = `${year}-${String(index + 1).padStart(2, '0')}`;
            return (
              <button
                key={value}
                type="button"
                className={cx('month-sheet-month', value === period && 'is-selected', value === today && 'is-today')}
                aria-pressed={value === period}
                aria-label={new Date(year, index, 1).toLocaleDateString(locale, { month: 'long', year: 'numeric' })}
                onClick={() => onPick(value)}
              >
                {new Date(year, index, 1).toLocaleDateString(locale, { month: 'short' })}
              </button>
            );
          })}
        </div>
      </div>
    </Modal>
  );
}
