import { ArrowDownLeft, ArrowLeftRight, ArrowUpRight, Plus, Receipt } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { TransactionForm, TransactionPayload } from '../components/TransactionForm';
import { TransactionFilters } from '../components/TransactionFilters';
import { Icon } from '../components/Icon';
import { ListSkeleton } from '../components/Skeletons';
import { Alert, Badge, Button, Card, EmptyState, RefreshButton } from '../components/ui';
import { isOptimistic, useExcelDB } from '../hooks/useExcelDB';
import { DESKTOP_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { cx, formatDate, formatPeriod } from '../lib/format';
import { EMPTY_FILTERS, TxFilters, fetchScope, filterTransactions } from '../lib/txFilters';
import { RecordedAt } from '../components/RecordedAt';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Transaction, WalletBalance } from '../types';

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

export function TransactionsPage({ period }: { period: string }) {
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

  const visible = useMemo(
    () => filterTransactions(transactions.items, filters),
    [transactions.items, filters],
  );

  const totals = useMemo(() => {
    const income = visible.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = visible.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { income, expense, net: income - expense };
  }, [visible]);

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

  async function remove(tx: Transaction) {
    if (!window.confirm(t('activity.deleteConfirm', { type: tx.type, amount: money(tx.amount) }))) return;
    // Disappears instantly; reappears with a toast if the server refuses.
    await transactions.remove(tx.id).catch(() => undefined);
  }

  return (
    <>
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
            <Button variant="primary" size="sm" onClick={() => { setEditing(undefined); setFormOpen(true); }}>
              <Icon icon={Plus} size="sm" />
              {t('activity.addTransaction')}
            </Button>
            <RefreshButton
              onRefresh={() => Promise.all([transactions.refresh(), wallets.refresh()])}
              busy={transactions.isValidating || wallets.isValidating}
              label={t('activity.refresh')}
            />
          </>
        }
      >
        <TransactionFilters
          filters={filters}
          onChange={patchFilters}
          wallets={wallets.items}
          categories={settings.categories}
          matched={visible.length}
          total={transactions.items.length}
        />
      </Card>

      <Card padded={false}>
        {transactions.mutationError && (
          <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
            <Alert tone="error" onDismiss={transactions.clearMutationError}>
              {transactions.mutationError}
            </Alert>
          </div>
        )}

        {transactions.initialLoading ? (
          <ListSkeleton rows={6} />
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
              <table className="data">
                <thead>
                  <tr>
                    <th>{t('common.type')}</th>
                    <th>{t('common.amount')}</th>
                    <th>{t('common.date')}</th>
                    <th>{t('activity.categoryOrRoute')}</th>
                    <th>{t('common.wallet')}</th>
                    <th>{t('common.note')}</th>
                    <th className="num" />
                  </tr>
                </thead>
                <tbody>
                  {visible.map((tx) => (
                    // Dimmed until the server confirms it.
                    <tr key={tx.id} className={cx(isOptimistic(tx) && 'is-pending')}>
                      <td>
                        <Badge
                          tone={tx.type === 'income' ? 'positive' : tx.type === 'expense' ? 'negative' : 'accent'}
                        >
                          {tx.type}
                        </Badge>
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
                        {formatDate(tx.date, settings.locale)}
                        <RecordedAt createdAt={tx.createdAt} locale={settings.locale} />
                      </td>
                      <td>
                        {tx.type === 'transfer'
                          ? t('activity.transferRoute', {
                              from: walletName(tx.walletId),
                              to: walletName(tx.toWalletId),
                            })
                          : tx.category}
                      </td>
                      <td className="text-muted">{walletName(tx.walletId)}</td>
                      <td className="text-muted">{tx.note || '—'}</td>
                      <td className="num">
                        <div className="row-actions">
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              setEditing(tx);
                              setFormOpen(true);
                            }}
                          >
                            {t('common.edit')}
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => void remove(tx)}>
                            ✕
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
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
          <ul className="tx-list">
            {visible.map((tx) => {
              const primary =
                tx.type === 'transfer'
                  ? t('activity.transferRoute', {
                      from: walletName(tx.walletId),
                      to: walletName(tx.toWalletId),
                    })
                  : tx.note || tx.category || t('activity.untitledEntry');

              return (
                <li key={tx.id} className={cx('tx-tile', isOptimistic(tx) && 'is-pending')}>
                  <button
                    type="button"
                    className="tx-tile-main"
                    onClick={() => {
                      setEditing(tx);
                      setFormOpen(true);
                    }}
                  >
                    {/* Direction, not a category glyph: the app has no icon per
                        category, and inventing one would be decoration. This
                        carries the same meaning as the old type badge in a
                        quarter of the width. */}
                    <span className={cx('tx-mark', `is-${tx.type}`)} aria-hidden="true">
                      <Icon
                        icon={
                          tx.type === 'income'
                            ? ArrowDownLeft
                            : tx.type === 'expense'
                              ? ArrowUpRight
                              : ArrowLeftRight
                        }
                        size="sm"
                      />
                    </span>

                    <span className="tx-body">
                      <span className="tx-title">{primary}</span>
                      <span className="tx-meta">
                        <span>{formatDate(tx.date, settings.locale)}</span>
                        <span className="tx-meta-sep" aria-hidden="true">·</span>
                        <span className="truncate">{walletName(tx.walletId)}</span>
                        {/* Desktop has room for the category the mobile tile
                            folds into the title. */}
                        {tx.type !== 'transfer' && tx.category && (
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
                      <RecordedAt createdAt={tx.createdAt} locale={settings.locale} />
                    </span>
                  </button>

                  <button
                    type="button"
                    className="tx-remove"
                    aria-label={t('activity.deleteEntry', { amount: money(tx.amount) })}
                    onClick={() => void remove(tx)}
                  >
                    ✕
                  </button>
                </li>
              );
            })}
          </ul>
          )
        )}
      </Card>

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
    </>
  );
}
