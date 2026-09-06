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

const DATE_PRESETS: { value: DatePreset; label: string }[] = [
  { value: 'period', label: 'This month' },
  { value: 'today', label: 'Today' },
  { value: 'yesterday', label: 'Yesterday' },
  { value: 'last7', label: 'Last 7 days' },
  { value: 'last30', label: 'Last 30 days' },
  { value: 'custom', label: 'Custom range' },
];

/** The four windows people actually mean when they say "morning spending". */
const TIME_PRESETS = [
  { label: 'Morning', icon: Sunrise, from: '06:00', to: '11:59' },
  { label: 'Afternoon', icon: Sun, from: '12:00', to: '17:59' },
  { label: 'Evening', icon: Sunset, from: '18:00', to: '23:59' },
  { label: 'Late night', icon: Moon, from: '00:00', to: '05:59' },
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
                  {preset.label}
                </button>
              ))}
            </div>

            {filters.datePreset === 'custom' && (
              <div className="filter-pair">
                <Field label="From">
                  <Input
                    type="date"
                    value={filters.from}
                    max={filters.to || undefined}
                    onChange={(event) => onChange({ from: event.target.value })}
                  />
                </Field>
                <Field label="To">
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
                    key={preset.label}
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
                    {preset.label}
                  </button>
                );
              })}
            </div>

            <div className="filter-pair">
              <Field label="From">
                <Input
                  type="time"
                  value={filters.timeFrom}
                  onChange={(event) => onChange({ timeFrom: event.target.value })}
                />
              </Field>
              <Field label="To">
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
              <Field label="Wallet">
                <Select
                  value={filters.walletId}
                  onChange={(event) => onChange({ walletId: event.target.value })}
                >
                  <option value="">All wallets</option>
                  {wallets.map((wallet) => (
                    <option key={wallet.id} value={wallet.id}>
                      {wallet.icon} {wallet.name}
                    </option>
                  ))}
                </Select>
              </Field>

              <Field label="Type">
                <Select
                  value={filters.type}
                  onChange={(event) =>
                    onChange({ type: event.target.value as '' | TransactionType })
                  }
                >
                  <option value="">All types</option>
                  <option value="expense">Expense</option>
                  <option value="income">Income</option>
                  <option value="transfer">Transfer</option>
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
              <option value="">All categories</option>
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
              <Field label="At least">
                <DecimalInput
                  value={filters.minAmount}
                  onChange={(raw) => onChange({ minAmount: raw })}
                  placeholder="0.00"
                />
              </Field>
              <Field label="At most">
                <DecimalInput
                  value={filters.maxAmount}
                  onChange={(raw) => onChange({ maxAmount: raw })}
                  placeholder="No limit"
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
              placeholder="Note or category…"
              value={filters.search}
              onChange={(event) => onChange({ search: event.target.value })}
            />
          </section>
        </div>
      )}
    </div>
  );
}
