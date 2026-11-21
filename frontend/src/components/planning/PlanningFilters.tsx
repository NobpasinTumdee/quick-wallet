import { Archive, Columns3, Flag, Rows3, Search, SlidersHorizontal, X } from 'lucide-react';
import { type ReactNode, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '../../hooks/useMediaQuery';
import { cx } from '../../lib/format';
import { activeFilterCount, type DueFilter, EMPTY_FILTERS, type PlanFilters, PRIORITY_ORDER } from '../../lib/planning/filters';
import type { PlanMilestone, PlanPriority } from '../../types/planning';
import { Badge, Button, Modal } from '../ui';
import { Icon } from '../Icon';

export type PlanView = 'board' | 'table' | 'milestones';

const DUE: DueFilter[] = ['overdue', 'week', 'next7', 'none'];
/** Below this, search is an icon that opens the field over the toolbar. */
const COMPACT_SEARCH = '(max-width: 479px)';

function toggleIn<T>(list: T[], value: T): T[] {
  return list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
}

interface Chip {
  key: string;
  label: string;
  clear: Partial<PlanFilters>;
}

/**
 * The board's and table's toolbar: Filters (a sheet), search, the active
 * filters as removable chips in a row that scrolls inside itself, the view
 * toggle and Archived (N).
 */
export function PlanningToolbar({
  filters,
  onChange,
  labels,
  milestones,
  view,
  onView,
  archivedCount,
  onArchived,
  matched,
  total,
}: {
  filters: PlanFilters;
  onChange: (next: PlanFilters) => void;
  labels: string[];
  milestones: PlanMilestone[];
  view: PlanView;
  onView: (view: PlanView) => void;
  /** null until archived cards have been read. */
  archivedCount: number | null;
  onArchived: () => void;
  matched: number;
  total: number;
}) {
  const { t } = useTranslation();
  const compact = useMediaQuery(COMPACT_SEARCH);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const searchButtonRef = useRef<HTMLButtonElement>(null);
  const count = activeFilterCount(filters);
  const patch = (next: Partial<PlanFilters>) => onChange({ ...filters, ...next });
  /* The Milestones view lists milestones, not cards: no filters, search or Archived there. */
  const cardsView = view !== 'milestones';
  const expanded = cardsView && compact && searchOpen;

  useEffect(() => {
    if (expanded) inputRef.current?.focus();
  }, [expanded]);

  const closeSearch = () => {
    inputRef.current?.blur();
    setSearchOpen(false);
    window.requestAnimationFrame(() => searchButtonRef.current?.focus({ preventScroll: true }));
  };

  const msName = (id: string) => (id ? milestones.find((m) => m.id === id)?.title ?? '…' : t('planning.noMilestone'));
  const chips: Chip[] = [
    ...(filters.search.trim() && compact && !searchOpen
      ? [{ key: 'search', label: `“${filters.search.trim()}”`, clear: { search: '' } }]
      : []),
    ...filters.labels.map((l) => ({ key: `l:${l}`, label: l, clear: { labels: filters.labels.filter((x) => x !== l) } })),
    ...filters.priorities.map((p) => ({
      key: `p:${p}`,
      label: t(`planning.priority_${p}`),
      clear: { priorities: filters.priorities.filter((x) => x !== p) },
    })),
    ...filters.milestones.map((m) => ({ key: `m:${m}`, label: msName(m), clear: { milestones: filters.milestones.filter((x) => x !== m) } })),
    ...filters.due.map((d) => ({ key: `d:${d}`, label: t(`planning.due_${d}`), clear: { due: filters.due.filter((x) => x !== d) } })),
    ...(filters.hideDone ? [{ key: 'done', label: t('planning.hideDone'), clear: { hideDone: false } }] : []),
  ];

  const searchField = (
    <label className="plan-search plan-tools-search">
      <Icon icon={Search} size="sm" />
      <input
        ref={inputRef}
        type="search"
        value={filters.search}
        placeholder={t('planning.searchCards')}
        aria-label={t('planning.searchCards')}
        enterKeyHint="search"
        onChange={(e) => patch({ search: e.target.value })}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && expanded) {
            e.preventDefault();
            e.stopPropagation();
            closeSearch();
          }
        }}
      />
    </label>
  );

  return (
    <div className="plan-tools">
      <div className="plan-tools-row">
        {cardsView && (
          <button type="button" className="filters-toggle plan-tools-btn" aria-haspopup="dialog" onClick={() => setSheetOpen(true)}>
            <Icon icon={SlidersHorizontal} size="sm" />
            <span className="plan-tools-label">{t('planning.filters')}</span>
            {count > 0 && <Badge tone="accent">{count}</Badge>}
          </button>
        )}
        {!cardsView ? null : compact ? (
          <button
            ref={searchButtonRef}
            type="button"
            className={cx('plan-icon-btn plan-tools-icon', filters.search.trim() && 'is-active')}
            aria-label={t('planning.searchCards')}
            title={t('planning.searchCards')}
            aria-expanded={searchOpen}
            onClick={() => setSearchOpen(true)}
          >
            <Icon icon={Search} size="sm" />
          </button>
        ) : (
          searchField
        )}
        <span className="plan-grow" />
        {/* One unit, so on a narrow phone the views and Archived wrap together. */}
        <div className="plan-tools-end">
          <div className="plan-view-toggle" role="group" aria-label={t('planning.viewLabel')}>
            <button type="button" aria-pressed={view === 'board'} className={cx(view === 'board' && 'is-active')} onClick={() => onView('board')} title={t('planning.viewBoard')}>
              <Icon icon={Columns3} size="sm" />
              <span className="plan-tools-label">{t('planning.viewBoard')}</span>
            </button>
            <button type="button" aria-pressed={view === 'table'} className={cx(view === 'table' && 'is-active')} onClick={() => onView('table')} title={t('planning.viewTable')}>
              <Icon icon={Rows3} size="sm" />
              <span className="plan-tools-label">{t('planning.viewTable')}</span>
            </button>
            <button type="button" aria-pressed={view === 'milestones'} className={cx(view === 'milestones' && 'is-active')} onClick={() => onView('milestones')} title={t('planning.viewMilestones')}>
              <Icon icon={Flag} size="sm" />
              <span className="plan-tools-label">{t('planning.viewMilestones')}</span>
            </button>
          </div>
          {cardsView && (
            <button type="button" className="filters-toggle plan-tools-btn" onClick={onArchived} aria-haspopup="dialog">
              <Icon icon={Archive} size="sm" />
              <span className="plan-tools-label">
                {archivedCount === null ? t('planning.archived') : t('planning.archivedCount', { count: archivedCount })}
              </span>
              {archivedCount !== null && <span className="plan-tools-num">{archivedCount}</span>}
            </button>
          )}
        </div>
        {expanded && (
          <div className="plan-tools-overlay">
            {searchField}
            <button type="button" className="plan-icon-btn" aria-label={t('planning.closeSearch')} onClick={closeSearch}>
              <Icon icon={X} size="sm" />
            </button>
          </div>
        )}
      </div>
      {cardsView && count > 0 && (
        <div className="plan-tools-chips">
          <span className="plan-tools-match" aria-live="polite">
            {t('planning.matchCount', { matched, total })}
          </span>
          {chips.length > 0 && (
            <div className="filter-chips plan-chip-scroll">
              {chips.map((chip) => (
                <button
                  key={chip.key}
                  type="button"
                  className="filter-chip"
                  aria-label={t('planning.removeFilter', { label: chip.label })}
                  onClick={() => patch(chip.clear)}
                >
                  {chip.label}
                  <Icon icon={X} size="sm" />
                </button>
              ))}
            </div>
          )}
          <Button size="sm" variant="ghost" onClick={() => onChange(EMPTY_FILTERS)}>
            {t('planning.clearAll')}
          </Button>
        </div>
      )}
      <FiltersSheet
        open={sheetOpen}
        filters={filters}
        onChange={onChange}
        labels={labels}
        milestones={milestones}
        matched={matched}
        onClose={() => setSheetOpen(false)}
      />
    </div>
  );
}

function FilterGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="plan-filter-group">
      <legend>{title}</legend>
      <div className="plan-filter-options">{children}</div>
    </fieldset>
  );
}

function Option({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) {
  return (
    <button type="button" className={cx('plan-option', on && 'is-on')} aria-pressed={on} onClick={onClick}>
      {children}
    </button>
  );
}

function FiltersSheet({
  open,
  filters,
  onChange,
  labels,
  milestones,
  matched,
  onClose,
}: {
  open: boolean;
  filters: PlanFilters;
  onChange: (next: PlanFilters) => void;
  labels: string[];
  milestones: PlanMilestone[];
  matched: number;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const patch = (next: Partial<PlanFilters>) => onChange({ ...filters, ...next });
  const shownMilestones = milestones.filter((m) => m.state === 'open' || filters.milestones.includes(m.id));
  return (
    <Modal
      open={open}
      title={t('planning.filters')}
      onClose={onClose}
      width={520}
      footer={
        <>
          <Button className="plan-sheet-aside" variant="ghost" disabled={!activeFilterCount(filters)} onClick={() => onChange({ ...EMPTY_FILTERS, search: filters.search })}>
            {t('planning.clearAll')}
          </Button>
          <Button variant="primary" onClick={onClose}>
            {t('planning.showCards', { count: matched })}
          </Button>
        </>
      }
    >
      <div className="plan-filter-sheet">
        <FilterGroup title={t('planning.fieldPriority')}>
          {PRIORITY_ORDER.map((p: PlanPriority) => (
            <Option key={p} on={filters.priorities.includes(p)} onClick={() => patch({ priorities: toggleIn(filters.priorities, p) })}>
              {p !== 'none' && <span className={`plan-prio plan-prio--${p}`} aria-hidden="true" />}
              {t(`planning.priority_${p}`)}
            </Option>
          ))}
        </FilterGroup>
        <FilterGroup title={t('planning.filterDue')}>
          {DUE.map((d) => (
            <Option key={d} on={filters.due.includes(d)} onClick={() => patch({ due: toggleIn(filters.due, d) })}>
              {t(`planning.due_${d}`)}
            </Option>
          ))}
        </FilterGroup>
        <FilterGroup title={t('planning.fieldLabels')}>
          {labels.length ? (
            labels.map((l) => (
              <Option key={l} on={filters.labels.includes(l)} onClick={() => patch({ labels: toggleIn(filters.labels, l) })}>
                {l}
              </Option>
            ))
          ) : (
            <span className="plan-quiet">{t('planning.noLabelsYet')}</span>
          )}
        </FilterGroup>
        <FilterGroup title={t('planning.fieldMilestone')}>
          <Option on={filters.milestones.includes('')} onClick={() => patch({ milestones: toggleIn(filters.milestones, '') })}>
            {t('planning.noMilestone')}
          </Option>
          {shownMilestones.map((m) => (
            <Option key={m.id} on={filters.milestones.includes(m.id)} onClick={() => patch({ milestones: toggleIn(filters.milestones, m.id) })}>
              {m.title}
            </Option>
          ))}
        </FilterGroup>
        <label className="plan-switch">
          <input type="checkbox" checked={filters.hideDone} onChange={(e) => patch({ hideDone: e.target.checked })} />
          <span>{t('planning.hideDone')}</span>
        </label>
      </div>
    </Modal>
  );
}
