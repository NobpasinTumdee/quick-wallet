import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ConfirmDialog } from './ConfirmDialog';
import { Icon } from './Icon';
import { Button } from './ui';
import { categoryComposition } from '../lib/analyticsMath';
import { cx, formatPeriod, shiftPeriod } from '../lib/format';
import { DistributionRange, DistributionRangeState } from '../hooks/useDistributionRange';
import { MoneyFormatter, useSettings } from '../state/SettingsContext';
import { Transaction } from '../types';

const RANGES: DistributionRange[] = ['month', 'year', 'all'];

/**
 * The range picker, for a card header.
 *
 * The month stepper only appears while a single month is on screen — there is
 * no "previous" for a rolling year or for all time, and a disabled arrow is
 * just a control asking to be clicked.
 */
export function RangePicker({ state }: { state: DistributionRangeState }) {
  const { t } = useTranslation();
  const { settings } = useSettings();

  return (
    <div className="range-picker">
      {state.range === 'month' && (
        <div className="period-nav">
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('common.previousMonth')}
            onClick={() => state.setPeriod((p) => shiftPeriod(p, -1))}
          >
            <Icon icon={ChevronLeft} size="sm" />
          </Button>
          <span className="range-picker-month">{formatPeriod(state.period, settings.locale)}</span>
          <Button
            size="sm"
            variant="ghost"
            aria-label={t('common.nextMonth')}
            onClick={() => state.setPeriod((p) => shiftPeriod(p, 1))}
          >
            <Icon icon={ChevronRight} size="sm" />
          </Button>
        </div>
      )}

      <div className="range-tabs" role="radiogroup" aria-label={t('pie.rangeLabel')}>
        {RANGES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={state.range === option}
            className={cx('range-tab', state.range === option && 'is-on')}
            onClick={() => state.select(option)}
          >
            {t(option === 'month' ? 'pie.rangeMonth' : option === 'year' ? 'pie.rangeYear' : 'pie.allTime')}
          </button>
        ))}
      </div>
    </div>
  );
}

/** The all-time warning. Mounted by each card beside its own content. */
export function AllTimeConfirm({ state }: { state: DistributionRangeState }) {
  const { t } = useTranslation();
  return (
    <ConfirmDialog
      open={state.confirming}
      tone="primary"
      title={t('pie.allTimeTitle')}
      body={t('pie.allTimeBody')}
      confirmLabel={t('pie.allTimeConfirm')}
      onConfirm={state.acceptAll}
      onClose={state.cancelAll}
    />
  );
}

/**
 * Which categories count, as toggleable chips.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CHIPS ARE BUILT FROM UNFILTERED ROWS
 * ---------------------------------------------------------------------------
 * A chip has to survive being switched off, or there is no way to switch it
 * back on. Built from what is currently *shown*, the chip you just clicked
 * would vanish along with its column.
 *
 * `Infinity` turns off the top-seven bucketing the charts apply, so every real
 * category gets a chip rather than disappearing into "Other" — otherwise a
 * small category could never be excluded at all.
 */
export function useCategoryExclusion(rows: Transaction[], otherLabel: string) {
  const [excluded, setExcluded] = useState<string[]>([]);

  const categories = useMemo(
    () => categoryComposition(rows, Infinity, otherLabel).slices,
    [rows, otherLabel],
  );

  const visible = useMemo(
    () =>
      excluded.length === 0
        ? rows
        : rows.filter((tx) => !excluded.includes(categoryOf(tx, otherLabel))),
    [rows, excluded, otherLabel],
  );

  return {
    excluded,
    categories,
    /** The rows a chart should actually draw. */
    visible,
    toggle: (category: string) =>
      setExcluded((current) =>
        current.includes(category) ? current.filter((c) => c !== category) : [...current, category],
      ),
    reset: () => setExcluded([]),
  };
}

export function CategoryChips({
  categories,
  excluded,
  money,
  onToggle,
  onReset,
}: {
  categories: { category: string; total: number }[];
  excluded: string[];
  money: MoneyFormatter;
  onToggle: (category: string) => void;
  onReset: () => void;
}) {
  const { t } = useTranslation();
  if (categories.length < 2) return null;

  return (
    <div className="category-chips">
      {categories.map((slice) => {
        const off = excluded.includes(slice.category);
        return (
          <button
            key={slice.category}
            type="button"
            aria-pressed={!off}
            className={cx('pie-chip', off && 'is-off')}
            onClick={() => onToggle(slice.category)}
          >
            <span className="pie-chip-name">{slice.category}</span>
            <span className="pie-chip-share">{money(slice.total)}</span>
          </button>
        );
      })}

      {excluded.length > 0 && (
        <button type="button" className="pie-chip-reset" onClick={onReset}>
          {t('pie.showAll')}
        </button>
      )}
    </div>
  );
}

/**
 * The category a transaction counts under.
 *
 * Deliberately the same rule `categoryComposition` applies — expenses only,
 * blank folds into the "Other" label — so a chip cannot switch off a bucket
 * the chart never put anything in.
 */
export function categoryOf(tx: Transaction, otherLabel: string): string {
  return String(tx.category ?? '').trim() || otherLabel;
}
