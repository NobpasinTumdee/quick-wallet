import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Check, Download, Ellipsis, Plus, Receipt, RefreshCw, Star, X } from 'lucide-react';
import { MouseEvent, memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { TransactionForm, TransactionPayload } from '../components/TransactionForm';
import { FilterCount, TYPE_LABELS as TYPE_BADGE, TransactionFilters } from '../components/TransactionFilters';
import { Icon } from '../components/Icon';
import { ToolPanel } from '../components/notes/ToolPanel';
import { Alert, Badge, Button, Card, EmptyState, RefreshButton, useOverlay } from '../components/ui';
import { isOptimistic, useExcelDB } from '../hooks/useExcelDB';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { cx, formatDate, formatPeriod, todayKey } from '../lib/format';
import { useMobileV2 } from '../lib/mobileLayout';
import { EMPTY_FILTERS, TxFilters, fetchScope, filterTransactions } from '../lib/txFilters';
import {
  TxTotals,
  daySummary,
  groupByDay,
  groupState,
  pruneSelected,
  selectRange,
  sumTotals,
  toggleGroup,
  toggleSelected,
} from '../lib/txTotals';
import { RecordedAt } from '../components/RecordedAt';
import { MoneyFormatter, useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Transaction, WalletBalance } from '../types';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useConfirm } from '../hooks/useConfirm';
import { downloadCsv, toCsv } from '../lib/csv';
import { ActivitySkeleton } from '../components/skeleton/pageSkeletons';
import { useOptionalFavourites } from '../state/FavouritesContext';

/**
 * Shown beside the title, so the header describes what is actually on screen.
 *
 * `t` is a parameter rather than this being a hook: it is a pure formatter, and
 * threading the function through keeps it callable from anywhere without
 * dragging React's rules-of-hooks along with it.
 */
function rangeLabel(
  filters: TxFilters,
  period: string,
  locale: string,
  t: TFunction,
): string {
  switch (filters.datePreset) {
    case 'today':
      return t('activity.datePresetToday');
    case 'yesterday':
      return t('activity.datePresetYesterday');
    case 'last7':
      return t('activity.datePresetLast7');
    case 'last30':
      return t('activity.datePresetLast30');
    case 'custom':
      return filters.from || filters.to
        ? t('activity.rangeSpan', {
            from: filters.from || t('activity.rangeStart'),
            to: filters.to || t('activity.rangeToday'),
          })
        : t('activity.datePresetCustom');
    default:
      return formatPeriod(period, locale);
  }
}

const NO_SELECTION: ReadonlySet<string> = new Set();
const GROUP_KEY = 'qw.activity.groupByDay';

/** Desktop's "Group by day": on unless this device switched it off. */
function useGroupByDay(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(() => {
    try {
      return window.localStorage.getItem(GROUP_KEY) !== 'off';
    } catch {
      return true;
    }
  });
  const set = useCallback((next: boolean) => {
    setOn(next);
    try {
      window.localStorage.setItem(GROUP_KEY, next ? 'on' : 'off');
    } catch {
      /* Storage blocked: it holds for this visit. */
    }
  }, []);
  return [on, set];
}

