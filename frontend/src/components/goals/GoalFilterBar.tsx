import { LayoutGrid, RotateCcw, Search, SlidersHorizontal, Table2, X } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../Icon';
import { Badge, Button, Modal, Segmented } from '../ui';
import { GoalFilterControls, STATUS_LABEL, useGoalChipLabel } from './GoalFilterControls';
import { cx } from '../../lib/format';
import { GOAL_STATUS_FILTERS, GoalDatePreset, GoalFilters, clearedGoalFilters } from '../../lib/goalFilters';
import { GoalFiltersState } from '../../hooks/useGoalFilters';
import { WalletBalance } from '../../types';

export type GoalView = 'cards' | 'table';

/** The two date presets worth a one-tap chip on a phone; the rest live in the sheet. */
const QUICK_DATES: { value: GoalDatePreset; labelKey: 'goals.presetThisMonth' | 'goals.presetThisYear' }[] = [
  { value: 'thisMonth', labelKey: 'goals.presetThisMonth' },
  { value: 'thisYear', labelKey: 'goals.presetThisYear' },
];

/**
 * Search, quick chips and the active-filter line.
 *
 * ---------------------------------------------------------------------------
 * PHONE AND DESKTOP ARE DIFFERENT TOOLS
 * ---------------------------------------------------------------------------
 * On a phone the bar is sticky and short: a search box, the "Filters" button
 * with a count, and one scrolling row of the chips people reach for most.
 * Everything else is in a bottom sheet that edits a *draft* — on a small
 * screen each change would otherwise re-flow the list under the sheet, and
 * the live "Show 7 goals" button tells you the outcome before you commit.
 *
 * On a desktop every filter is already visible in the side panel and applies
 * instantly, so this bar only carries search, the result count and the view
 * toggle. Either way, the chips that remove one filter each are always on
 * screen: a filter you cannot see is a filter you forget you set.
 */
