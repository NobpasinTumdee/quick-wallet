import {
  ArrowDownWideNarrow,
  ArrowUpNarrowWide,
  CalendarRange,
  CircleDot,
  Coins,
  Gauge,
  Sparkles,
  Tag,
  Wallet,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../Icon';
import { WalletIconRenderer } from '../WalletIconRenderer';
import { DecimalInput, Field, Input, Segmented, Select } from '../ui';
import { cx } from '../../lib/format';
import {
  ActiveGoalFilter,
  GOAL_DATE_FIELDS,
  GOAL_DATE_PRESETS,
  GOAL_FILTER_PRESETS,
  GOAL_PROGRESS_BANDS,
  GOAL_SORT_KEYS,
  GOAL_STATUS_FILTERS,
  GoalDateField,
  GoalDatePreset,
  GoalFilterPreset,
  GoalFilters,
  GoalProgressBand,
  GoalSortKey,
  GoalStatusFilter,
  isPresetActive,
  presetFilters,
} from '../../lib/goalFilters';
import { TranslationKey } from '../../locales';
import { WalletBalance } from '../../types';

/* Keys, not labels — module-level tables are built once at import time. */
export const STATUS_LABEL: Record<GoalStatusFilter, TranslationKey> = {
  saving: 'goals.statusSaving',
  ready: 'goals.statusReady',
  purchased: 'goals.statusPurchased',
  overdue: 'goals.statusOverdue',
};

export const DATE_FIELD_LABEL: Record<GoalDateField, TranslationKey> = {
  created: 'goals.dateCreated',
  deadline: 'goals.dateDeadline',
  completed: 'goals.dateCompleted',
};

export const DATE_PRESET_LABEL: Record<GoalDatePreset, TranslationKey> = {
  all: 'goals.presetAll',
  thisMonth: 'goals.presetThisMonth',
  last3: 'goals.presetLast3',
  thisYear: 'goals.presetThisYear',
  lastYear: 'goals.presetLastYear',
  custom: 'goals.presetCustom',
};

export const SORT_LABEL: Record<GoalSortKey, TranslationKey> = {
  auto: 'goals.sortAuto',
  deadline: 'goals.sortDeadline',
  created: 'goals.sortCreated',
  completed: 'goals.sortCompleted',
  target: 'goals.sortTarget',
  spent: 'goals.sortSpent',
  progress: 'goals.sortProgress',
  name: 'goals.sortName',
};

const VIEW_PRESET_LABEL: Record<GoalFilterPreset, TranslationKey> = {
  completedThisYear: 'goals.viewCompletedThisYear',
  readyToBuy: 'goals.viewReadyToBuy',
  overdue: 'goals.viewOverdue',
  nearlyThere: 'goals.viewNearlyThere',
};

/** Numbers, so no translation: "75–99%" reads the same in both languages. */
export function bandLabel(band: GoalProgressBand): string {
  return band === '100' ? '100%' : `${band.replace('-', '–')}%`;
}

function toggle<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((item) => item !== value) : [...list, value];
}

/**
 * Labels for the active-filter chips, shared by the bar and the sheet so the
 * two can never describe the same filter in different words.
 */
export function useGoalChipLabel(
  filters: GoalFilters,
  walletName: (id: string) => string,
): (chip: ActiveGoalFilter) => string {
  const { t } = useTranslation();

  const range = (min: string, max: string) =>
    min && max
      ? t('goals.rangeBetween', { min, max })
      : min
        ? t('goals.rangeAtLeast', { min })
        : t('goals.rangeAtMost', { max });

  return (chip) => {
    switch (chip.kind) {
      case 'status':
        return t('goals.chipStatus', { value: t(STATUS_LABEL[chip.value as GoalStatusFilter]) });
      case 'date': {
        const value =
          filters.datePreset === 'custom'
            ? range(filters.from, filters.to)
            : t(DATE_PRESET_LABEL[filters.datePreset]);
        return t('goals.chipDate', { field: t(DATE_FIELD_LABEL[filters.dateField]), value });
      }
      case 'target':
        return t('goals.chipTarget', { range: range(filters.minTarget, filters.maxTarget) });
      case 'spent':
        return t('goals.chipSpent', { range: range(filters.minSpent, filters.maxSpent) });
      case 'progress':
        return t('goals.chipProgress', { value: bandLabel(chip.value as GoalProgressBand) });
      case 'wallet':
        return t('goals.chipWallet', { value: walletName(chip.value) });
      case 'category':
        return t('goals.chipCategory', { value: chip.value });
      case 'search':
        return t('goals.chipSearch', { value: chip.value });
    }
  };
}