export function TransactionsPage({ period }: { period: string }) {
  const favourites = useOptionalFavourites();
  const { t } = useTranslation();
  const { settings } = useSettings();
  const [filters, setFilters] = useState<TxFilters>(EMPTY_FILTERS);

  const patchFilters = (patch: Partial<TxFilters>) =>
    setFilters((current) => ({ ...current, ...patch }));

  const wallets = useExcelDB<WalletBalance>('wallets', { includeArchived: true });

  /* Only the date range reaches the server, because only it decides which rows
     exist locally at all. Every other filter runs over the cached array below,
     so changing a wallet or typing in the search box costs nothing — it used to
     mint a new cache key and a fresh 1–3s round trip each time. */
  const scope = useMemo(() => fetchScope(filters, period), [filters, period]);
  const transactions = useExcelDB<Transaction>('transactions', scope);

  const [editing, setEditing] = useState<Transaction | undefined>();
  const [formOpen, setFormOpen] = useState(false);

  const money = useMoneyFormatter();
  const walletName = (id: string) => wallets.items.find((w) => w.id === id)?.name ?? '—';

  /* Which of the two layouts to build. A stylesheet switch would leave both
     in the DOM, and this list can be five thousand rows — see the note in
     `useMediaQuery`. */
  const desktop = useMediaQuery(DESKTOP_QUERY);
  /* The new phone layout groups the tiles by day. */
  const mobileV2 = useMobileV2();
  const [groupDays, setGroupDays] = useGroupByDay();

  const visible = useMemo(
    () => filterTransactions(transactions.items, filters),
    [transactions.items, filters],
  );

  /* The header's "in · out · net". Every day header and the selection bar
     use the same function, so they always agree with it. */
  const totals = useMemo(() => sumTotals(visible), [visible]);
  const groups = useMemo(() => groupByDay(visible), [visible]);

  /* ---- Selection ----
     A calculator only: which rows to add up. Never saved, never sent, and
     not offered on the Classic phone layout. */
  const selectable = desktop || mobileV2;
  const [selected, setSelected] = useState<ReadonlySet<string>>(NO_SELECTION);
  const anchorRef = useRef<string | null>(null);
  const hasSelection = selectable && selected.size > 0;

  const clearSelection = useCallback(() => {
    setSelected(NO_SELECTION);
    anchorRef.current = null;
  }, []);

  /* A new month, filter or search is a different list: start again. */
  useEffect(() => {
    clearSelection();
  }, [period, filters, clearSelection]);

  /* A deleted row leaves the selection with it. */
  const visibleIds = useMemo(() => visible.map((tx) => tx.id), [visible]);
  useEffect(() => {
    const present = new Set(visibleIds);
    setSelected((current) => (current.size ? pruneSelected(current, present) : current));
  }, [visibleIds]);

  /* Back on a phone clears the selection before it does anything else; the
     page keeps scrolling while it is open. */
  useOverlay(hasSelection, clearSelection, { lockScroll: false });

  /* Escape on a desktop, unless it belongs to a field or an open dialog. */
  useEffect(() => {
    if (!hasSelection || !desktop) return undefined;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.defaultPrevented) return;
      if (document.documentElement.classList.contains('has-overlay')) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest('input, textarea, select, [contenteditable="true"]')) return;
      clearSelection();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [hasSelection, desktop, clearSelection]);

  /* The bar sits above the toasts' usual place; they move up over it. */
  useEffect(() => {
    if (!hasSelection) return undefined;
    document.documentElement.classList.add('has-tx-selection');
    return () => document.documentElement.classList.remove('has-tx-selection');
  }, [hasSelection]);

  const selectedTotals = useMemo(
    () => (hasSelection ? sumTotals(visible.filter((tx) => selected.has(tx.id))) : null),
    [hasSelection, visible, selected],
  );

  /* Stable handlers for the memoised rows. The set itself is updated from
     its latest value, so two quick taps never lose one. */
  const latest = useRef({ visibleIds, desktop });
  latest.current = { visibleIds, desktop };

  const onSelect = useCallback((id: string, shift: boolean) => {
    const { visibleIds: order, desktop: wide } = latest.current;
    const anchor = anchorRef.current;
    anchorRef.current = id;
    setSelected((current) =>
      shift && wide ? selectRange(current, order, anchor, id) : toggleSelected(current, id),
    );
  }, []);

  const onEdit = useCallback((tx: Transaction) => {
    setEditing(tx);
    setFormOpen(true);
  }, []);

  /**
   * Optimistic submit.
   *
   * The row is already in the cache by the time `create()` yields its first
   * await, so we close the modal immediately rather than blocking on the 1–3s
   * Apps Script round trip. If the write fails the hook rolls the row back out
   * of the list and raises a toast — the form has already gone, which is the
   * right trade for an operation that succeeds virtually every time.
   */
  function save(payload: TransactionPayload) {
    const pending = editing ? transactions.update(editing.id, payload) : transactions.create(payload);

    setFormOpen(false);
    setEditing(undefined);

    // Swallow here: the failure is reported by the toast + rollback.
    pending.catch(() => undefined);
    return Promise.resolve();
  }

  const confirmDelete = useConfirm<Transaction>();
  const askDelete = confirmDelete.ask;

  /* "Today", "Yesterday", else "Sat, 31 Oct" (plus the year when it is not
     this year). */
  const dayLabel = (date: string) => {
    const today = todayKey();
    if (date === today) return t('activity.datePresetToday');
    if (date === shiftDay(today, -1)) return t('activity.datePresetYesterday');
    const value = new Date(`${date}T00:00:00`);
    if (Number.isNaN(value.getTime())) return formatDate(date, settings.locale);
    return value.toLocaleDateString(settings.locale, {
      weekday: 'short',
      day: 'numeric',
      month: 'short',
      ...(date.slice(0, 4) === today.slice(0, 4) ? {} : { year: 'numeric' }),
    });
  };

  function exportCsv() {
    /* Raw values, not formatted ones: a spreadsheet wants a number it can sum
       and an ISO date it can sort. `money()` would write "THB 1,234.00" into
       every amount cell and make the column text. */
    const rows = visible.map((tx) => [
      tx.date,
      tx.type,
      tx.category,
      walletName(tx.walletId),
      tx.note,
      tx.amount,
    ]);
    const header = [
      t('common.date'),
      t('common.type'),
      t('common.category'),
      t('common.wallet'),
      t('common.note'),
      t('common.amount'),
    ];
    downloadCsv(`quick-wallet-export-${period}.csv`, toCsv(header, rows));
  }

  async function remove(tx: Transaction) {
    // Disappears instantly; reappears with a toast if the server refuses.
    await transactions.remove(tx.id).catch(() => undefined);
  }

  const openNew = () => {
    setEditing(undefined);
    setFormOpen(true);
  };
  const refreshAll = () => Promise.all([transactions.refresh(), wallets.refresh()]);
  const refreshing = transactions.isValidating || wallets.isValidating;

  /* Everything a row needs, as plain values so an unchanged row skips its render. */
  const rowProps = (tx: Transaction) => ({
    tx,
    walletLabel: walletName(tx.walletId),
    toWalletLabel: tx.type === 'transfer' ? walletName(tx.toWalletId) : '',
    selected: selected.has(tx.id),
    selectable,
    money,
    locale: settings.locale,
    onEdit,
    onDelete: askDelete,
    onSelect,
  });

  const filterProps = {
    filters,
    onChange: patchFilters,
    wallets: wallets.items,
    categories: settings.categories,
    matched: visible.length,
    total: transactions.items.length,
  };

  return (
    <>
      {mobileV2 ? (
        /* The phone's slim toolbar: the top bar already names the page and
           the month pill the month, so this keeps only what is not shown
           anywhere else — the totals, the count, search, filters, and the
           page's actions in ⋯. A range other than the month shows as a chip. */
        <section className="card tx-slim" aria-label={t('nav.transactions')}>
          <div className="tx-slim-top">
            <p
              className="tx-slim-totals"
              aria-label={t('activity.totals', {
                income: money(totals.income),
                expense: money(totals.expense),
                net: money(totals.net),
              })}
            >
              <span className="text-positive">+{money(totals.income)}</span>
              <span className="tx-sep" aria-hidden="true">·</span>
              <span className="text-negative">−{money(totals.expense)}</span>
              <span className="tx-sep" aria-hidden="true">·</span>
              <span className={netTone(totals.net)}>={signedNet(totals.net, money)}</span>
            </p>
            <FilterCount matched={visible.length} total={transactions.items.length} />
          </div>
          <TransactionFilters
            {...filterProps}
            variant="slim"
            trailing={
              <ActivityMenu
                canExport={visible.length > 0}
                refreshing={refreshing}
                onAdd={openNew}
                onExport={exportCsv}
                onRefresh={refreshAll}
              />
            }
          />
        </section>
      ) : (
        <Card
          title={t('activity.header', { range: rangeLabel(filters, period, settings.locale, t) })}
          subtitle={t('activity.totals', { income: money(totals.income), expense: money(totals.expense), net: money(totals.net) })}
          /* Two entry points, deliberately. The floating button is always
             within thumb reach and is how a transaction gets added on a phone;
             this one sits where someone already is when they have been reading
             the list and decide to add to it, and is the only one a mouse user
             finds without hunting the bottom-right corner.

             It is the accent-filled control in the header, so it reads as the
             page's primary action rather than as another ghost icon. */
          actions={
            <>
              {/* Exports exactly what the filters have narrowed to, not the whole
                  ledger: the list on screen is the answer someone just built, and
                  an export that ignored it would be a different question. */}
              <Button
                size="sm"
                variant="ghost"
                disabled={visible.length === 0}
                onClick={() => exportCsv()}
              >
                <Icon icon={Download} size="sm" />
                {t('activity.exportCsv')}
              </Button>

              <Button variant="primary" size="sm" onClick={openNew}>
                <Icon icon={Plus} size="sm" />
                {t('activity.addTransaction')}
              </Button>
              <RefreshButton onRefresh={refreshAll} busy={refreshing} label={t('activity.refresh')} />
            </>
          }
        >
          <TransactionFilters
            {...filterProps}
            barExtra={
              desktop ? (
                <label className="tx-group-switch">
                  <input type="checkbox" checked={groupDays} onChange={(event) => setGroupDays(event.target.checked)} />
                  <span>{t('activity.groupByDay')}</span>
                </label>
              ) : undefined
            }
          />
        </Card>
      )}

      <Card padded={false} className={mobileV2 ? 'tx-card-v2' : undefined}>
        {transactions.mutationError && (
          <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
            <Alert tone="error" onDismiss={transactions.clearMutationError}>
              {transactions.mutationError}
            </Alert>
          </div>
        )}

        {transactions.initialLoading ? (
          <ActivitySkeleton desktop={desktop} mobileV2={mobileV2} />
        ) : transactions.error && !transactions.items.length ? (
          <div className="card-body">
            <Alert tone="error">{transactions.error}</Alert>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon={<Icon icon={Receipt} size="xl" />}
            /* "Nothing here" and "nothing matches" are different problems with
               different fixes, so they get different words and different
               buttons — offering "add a transaction" to someone whose filters
               are too narrow is the wrong advice. */
            title={t(transactions.items.length ? 'activity.noMatches' : 'activity.nothingRecorded')}
            description={
              wallets.items.length === 0
                ? t('activity.createWalletFirst')
                : transactions.items.length
                  ? t('activity.filteredOutBody', { count: transactions.items.length })
                  : t('activity.nothingInRange')
            }
            action={
              transactions.items.length ? (
                <Button onClick={() => setFilters(EMPTY_FILTERS)}>{t('common.clearFilters')}</Button>
              ) : wallets.items.length > 0 ? (
                <Button variant="primary" onClick={() => setFormOpen(true)}>
                  {t('activity.addTransaction')}
                </Button>
              ) : undefined
            }
          />
        ) : (
          /* Two layouts for one list, and only ever one of them built.

             A table is the right shape on a desktop: seven columns of aligned,
             scannable fields, which is what someone reconciling a month
             actually wants. It is the wrong shape on a phone, where those same
             columns become a horizontal scrollbar hiding the note and the
             category — the two fields that say what a row *was*.

             So the phone gets tiles and the desktop keeps its table, switched
             at the same 768px the stylesheet uses for every other structural
             change. */
          desktop ? (
            <div className="table-wrap">
              <table className="data tx-table">
                <thead>
                  <tr>
                    <th className="tx-sel-col">
                      <span className="sr-only">{t('activity.selectColumn')}</span>
                    </th>
                    <th>{t('common.type')}</th>
                    <th>{t('common.amount')}</th>
                    <th>{t('common.date')}</th>
                    <th>{t('activity.categoryOrRoute')}</th>
                    <th>{t('common.wallet')}</th>
                    <th>{t('common.note')}</th>
                    <th className="num" />
                  </tr>
                </thead>
                {groupDays ? (
                  /* One <tbody> per day, headed by a real row header, so a
                     screen reader announces the day for every row under it. */
                  groups.map((group) => {
                    const ids = group.rows.map((tx) => tx.id);
                    const state = groupState(ids, selected);
                    const label = dayLabel(group.date);
                    return (
                      <tbody key={group.key} className="tx-day">
                        <tr className="tx-day-row">
                          <th scope="rowgroup" colSpan={8}>
                            <div className="tx-day-band">
                              <button
                                type="button"
                                role="checkbox"
                                className={cx('tx-day-check', `is-${state}`)}
                                aria-checked={state === 'all' ? true : state === 'some' ? 'mixed' : false}
                                aria-label={t('activity.selectDay', { day: label })}
                                title={t('activity.selectDay', { day: label })}
                                onClick={() => {
                                  setSelected((current) => toggleGroup(current, ids));
                                  anchorRef.current = null;
                                }}
                              >
                                {state === 'all' ? <Icon icon={Check} size="sm" /> : state === 'some' ? <span className="tx-day-dash" /> : null}
                              </button>
                              <span className="tx-day-label">{label}</span>
                              <DayTotals totals={group.totals} money={money} />
                            </div>
                          </th>
                        </tr>
                        {group.rows.map((tx) => (
                          <TxRow key={tx.id} {...rowProps(tx)} />
                        ))}
                      </tbody>
                    );
                  })
                ) : (
                  <tbody>
                    {visible.map((tx) => (
                      <TxRow key={tx.id} {...rowProps(tx)} />
                    ))}
                  </tbody>
                )}
              </table>
            </div>
          ) : (
          /* A list, not a table.

             Seven columns on a 375px screen meant horizontal scrolling, and the
             two fields that say what a row actually *was* — the note and the
             category — were the ones off the right edge. A tile puts them
             first and lets the rest be secondary, which is the same order a
             bank statement app uses because it is the order people read in.

             The row itself is the edit control: tapping an entry to correct it
             is what the whole list is for, and it leaves room for the amount
             to stay legible at the right. Delete keeps its own button, because
             a destructive action reached by the same gesture as the common one
             is how rows get deleted by accident. */
          mobileV2 ? (
            /* New phone layout: the same tiles, grouped under a sticky header
               per day, which carries that day's totals. Each tile still shows
               its own date. */
            <div className="tx-groups">
              {groups.map((group) => (
                <section key={group.key} className="tx-group">
                  <h3 className="tx-group-head">
                    <span className="tx-day-head">
                      <span className="tx-day-label">{dayLabel(group.date)}</span>
                      <DayTotals totals={group.totals} money={money} />
                    </span>
                  </h3>
                  <ul className="tx-list">
                    {group.rows.map((tx) => (
                      <TxTile key={tx.id} {...rowProps(tx)} mobileV2 />
                    ))}
                  </ul>
                </section>
              ))}
            </div>
          ) : (
            <ul className="tx-list">
              {visible.map((tx) => (
                <TxTile key={tx.id} {...rowProps(tx)} mobileV2={false} />
              ))}
            </ul>
          )
          )
        )}
      </Card>

      {selectable && (
        <SelectionBar
          totals={selectedTotals}
          money={money}
          allSelected={selected.size === visible.length}
          onSelectAll={() => {
            setSelected(new Set(visibleIds));
            anchorRef.current = null;
          }}
          onClear={clearSelection}
          onMakeFavourite={
            favourites && selected.size === 1
              ? () => {
                  const tx = visible.find((row) => selected.has(row.id));
                  if (tx) favourites.makeFromTransaction(tx);
                }
              : undefined
          }
        />
      )}

      <TransactionForm
        open={formOpen}
        wallets={wallets.items.filter((w) => !w.archived)}
        transaction={editing}
        busy={transactions.mutating}
        error={transactions.mutationError}
        onClose={() => {
          setFormOpen(false);
          setEditing(undefined);
          transactions.clearMutationError();
        }}
        onSubmit={save}
      />
      <ConfirmDialog
        open={confirmDelete.open}
        busy={confirmDelete.busy}
        title={t('activity.deleteTitle')}
        body={
          <>
            <strong className="confirm-subject">{confirmDelete.subject ? money(confirmDelete.subject.amount) : null}</strong>
            {t('activity.deleteWarning')}
          </>
        }
        confirmLabel={t('activity.deleteAction')}
        onConfirm={() => void confirmDelete.run(remove)}
        onClose={confirmDelete.cancel}
      />

    </>
  );
}

