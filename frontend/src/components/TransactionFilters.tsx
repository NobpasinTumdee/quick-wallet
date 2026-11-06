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
import { ReactNode, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { TranslationKey } from '../locales';

import { cx } from '../lib/format';
import { DatePreset, EMPTY_FILTERS, TxFilters, activeFilters } from '../lib/txFilters';
import { TransactionType, WalletBalance } from '../types';
import { Icon } from './Icon';
import { Badge, Button, DecimalInput, Field, Input, Select } from './ui';
import { WalletPicker } from './WalletPicker';

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
/** Narrower than this, the slim row's search becomes an icon that expands. */
const SEARCH_MIN = 120;
/** Below this viewport width it is always the icon (320px phones). */
const SEARCH_INLINE_FROM = 360;

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

/** The type names the filter chips and the desktop table's badges show. */
export const TYPE_LABELS: Record<TransactionType, TranslationKey> = {
  income: 'forms.typeIncome',
  expense: 'forms.typeExpense',
  transfer: 'forms.typeTransfer',
};

/** "48 transactions", or "12 of 340" with the first number bold. */
export function FilterCount({ matched, total }: { matched: number; total: number }) {
  const { t } = useTranslation();
  return (
    <span className="filters-count">
      {matched === total ? (
        t('activity.countAll', { count: total })
      ) : (
        <span aria-label={t('activity.countLabel', { matched, total })}>
          <strong>{matched}</strong> {t('activity.countOf', { total })}
        </span>
      )}
    </span>
  );
}

export function TransactionFilters({
  filters,
  onChange,
  wallets,
  categories,
  matched,
  total,
  variant = 'bar',
  barExtra,
  trailing,
}: {
  filters: TxFilters;
  onChange: (patch: Partial<TxFilters>) => void;
  wallets: WalletBalance[];
  categories: string[];
  /** Rows surviving the filters, and rows fetched — the "12 of 340" line. */
  matched: number;
  total: number;
  /**
   * `slim`: the phone's compact toolbar (mobile New) — Filters, a search
   * field and `trailing` on one row, the chips under it, and no count (the
   * page shows it beside the totals). The panel it opens is the same.
   */
  variant?: 'bar' | 'slim';
  /** Beside the count on the full bar: desktop's "Group by day". */
  barExtra?: ReactNode;
  /** At the end of the slim row: the ⋯ menu. */
  trailing?: ReactNode;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const slim = variant === 'slim';

  const walletName = (id: string) => wallets.find((w) => w.id === id)?.name ?? t('recurring.unknownWallet');
  const presetLabel = (preset: DatePreset) =>
    t(DATE_PRESETS.find((item) => item.value === preset)?.labelKey ?? 'activity.datePresetCustom');
  const all = activeFilters(filters, { walletName, presetLabel, typeLabel: (type) => t(TYPE_LABELS[type]) });
  /* ---- Slim search ----
     Inline from 360px while the field would get at least SEARCH_MIN px;
     otherwise (320px, a long Filters label) an icon that opens the field over the
     whole row. Measured from what the row's other controls actually take,
     so it follows the language and the filter badge. */
  const rowRef = useRef<HTMLDivElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const [compactSearch, setCompactSearch] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);

  useLayoutEffect(() => {
    const row = rowRef.current;
    if (!slim || !row) return undefined;
    const others = () =>
      (Array.from(row.children) as HTMLElement[]).filter((child) => !child.dataset.slot);
    const measure = () => {
      const gap = parseFloat(getComputedStyle(row).columnGap) || 0;
      const items = others();
      const used = items.reduce((sum, child) => sum + child.getBoundingClientRect().width, 0);
      /* One gap after each of the others, before or after the search slot. */
      setCompactSearch(
        window.innerWidth < SEARCH_INLINE_FROM || row.clientWidth - used - gap * items.length < SEARCH_MIN,
      );
    };
    measure();
    if (typeof ResizeObserver === 'undefined') return undefined;
    const observer = new ResizeObserver(measure);
    observer.observe(row);
    others().forEach((child) => observer.observe(child));
    return () => observer.disconnect();
  }, [slim]);

  const searchExpanded = compactSearch && searchOpen;

  useEffect(() => {
    if (searchExpanded) searchInputRef.current?.focus();
  }, [searchExpanded]);

  /* Closing keeps what was typed (it stays a removable chip) and drops the
     focus, which also puts a phone's keyboard away. */
  const closeSearch = () => {
    searchInputRef.current?.blur();
    setSearchOpen(false);
    window.requestAnimationFrame(() => searchButtonRef.current?.focus({ preventScroll: true }));
  };

  /* While the field is on screen the search is not a chip too. The badge
     still counts it: it is a filter that is on. */
  const searchVisible = slim && (!compactSearch || searchOpen);
  const chips = searchVisible ? all.filter((chip) => chip.key !== 'search') : all;

  const searchField = (
    <label className="filters-search" data-slot="search">
      <Icon icon={Search} size="sm" />
      <input
        ref={searchInputRef}
        type="search"
        value={filters.search}
        placeholder={t('common.search')}
        aria-label={t('common.search')}
        enterKeyHint="search"
        onChange={(event) => onChange({ search: event.target.value })}
        onKeyDown={(event) => {
          if (searchExpanded && event.key === 'Escape') {
            event.preventDefault();
            closeSearch();
          }
        }}
      />
    </label>
  );

  const toggle = (
    <button
      type="button"
      className="filters-toggle"
      aria-expanded={open}
      onClick={() => setOpen((current) => !current)}
    >
      <Icon icon={SlidersHorizontal} size="sm" />
      {t('activity.filtersButton')}
      {all.length > 0 && <Badge tone="accent">{all.length}</Badge>}
      <Icon icon={ChevronDown} size="sm" className={cx('filters-caret', open && 'is-open')} />
    </button>
  );

  const chipButtons = chips.map((chip) => (
    <button
      key={chip.key}
      type="button"
      className="filter-chip"
      onClick={() => onChange(chip.clear)}
      aria-label={t('activity.removeFilter', { label: chip.label })}
    >
      {chip.label}
      <Icon icon={X} size="sm" />
    </button>
  ));

  /** True when this preset's window is exactly what's set — drives the chips. */
  const timeMatches = (from: string, to: string) =>
    filters.timeFrom === from && filters.timeTo === to;

  return (
    <div className={cx('filters', open && 'is-open', slim && 'is-slim')}>
      {slim ? (
        <>
          <div className="filters-slim-row" ref={rowRef}>
            {toggle}
            {compactSearch ? (
              <button
                ref={searchButtonRef}
                type="button"
                data-slot="search"
                className={cx('filters-search-btn', filters.search.trim() && 'is-active')}
                aria-label={t('common.search')}
                title={t('common.search')}
                aria-expanded={searchOpen}
                onClick={() => setSearchOpen(true)}
              >
                <Icon icon={Search} size="sm" />
              </button>
            ) : (
              searchField
            )}
            {trailing}
            {searchExpanded && (
              <div className="filters-search-overlay" data-slot="overlay">
                {searchField}
                <button
                  type="button"
                  className="filters-search-close"
                  aria-label={t('activity.closeSearch')}
                  title={t('activity.closeSearch')}
                  onClick={closeSearch}
                >
                  <Icon icon={X} size="sm" />
                </button>
              </div>
            )}
          </div>
          {chips.length > 0 && (
            <div className="filters-slim-chips">
              <div className="filter-chips">{chipButtons}</div>
              <Button size="sm" variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
                <Icon icon={RotateCcw} size="sm" />
                {t('activity.clear')}
              </Button>
            </div>
          )}
        </>
      ) : (
        <div className="filters-bar">
          {toggle}

          {/* Always visible, open or closed. */}
          <div className="filter-chips">{chipButtons}</div>

          <div className="spacer" />

          {barExtra}

          <FilterCount matched={matched} total={total} />

          {chips.length > 0 && (
            <Button size="sm" variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
              <Icon icon={RotateCcw} size="sm" />
              {t('activity.clear')}
            </Button>
          )}
        </div>
      )}

      {open && (
        <div className="filters-body">
          {/* ---- When ---- */}
          <section className="filter-group">
            <h3 className="filter-group-title">
              <Icon icon={CalendarRange} size="sm" />
              {t('activity.dateRange')}
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
              {t('activity.timeOfDay')}
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
              {t('activity.timeOfDayHint')} <strong>{t('activity.timeOfDayRecorded')}</strong>
              {t('activity.timeOfDayHintRest')}
            </p>
          </section>

          {/* ---- What ---- */}
          <section className="filter-group">
            <h3 className="filter-group-title">
              <Icon icon={Wallet} size="sm" />
              {t('activity.walletAndType')}
            </h3>

            <div className="filter-pair">
              <Field label={t('common.wallet')}>
                <WalletPicker
                  wallets={wallets}
                  value={filters.walletId}
                  onChange={(walletId) => onChange({ walletId })}
                  emptyLabel={t('activity.filterAllWallets')}
                />
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
              {t('common.category')}
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
              {t('common.amount')}
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
              {t('common.search')}
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
