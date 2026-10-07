import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useExcelDB } from './useExcelDB';
import { formatPeriod, shiftPeriod } from '../lib/format';
import { useSettings } from '../state/SettingsContext';
import { Transaction } from '../types';

/** Month, rolling year, or everything ever recorded. */
export type DistributionRange = 'month' | 'year' | 'all';

/**
 * The window an analytics card is drawn over, and the rows for it.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A HOOK AND NOT COPIED INTO BOTH CARDS
 * ---------------------------------------------------------------------------
 * Two cards now offer the same three ranges, the same month stepper and the
 * same all-time warning. Written twice, they drift: one gains a fix the other
 * does not, their cache keys stop matching, and the same month on screen
 * quietly becomes two identical requests instead of one.
 *
 * That last point is the real reason. `useExcelDB` keys its cache on the query
 * params, so two cards showing the same window share one request *only while
 * the params are identical* — including `limit`. Keeping the window in one
 * place is what keeps that true.
 *
 * ---------------------------------------------------------------------------
 * WHY ALL-TIME IS GATED HERE RATHER THAN BY THE CALLER
 * ---------------------------------------------------------------------------
 * The gate has to sit between the click and the state change, because once
 * `range` is 'all' the query's `enabled` flips and the request is already
 * gone. A caller that set the range and *then* asked would be showing a
 * warning about something it had already done.
 */
export interface DistributionRangeState {
  range: DistributionRange;
  /** The month on screen while `range` is 'month'. */
  period: string;
  setPeriod: (next: (current: string) => string) => void;
  /** Rows for the active window, with the collection's loading flags. */
  rows: ReturnType<typeof useExcelDB<Transaction>>;
  /** Caption for the chart — "October 2026", "Last 12 months", "All time". */
  label: string;
  /** Call on a range button. Raises the warning instead when it needs to. */
  select: (next: DistributionRange) => void;
  /** True while the all-time warning is open and nothing has been fetched. */
  confirming: boolean;
  /** Proceed with all-time. */
  acceptAll: () => void;
  /** Dismiss. `range` was never changed, so there is nothing to revert. */
  cancelAll: () => void;
}

export function useDistributionRange(initialPeriod: string): DistributionRangeState {
  const { t } = useTranslation();
  const { settings } = useSettings();

  const [range, setRange] = useState<DistributionRange>('month');
  const [period, setPeriodState] = useState(initialPeriod);
  const [confirming, setConfirming] = useState(false);

  /* Follow the shell's month if it ever moves, rather than sitting on a month
     the rest of the screen has left behind. */
  useEffect(() => setPeriodState(initialPeriod), [initialPeriod]);

  const monthRows = useExcelDB<Transaction>('transactions', { period });

  /* Twelve months back from the start of the displayed month, inclusive. */
  const yearWindow = useMemo(() => {
    const from = `${shiftPeriod(period, -11)}-01`;
    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    return { from, to: `${period}-${String(lastDay).padStart(2, '0')}` };
  }, [period]);

  const yearRows = useExcelDB<Transaction>(
    'transactions',
    { from: yearWindow.from, to: yearWindow.to, limit: 5000 },
    { enabled: range === 'year' },
  );

  /* No window at all. `enabled` is what keeps this from firing before it has
     been asked for — the whole point of the confirmation. */
  const allRows = useExcelDB<Transaction>(
    'transactions',
    { limit: 5000 },
    { enabled: range === 'all' },
  );

  const rows = range === 'all' ? allRows : range === 'year' ? yearRows : monthRows;

  const label =
    range === 'all'
      ? t('pie.rangeAll')
      : range === 'year'
        ? t('pie.rangeYear')
        : formatPeriod(period, settings.locale);

  return {
    range,
    period,
    setPeriod: (next) => setPeriodState((current) => next(current)),
    rows,
    label,
    select: (next) => {
      /* All-time is the only range slow enough to be worth warning about. */
      if (next === 'all' && range !== 'all') {
        setConfirming(true);
        return;
      }
      setRange(next);
    },
    confirming,
    acceptAll: () => {
      setRange('all');
      setConfirming(false);
    },
    cancelAll: () => setConfirming(false),
  };
}
