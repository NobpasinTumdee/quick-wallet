import {
  CalendarRange,
  ChevronDown,
  Clock,
  Coins,
  Moon,
  RotateCcw,
  Search,
  SlidersHorizontal,
  Sun,
  Sunrise,
  Sunset,
  Tag,
  Wallet,
  X,
} from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TranslationKey } from '../locales';

import { cx } from '../lib/format';
import { DatePreset, EMPTY_FILTERS, TxFilters, activeFilters } from '../lib/txFilters';
import { TransactionType, WalletBalance } from '../types';
import { Icon } from './Icon';
import { Badge, Button, DecimalInput, Field, Input, Select } from './ui';

/**
 * The Activity filter drawer.
 *
 * ---------------------------------------------------------------------------
 * TWO LAYERS, ON PURPOSE
 * ---------------------------------------------------------------------------
 * The panel collapses, but the *chips* never do. A filter you cannot see is a
 * filter you forget you set, and then the list looks broken — "where did my
 * transactions go?" is the single most common complaint about faceted search.
 * So the state is always legible in one line, each chip removes exactly its own
 * filter, and the drawer is only where you go to change something.
 *
 * Everything below writes through `onChange` as a patch. The parent owns the
 * state because the date range decides what gets fetched — see `fetchScope`.
 */

/* Keys, not labels — module-level arrays are built once at import time. */
const DATE_PRESETS: { value: DatePreset; labelKey: TranslationKey }[] = [
  { value: 'period', labelKey: 'common.thisMonth' },
  { value: 'today', labelKey: 'activity.datePresetToday' },
  { value: 'yesterday', labelKey: 'activity.datePresetYesterday' },
  { value: 'last7', labelKey: 'activity.datePresetLast7' },
  { value: 'last30', labelKey: 'activity.datePresetLast30' },
  { value: 'custom', labelKey: 'activity.datePresetCustom' },
];

/** The four windows people actually mean when they say "morning spending". */
const TIME_PRESETS = [
  { labelKey: 'activity.timeMorning', icon: Sunrise, from: '06:00', to: '11:59' },
  { labelKey: 'activity.timeAfternoon', icon: Sun, from: '12:00', to: '17:59' },
  { labelKey: 'activity.timeEvening', icon: Sunset, from: '18:00', to: '23:59' },
  { labelKey: 'activity.timeLateNight', icon: Moon, from: '00:00', to: '05:59' },
];