/**
 * Every filter, grouped. Rendered in two places with the same markup:
 *
 *   phone    inside the bottom sheet, editing a draft that "Show N" applies
 *   desktop  in the persistent side panel, applying on every change
 *
 * One component so a filter added later cannot exist on one layout and not
 * the other.
 */
export function GoalFilterControls({
  filters,
  onChange,
  wallets,
  walletOptions,
  categoryOptions,
  onPreset,
}: {
  filters: GoalFilters;
  onChange: (patch: Partial<GoalFilters>) => void;
  /** Every wallet, for names and logos. */
  wallets: WalletBalance[];
  /** Wallet ids that paid for at least one goal. */
  walletOptions: string[];
  categoryOptions: string[];
  /** Applies a whole view at once. */
  onPreset: (next: GoalFilters) => void;
}) {
  const { t } = useTranslation();

  const walletById = (id: string) => wallets.find((w) => w.id === id);

  return (
    <div className="gf-controls">
      {/* ---- Quick views ---- */}
      <section className="gf-group">
        <h3 className="gf-group-title">
          <Icon icon={Sparkles} size="sm" />
          {t('goals.groupViews')}
        </h3>
        <div className="gf-chip-row">
          {GOAL_FILTER_PRESETS.map((preset) => {
            const active = isPresetActive(preset, filters);
            return (
              <button
                key={preset}
                type="button"
                className={cx('gf-chip', active && 'is-active')}
                aria-pressed={active}
                onClick={() => onPreset(presetFilters(preset, filters))}
              >
                {t(VIEW_PRESET_LABEL[preset])}
              </button>
            );
          })}
        </div>
      </section>

      {/* ---- Status ---- */}
      <section className="gf-group">
        <h3 className="gf-group-title">
          <Icon icon={CircleDot} size="sm" />
          {t('goals.groupStatus')}
        </h3>
        <div className="gf-chip-row">
          {GOAL_STATUS_FILTERS.map((status) => {
            const active = filters.statuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                className={cx('gf-chip', active && 'is-active')}
                aria-pressed={active}
                onClick={() => onChange({ statuses: toggle(filters.statuses, status) })}
              >
                {t(STATUS_LABEL[status])}
              </button>
            );
          })}
        </div>
      </section>

      {/* ---- When ---- */}
      <section className="gf-group">
        <h3 className="gf-group-title">
          <Icon icon={CalendarRange} size="sm" />
          {t('goals.groupDate')}
        </h3>
        <Segmented
          value={filters.dateField}
          ariaLabel={t('goals.dateBy')}
          onChange={(dateField) => onChange({ dateField })}
          options={GOAL_DATE_FIELDS.map((field) => ({ value: field, label: t(DATE_FIELD_LABEL[field]) }))}
        />
        <div className="gf-chip-row">
          {GOAL_DATE_PRESETS.map((preset) => {
            const active = filters.datePreset === preset;
            return (
              <button
                key={preset}
                type="button"
                className={cx('gf-chip', active && 'is-active')}
                aria-pressed={active}
                onClick={() =>
                  onChange({
                    datePreset: preset,
                    /* Leaving custom drops its bounds, so a chip can never
                       outlive the range it described. */
                    ...(preset === 'custom' ? {} : { from: '', to: '' }),
                  })
                }
              >
                {t(DATE_PRESET_LABEL[preset])}
              </button>
            );
          })}
        </div>
        {filters.datePreset === 'custom' && (
          <div className="gf-pair">
            <Field label={t('goals.filterFrom')}>
              <Input
                type="date"
                value={filters.from}
                max={filters.to || undefined}
                onChange={(event) => onChange({ from: event.target.value })}
              />
            </Field>
            <Field label={t('goals.filterTo')}>
              <Input
                type="date"
                value={filters.to}
                min={filters.from || undefined}
                onChange={(event) => onChange({ to: event.target.value })}
              />
            </Field>
          </div>
        )}
      </section>

      {/* ---- Progress ---- */}
      <section className="gf-group">
        <h3 className="gf-group-title">
          <Icon icon={Gauge} size="sm" />
          {t('goals.groupProgress')}
        </h3>
        <div className="gf-chip-row">
          {GOAL_PROGRESS_BANDS.map((band) => {
            const active = filters.progress.includes(band);
            return (
              <button
                key={band}
                type="button"
                className={cx('gf-chip', 'gf-chip--num', active && 'is-active')}
                aria-pressed={active}
                onClick={() => onChange({ progress: toggle(filters.progress, band) })}
              >
                {bandLabel(band)}
              </button>
            );
          })}
        </div>
      </section>

      {/* ---- How much ---- */}
      <section className="gf-group">
        <h3 className="gf-group-title">
          <Icon icon={Coins} size="sm" />
          {t('goals.groupAmount')}
        </h3>
        <div className="gf-pair">
          <Field label={t('goals.filterTargetMin')}>
            <DecimalInput
              value={filters.minTarget}
              onChange={(minTarget) => onChange({ minTarget })}
              placeholder="0"
            />
          </Field>
          <Field label={t('goals.filterTargetMax')}>
            <DecimalInput
              value={filters.maxTarget}
              onChange={(maxTarget) => onChange({ maxTarget })}
              placeholder={t('goals.filterNoLimit')}
            />
          </Field>
          <Field label={t('goals.filterSpentMin')}>
            <DecimalInput
              value={filters.minSpent}
              onChange={(minSpent) => onChange({ minSpent })}
              placeholder="0"
            />
          </Field>
          <Field label={t('goals.filterSpentMax')}>
            <DecimalInput
              value={filters.maxSpent}
              onChange={(maxSpent) => onChange({ maxSpent })}
              placeholder={t('goals.filterNoLimit')}
            />
          </Field>
        </div>
      </section>

      {/* ---- Paid from ---- */}
      <section className="gf-group">
        <h3 className="gf-group-title">
          <Icon icon={Wallet} size="sm" />
          {t('goals.groupWallet')}
        </h3>
        {walletOptions.length === 0 ? (
          <p className="gf-hint">{t('goals.filterNoPurchases')}</p>
        ) : (
          <div className="gf-chip-row">
            {walletOptions.map((id) => {
              const wallet = walletById(id);
              const active = filters.walletIds.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  className={cx('gf-chip', 'gf-chip--wallet', active && 'is-active')}
                  aria-pressed={active}
                  onClick={() => onChange({ walletIds: toggle(filters.walletIds, id) })}
                >
                  <WalletIconRenderer icon={wallet?.icon} color={wallet?.color} size="sm" />
                  <span className="gf-chip-text">{wallet?.name ?? t('goals.unknownWallet')}</span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ---- Category ---- */}
      <section className="gf-group">
        <h3 className="gf-group-title">
          <Icon icon={Tag} size="sm" />
          {t('goals.groupCategory')}
        </h3>
        {categoryOptions.length === 0 ? (
          <p className="gf-hint">{t('goals.filterNoPurchases')}</p>
        ) : (
          <div className="gf-chip-row">
            {categoryOptions.map((category) => {
              const active = filters.categories.includes(category);
              return (
                <button
                  key={category}
                  type="button"
                  className={cx('gf-chip', active && 'is-active')}
                  aria-pressed={active}
                  onClick={() => onChange({ categories: toggle(filters.categories, category) })}
                >
                  <span className="gf-chip-text">{category}</span>
                </button>
              );
            })}
          </div>
        )}
        <p className="gf-hint">{t('goals.filterPurchaseOnly')}</p>
      </section>

      {/* ---- Order ---- */}
      <section className="gf-group">
        <h3 className="gf-group-title">
          {filters.dir === 'asc' ? (
            <Icon icon={ArrowUpNarrowWide} size="sm" />
          ) : (
            <Icon icon={ArrowDownWideNarrow} size="sm" />
          )}
          {t('goals.groupSort')}
        </h3>
        <div className="gf-sort">
          <Select
            value={filters.sort}
            aria-label={t('goals.sortBy')}
            onChange={(event) => onChange({ sort: event.target.value as GoalSortKey })}
          >
            {GOAL_SORT_KEYS.map((key) => (
              <option key={key} value={key}>
                {t(SORT_LABEL[key])}
              </option>
            ))}
          </Select>
          {/* "Recommended" has its own order per section; a direction would
              have nothing to flip. */}
          {filters.sort !== 'auto' && (
            <Segmented
              value={filters.dir}
              ariaLabel={t('goals.sortDirection')}
              onChange={(dir) => onChange({ dir })}
              options={[
                { value: 'asc', label: t('goals.sortAsc') },
                { value: 'desc', label: t('goals.sortDesc') },
              ]}
            />
          )}
        </div>
      </section>
    </div>
  );
}