export function GoalFilterBar({
  state,
  wallets,
  desktop,
  view,
  onView,
  total,
}: {
  state: GoalFiltersState;
  wallets: WalletBalance[];
  desktop: boolean;
  view: GoalView;
  onView: (view: GoalView) => void;
  /** Goals before filtering — the "of N". */
  total: number;
}) {
  const { t } = useTranslation();
  const { filters, update, chips, visible } = state;
  const [sheetOpen, setSheetOpen] = useState(false);

  const walletName = (id: string) => wallets.find((w) => w.id === id)?.name ?? t('goals.unknownWallet');
  const chipLabel = useGoalChipLabel(filters, walletName);

  /* The search chip is redundant beside the search box that shows the same text. */
  const removable = chips.filter((chip) => chip.kind !== 'search');

  return (
    <div className={cx('gf-bar', desktop ? 'gf-bar--desktop' : 'gf-bar--mobile')}>
      <div className="gf-toolbar">
        <label className="gf-search">
          <Icon icon={Search} size="sm" />
          <input
            type="search"
            value={state.searchInput}
            onChange={(event) => state.setSearchInput(event.target.value)}
            placeholder={t('goals.searchPlaceholder')}
            aria-label={t('goals.searchPlaceholder')}
            enterKeyHint="search"
          />
          {state.searchInput && (
            <button
              type="button"
              className="gf-search-clear"
              aria-label={t('goals.clearSearch')}
              onClick={() => update({ search: '' })}
            >
              <Icon icon={X} size="sm" />
            </button>
          )}
        </label>

        {desktop ? (
          <>
            <span className="gf-count" aria-live="polite">
              {visible.length === total
                ? t('goals.resultCount', { count: total })
                : t('goals.resultOf', { shown: visible.length, total })}
            </span>
            <Segmented
              value={view}
              onChange={onView}
              ariaLabel={t('goals.viewLabel')}
              options={[
                {
                  value: 'cards',
                  label: (
                    <>
                      <Icon icon={LayoutGrid} size="sm" /> {t('goals.viewCards')}
                    </>
                  ),
                },
                {
                  value: 'table',
                  label: (
                    <>
                      <Icon icon={Table2} size="sm" /> {t('goals.viewTable')}
                    </>
                  ),
                },
              ]}
            />
          </>
        ) : (
          <button
            type="button"
            className={cx('gf-open', chips.length > 0 && 'is-active')}
            onClick={() => setSheetOpen(true)}
            aria-haspopup="dialog"
          >
            <Icon icon={SlidersHorizontal} size="sm" />
            <span>{t('goals.filters')}</span>
            {removable.length > 0 && <Badge tone="accent">{removable.length}</Badge>}
          </button>
        )}
      </div>

      {/* ---- One-tap chips (phone) ---- */}
      {!desktop && (
        <div className="gf-quick" role="group" aria-label={t('goals.quickFilters')}>
          {GOAL_STATUS_FILTERS.map((status) => {
            const active = filters.statuses.includes(status);
            return (
              <button
                key={status}
                type="button"
                className={cx('gf-chip', active && 'is-active')}
                aria-pressed={active}
                onClick={() =>
                  update({
                    statuses: active
                      ? filters.statuses.filter((s) => s !== status)
                      : [...filters.statuses, status],
                  })
                }
              >
                {t(STATUS_LABEL[status])}
              </button>
            );
          })}
          {QUICK_DATES.map((preset) => {
            const active = filters.datePreset === preset.value;
            return (
              <button
                key={preset.value}
                type="button"
                className={cx('gf-chip', active && 'is-active')}
                aria-pressed={active}
                onClick={() => update({ datePreset: active ? 'all' : preset.value, from: '', to: '' })}
              >
                {t(preset.labelKey)}
              </button>
            );
          })}
        </div>
      )}

      {/* ---- What is applied ---- */}
      {removable.length > 0 && (
        <div className="gf-active">
          {removable.map((chip) => {
            const label = chipLabel(chip);
            return (
              <button
                key={chip.key}
                type="button"
                className="gf-active-chip"
                onClick={() => update(chip.clear)}
                aria-label={t('goals.removeFilter', { label })}
              >
                <span className="gf-chip-text">{label}</span>
                <Icon icon={X} size="sm" />
              </button>
            );
          })}
          <Button size="sm" variant="ghost" onClick={state.clearAll}>
            <Icon icon={RotateCcw} size="sm" />
            {t('goals.clearAll')}
          </Button>
        </div>
      )}

      {!desktop && (
        <GoalFilterSheet
          open={sheetOpen}
          onClose={() => setSheetOpen(false)}
          state={state}
          wallets={wallets}
        />
      )}
    </div>
  );
}

/**
 * The phone's full filter set, in a bottom sheet.
 *
 * Mounted only while open, so the draft is seeded from the applied filters
 * every time it opens — closing without "Show" discards it, which is what
 * a sheet with a Cancel-shaped close button promises.
 */
function GoalFilterSheet({
  open,
  onClose,
  state,
  wallets,
}: {
  open: boolean;
  onClose: () => void;
  state: GoalFiltersState;
  wallets: WalletBalance[];
}) {
  if (!open) return null;
  return <GoalFilterSheetBody onClose={onClose} state={state} wallets={wallets} />;
}

function GoalFilterSheetBody({
  onClose,
  state,
  wallets,
}: {
  onClose: () => void;
  state: GoalFiltersState;
  wallets: WalletBalance[];
}) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState<GoalFilters>(state.filters);
  const count = state.countFor(draft);

  return (
    <Modal
      open
      onClose={onClose}
      title={t('goals.filtersTitle')}
      width={520}
      footer={
        <>
          <Button variant="ghost" onClick={() => setDraft(clearedGoalFilters(draft))}>
            <Icon icon={RotateCcw} size="sm" />
            {t('goals.resetFilters')}
          </Button>
          <Button
            variant="primary"
            onClick={() => {
              state.replace(draft);
              onClose();
            }}
          >
            {t('goals.showResults', { count })}
          </Button>
        </>
      }
    >
      <GoalFilterControls
        filters={draft}
        onChange={(patch) => setDraft((current) => ({ ...current, ...patch }))}
        onPreset={setDraft}
        wallets={wallets}
        walletOptions={state.walletOptions}
        categoryOptions={state.categoryOptions}
      />
    </Modal>
  );
}