/* ---- Pieces ---- */

/** A net figure beside "+in" and "−out": the same `money()`, with a real
 *  minus sign in front instead of the formatter's hyphen ("=−฿5" not "=-฿5"). */
function signedNet(net: number, money: MoneyFormatter): string {
  return net < 0 ? `−${money(-net)}` : money(net);
}

function netTone(net: number): string | undefined {
  return net > 0 ? 'text-positive' : net < 0 ? 'text-negative' : undefined;
}

/**
 * A day's figures, by the same rules as the header: income and expense by
 * type, transfers in neither. A day with only one kind shows that figure
 * once; a day of nothing but transfers says so.
 */
const DayTotals = memo(function DayTotals({ totals, money }: { totals: TxTotals; money: MoneyFormatter }) {
  const { t } = useTranslation();
  const summary = daySummary(totals);
  switch (summary.kind) {
    case 'full':
      return (
        <span
          className="tx-day-sum is-full"
          aria-label={t('activity.dayTotals', {
            income: money(summary.income),
            expense: money(summary.expense),
            net: money(summary.net),
          })}
        >
          <span className="tx-day-io" aria-hidden="true">
            <span className="text-positive">+{money(summary.income)}</span>
            <span className="tx-sep">·</span>
            <span className="text-negative">−{money(summary.expense)}</span>
          </span>
          <span className="tx-day-net" aria-hidden="true">
            <span className="tx-sep tx-sep-net">·</span>
            <span className={netTone(summary.net)}>={signedNet(summary.net, money)}</span>
          </span>
        </span>
      );
    case 'income':
      return (
        <span className="tx-day-sum" aria-label={t('activity.dayIncome', { amount: money(summary.income) })}>
          <span className="tx-day-net text-positive" aria-hidden="true">+{money(summary.income)}</span>
        </span>
      );
    case 'expense':
      return (
        <span className="tx-day-sum" aria-label={t('activity.dayExpense', { amount: money(summary.expense) })}>
          <span className="tx-day-net text-negative" aria-hidden="true">−{money(summary.expense)}</span>
        </span>
      );
    case 'transfers':
      return (
        <span className="tx-day-sum">
          <span className="tx-day-net tx-day-muted">{t('activity.dayTransfersOnly')}</span>
        </span>
      );
    default:
      return null;
  }
});