export function TransactionFilters({
  filters,
  onChange,
  wallets,
  categories,
  matched,
  total,
}: {
  filters: TxFilters;
  onChange: (patch: Partial<TxFilters>) => void;
  wallets: WalletBalance[];
  categories: string[];
  /** Rows surviving the filters, and rows fetched — the "12 of 340" line. */
  matched: number;
  total: number;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  const walletName = (id: string) => wallets.find((w) => w.id === id)?.name ?? 'Unknown wallet';
  const chips = activeFilters(filters, { walletName });

  /** True when this preset's window is exactly what's set — drives the chips. */
  const timeMatches = (from: string, to: string) =>
    filters.timeFrom === from && filters.timeTo === to;

  return (
    <div className={cx('filters', open && 'is-open')}>
      <div className="filters-bar">
        <button
          type="button"
          className="filters-toggle"
          aria-expanded={open}
          onClick={() => setOpen((current) => !current)}
        >
          <Icon icon={SlidersHorizontal} size="sm" />
          Filters
          {chips.length > 0 && <Badge tone="accent">{chips.length}</Badge>}
          <Icon icon={ChevronDown} size="sm" className={cx('filters-caret', open && 'is-open')} />
        </button>

        {/* Always visible, open or closed. */}
        <div className="filter-chips">
          {chips.map((chip) => (
            <button
              key={chip.key}
              type="button"
              className="filter-chip"
              onClick={() => onChange(chip.clear)}
              aria-label={`Remove filter: ${chip.label}`}
            >
              {chip.label}
              <Icon icon={X} size="sm" />
            </button>
          ))}
        </div>

        <div className="spacer" />

        <span className="filters-count">
          {matched === total ? (
            <>
              {total} transaction{total === 1 ? '' : 's'}
            </>
          ) : (
            <>
              <strong>{matched}</strong> of {total}
            </>
          )}
        </span>

        {chips.length > 0 && (
          <Button size="sm" variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
            <Icon icon={RotateCcw} size="sm" />
            Clear
          </Button>
        )}
      </div>

      {open && (
        <div className="filters-body">
          {/* ---- When ---- */}
          <section className="filter-group">
            <h3 className="filter-group-title">
              <Icon icon={CalendarRange} size="sm" />
              Date range
            </h3>

            <div className="filter-preset-row">
              {DATE_PRESETS.map((preset) => (
                <button
                  key={preset.value}
                  type="button"
                  className={cx('user-chip', filters.datePreset === preset.value && 'is-active')}
                  onClick={() =>
                    onChange({
                      datePreset: preset.value,
                      // Leaving custom drops its bounds so the chip label can't
                      // outlive the range it described.
                      ...(preset.value === 'custom' ? {} : { from: '', to: '' }),
                    })
                  }
                >
                  {t(preset.labelKey)}
                </button>
              ))}
            </div>

            {filters.datePreset === 'custom' && (
              <div className="filter-pair">
                <Field label={t('activity.filterFrom')}>
                  <Input
                    type="date"
                    value={filters.from}
                    max={filters.to || undefined}
                    onChange={(event) => onChange({ from: event.target.value })}
                  />
                </Field>
                <Field label={t('activity.filterTo')}>
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

          {/* ---- Time of day ---- */}
          <section className="filter-group">
            <h3 className="filter-group-title">
              <Icon icon={Clock} size="sm" />
              Time of day
            </h3>

            <div className="filter-preset-row">
              {TIME_PRESETS.map((preset) => {
                const active = timeMatches(preset.from, preset.to);
                return (
                  <button
                    key={preset.labelKey}
                    type="button"
                    className={cx('user-chip', active && 'is-active')}
                    onClick={() =>
                      onChange(
                        active
                          ? { timeFrom: '', timeTo: '' }
                          : { timeFrom: preset.from, timeTo: preset.to },
                      )
                    }
                  >
                    <Icon icon={preset.icon} size="sm" />
                    {t(preset.labelKey as TranslationKey)}
                  </button>
                );
              })}
            </div>

            <div className="filter-pair">
              <Field label={t('activity.filterFrom')}>
                <Input
                  type="time"
                  value={filters.timeFrom}
                  onChange={(event) => onChange({ timeFrom: event.target.value })}
                />
              </Field>
              <Field label={t('activity.filterTo')}>
                <Input
                  type="time"
                  value={filters.timeTo}
                  onChange={(event) => onChange({ timeTo: event.target.value })}
                />
              </Field>
            </div>

            {/* Stated plainly rather than left to be discovered: the sheet
                stores a date, not a timestamp, so this can only mean "recorded
                at". Setting an end before the start reads as an overnight
                window, which is the useful interpretation of 22:00 → 02:00. */}
            <p className="field-hint">
              Matches when a transaction was <strong>recorded</strong> — the date field itself
              carries no clock time. An end earlier than the start spans midnight.
            </p>
          </section>

          {/* ---- What ---- */}
          <section className="filter-group">
            <h3 className="filter-group-title">
              <Icon icon={Wallet} size="sm" />
              Wallet &amp; type
            </h3>

            <div className="filter-pair">
              <Field label={t('common.wallet')}>
                <Select
                  value={filters.walletId}
                  onChange={(event) => onChange({ walletId: event.target.value })}
                >
                  <option value="">{t('activity.filterAllWallets')}</option>
                  {wallets.map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.icon} {wallet.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label={t('common.type')}>
                <Select
                  value={filters.type}
                  onChange={(event) =>
                    onChange({ type: event.target.value as '' | TransactionType })
                  }
                >
                  <option value="">{t('activity.filterAllTypes')}</option>
                  <option value="expense">{t('forms.typeExpense')}</option>
                  <option value="income">{t('forms.typeIncome')}</option>
                  <option value="transfer">{t('forms.typeTransfer')}</option>
                </Select>
              </Field>
            </div>
          </section>

          <section className="filter-group">
            <h3 className="filter-group-title">
              <Icon icon={Tag} size="sm" />
              Category
            </h3>
            <Select
              value={filters.category}
              onChange={(event) => onChange({ category: event.target.value })}
            >
              <option value="">{t('activity.filterAllCategories')}</option>
              {categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </section>

          {/* ---- How much ---- */}
          <section className="filter-group">
            <h3 className="filter-group-title">
              <Icon icon={Coins} size="sm" />
              Amount
            </h3>
            <div className="filter-pair">
              <Field label={t('activity.filterAtLeast')}>
                <DecimalInput
                  value={filters.minAmount}
                  onChange={(raw) => onChange({ minAmount: raw })}
                  placeholder="0.00"
                />
              </Field>
              <Field label={t('activity.filterAtMost')}>
                <DecimalInput
                  value={filters.maxAmount}
                  onChange={(raw) => onChange({ maxAmount: raw })}
                  placeholder={t('activity.filterNoLimit')}
                />
              </Field>
            </div>
          </section>

          <section className="filter-group filter-group--wide">
            <h3 className="filter-group-title">
              <Icon icon={Search} size="sm" />
              Search
            </h3>
            <Input
              placeholder={t('activity.filterSearchPlaceholder')}
              value={filters.search}
              onChange={(event) => onChange({ search: event.target.value })}
            />
          </section>
        </div>
      )}
    </div>
  );
}