type RowProps = {
  tx: Transaction;
  walletLabel: string;
  toWalletLabel: string;
  selected: boolean;
  selectable: boolean;
  money: MoneyFormatter;
  locale: string;
  onEdit: (tx: Transaction) => void;
  onDelete: (tx: Transaction) => void;
  onSelect: (id: string, shift: boolean) => void;
};

function primaryText(tx: Transaction, walletLabel: string, toWalletLabel: string, t: TFunction): string {
  return tx.type === 'transfer'
    ? t('activity.transferRoute', { from: walletLabel, to: toWalletLabel })
    : tx.note || tx.category || t('activity.untitledEntry');
}

/** The direction mark — and, where the page offers selection, the button
 *  that selects the row, showing a tick while it is selected. */
function SelectMark({
  tx,
  name,
  selected,
  onSelect,
}: {
  tx: Transaction;
  name: string;
  selected: boolean;
  onSelect: (id: string, shift: boolean) => void;
}) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      className={cx('tx-select', selected && 'is-selected')}
      aria-pressed={selected}
      aria-label={t('activity.selectRow', { name })}
      onMouseDown={(event: MouseEvent) => {
        /* Shift+click would otherwise select the page's text. */
        if (event.shiftKey) event.preventDefault();
      }}
      onClick={(event) => onSelect(tx.id, event.shiftKey)}
    >
      <DirectionMark type={tx.type} selected={selected} />
    </button>
  );
}

function DirectionMark({ type, selected = false }: { type: Transaction['type']; selected?: boolean }) {
  return (
    <span className={cx('tx-mark', `is-${type}`, selected && 'is-selected')} aria-hidden="true">
      <Icon
        icon={selected ? Check : type === 'income' ? ArrowDownLeft : type === 'expense' ? ArrowUpRight : ArrowLeftRight}
        size="sm"
      />
    </span>
  );
}

/* One activity row — the same in both phone layouts; the new one groups
   them by day and lets the mark select the row. Classic renders exactly the
   markup it always has. */
const TxTile = memo(function TxTile({
  tx,
  walletLabel,
  toWalletLabel,
  selected,
  selectable,
  money,
  locale,
  onEdit,
  onDelete,
  onSelect,
  mobileV2,
}: RowProps & { mobileV2: boolean }) {
  const { t } = useTranslation();
  const primary = primaryText(tx, walletLabel, toWalletLabel, t);
  const withSelect = selectable && mobileV2;

  return (
    <li className={cx('tx-tile', isOptimistic(tx) && 'is-pending', withSelect && 'is-selectable', selected && 'is-selected')}>
      {withSelect && <SelectMark tx={tx} name={primary} selected={selected} onSelect={onSelect} />}
      <button type="button" className="tx-tile-main" onClick={() => onEdit(tx)}>
        {/* Direction, not a category glyph: the app has no icon per
            category, and inventing one would be decoration. This
            carries the same meaning as the old type badge in a
            quarter of the width. */}
        {!withSelect && <DirectionMark type={tx.type} />}

        <span className="tx-body">
          <span className="tx-title">{primary}</span>
          <span className="tx-meta">
            <span>{formatDate(tx.date, locale)}</span>
            <span className="tx-meta-sep" aria-hidden="true">·</span>
            <span className="truncate">{walletLabel}</span>
            {/* Desktop has room for the category the mobile tile
                folds into the title. */}
            {tx.type !== 'transfer' && tx.category && (!mobileV2 || tx.note) && (
              <span className="tx-meta-category">{tx.category}</span>
            )}
          </span>
        </span>

        <span className="tx-trailing">
          <span
            className={cx(
              'tx-amount',
              tx.type === 'income' && 'text-positive',
              tx.type === 'expense' && 'text-negative',
            )}
          >
            {tx.type === 'income' ? '+' : tx.type === 'expense' ? '−' : ''}
            {money(tx.amount)}
          </span>
          <RecordedAt createdAt={tx.createdAt} locale={locale} />
        </span>
      </button>

      <button
        type="button"
        className="tx-remove"
        aria-label={t('activity.deleteEntry', { amount: money(tx.amount) })}
        onClick={() => onDelete(tx)}
      >
        ✕
      </button>
    </li>
  );
});

/** One desktop table row: every column the table always had, after the
 *  select mark. */
const TxRow = memo(function TxRow({
  tx,
  walletLabel,
  toWalletLabel,
  selected,
  money,
  locale,
  onEdit,
  onDelete,
  onSelect,
}: RowProps) {
  const { t } = useTranslation();
  return (
    // Dimmed until the server confirms it.
    <tr className={cx(isOptimistic(tx) && 'is-pending', selected && 'is-selected')}>
      <td className="tx-sel-col">
        <SelectMark tx={tx} name={primaryText(tx, walletLabel, toWalletLabel, t)} selected={selected} onSelect={onSelect} />
      </td>
      <td>
        <Badge tone={tx.type === 'income' ? 'positive' : tx.type === 'expense' ? 'negative' : 'accent'}>{t(TYPE_BADGE[tx.type])}</Badge>
      </td>
      <td
        className={cx(
          tx.type === 'income' && 'text-positive',
          tx.type === 'expense' && 'text-negative',
        )}
      >
        {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
        {money(tx.amount)}
      </td>
      <td>
        {formatDate(tx.date, locale)}
        <RecordedAt createdAt={tx.createdAt} locale={locale} />
      </td>
      <td>
        {tx.type === 'transfer' ? t('activity.transferRoute', { from: walletLabel, to: toWalletLabel }) : tx.category}
      </td>
      <td className="text-muted">{walletLabel}</td>
      <td className="text-muted">{tx.note || '—'}</td>
      <td className="num">
        <div className="row-actions">
          <Button size="sm" variant="ghost" onClick={() => onEdit(tx)}>
            {t('common.edit')}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => onDelete(tx)}>
            ✕
          </Button>
        </div>
      </td>
    </tr>
  );
});

/**
 * What the selected rows add up to. Always in the page, so the polite live
 * region exists before its first announcement; it shows only while
 * something is selected.
 */
function SelectionBar({
  totals,
  money,
  allSelected,
  onSelectAll,
  onClear,
  onMakeFavourite,
}: {
  totals: TxTotals | null;
  money: MoneyFormatter;
  allSelected: boolean;
  onSelectAll: () => void;
  onClear: () => void;
  /** One row selected: save it as a favourite. */
  onMakeFavourite?: () => void;
}) {
  const { t } = useTranslation();
  const announcement = totals
    ? t('activity.selectionAnnounce', {
        count: totals.count,
        income: money(totals.income),
        expense: money(totals.expense),
        net: money(totals.net),
      })
    : '';
  /* Spoken once the clicking stops, not for every row on the way. */
  const [spoken, setSpoken] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setSpoken(announcement), 400);
    return () => window.clearTimeout(timer);
  }, [announcement]);

  return (
    <>
      <p className="sr-only" role="status" aria-live="polite">
        {spoken}
      </p>
      {totals && (
        <section className="tx-selbar" aria-label={t('activity.selectionLabel')}>
          <strong className="tx-selbar-count">{t('activity.selectedCount', { count: totals.count })}</strong>
          <span className="tx-selbar-figures">
            <span className="tx-selbar-fig">
              <span className="tx-selbar-key">{t('activity.selectionIn')}</span>
              <span className="text-positive">+{money(totals.income)}</span>
            </span>
            <span className="tx-selbar-fig">
              <span className="tx-selbar-key">{t('activity.selectionOut')}</span>
              <span className="text-negative">−{money(totals.expense)}</span>
            </span>
            <span className="tx-selbar-fig">
              <span className="tx-selbar-key">{t('activity.selectionNet')}</span>
              <span className={netTone(totals.net)}>{signedNet(totals.net, money)}</span>
            </span>
          </span>
          <span className="tx-selbar-actions">
            {onMakeFavourite && (
              <Button size="sm" variant="ghost" onClick={onMakeFavourite} aria-label={t('favourites.makeFavourite')}>
                <Icon icon={Star} size="sm" />
                <span className="tx-selbar-clear-label">{t('favourites.makeFavourite')}</span>
              </Button>
            )}
            {!allSelected && (
              <Button size="sm" variant="ghost" onClick={onSelectAll}>
                {t('activity.selectAllVisible')}
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={onClear} aria-label={t('activity.selectionClear')}>
              <Icon icon={X} size="sm" />
              <span className="tx-selbar-clear-label">{t('activity.selectionClear')}</span>
            </Button>
          </span>
        </section>
      )}
    </>
  );
}

/** The slim toolbar's ⋯: add, export and refresh, which used to be three
 *  buttons in the header. Its own icon spins while a refresh runs. */
function ActivityMenu({
  canExport,
  refreshing,
  onAdd,
  onExport,
  onRefresh,
}: {
  canExport: boolean;
  refreshing: boolean;
  onAdd: () => void;
  onExport: () => void;
  onRefresh: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [running, setRunning] = useState(false);
  const spinning = refreshing || running;

  const pick = (action: () => void) => {
    setOpen(false);
    action();
  };

  return (
    <>
      <button
        type="button"
        className="tx-slim-more"
        aria-label={t('activity.moreActions')}
        title={t('activity.moreActions')}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(event) => {
          setAnchor(event.currentTarget);
          setOpen((value) => !value);
        }}
      >
        <Icon icon={spinning ? RefreshCw : Ellipsis} size="sm" className={spinning ? 'icon-spin' : undefined} />
      </button>
      <ToolPanel open={open} anchor={anchor} onClose={() => setOpen(false)} label={t('activity.moreActions')}>
        <div className="tool-list">
          <button type="button" className="tool-row" onClick={() => pick(onAdd)}>
            <Icon icon={Plus} size="sm" />
            <span>{t('activity.addTransaction')}</span>
          </button>
          <button
            type="button"
            className="tool-row"
            aria-disabled={!canExport || undefined}
            onClick={() => canExport && pick(onExport)}
          >
            <Icon icon={Download} size="sm" />
            <span>{t('activity.exportCsv')}</span>
          </button>
          <button
            type="button"
            className="tool-row"
            aria-disabled={running || undefined}
            onClick={() =>
              !running &&
              pick(() => {
                setRunning(true);
                void onRefresh().finally(() => setRunning(false));
              })
            }
          >
            <Icon icon={RefreshCw} size="sm" />
            <span>{t('activity.refresh')}</span>
          </button>
        </div>
      </ToolPanel>
    </>
  );
}

/** "YYYY-MM-DD" shifted by whole days, in local time. */
function shiftDay(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00`);
  value.setDate(value.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
}
