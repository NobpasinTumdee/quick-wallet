import { useMemo, useState } from 'react';

import { TransactionForm, TransactionPayload } from '../components/TransactionForm';
import { Alert, Badge, Button, Card, EmptyState, Input, Select, Skeleton } from '../components/ui';
import { useExcelDB } from '../hooks/useExcelDB';
import { cx, formatDate, formatPeriod } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Transaction, TransactionType, WalletBalance } from '../types';

export function TransactionsPage({ period }: { period: string }) {
  const { settings } = useSettings();
  const [walletFilter, setWalletFilter] = useState('');
  const [typeFilter, setTypeFilter] = useState<'' | TransactionType>('');
  const [search, setSearch] = useState('');

  const wallets = useExcelDB<WalletBalance>('wallets', { includeArchived: true });
  const transactions = useExcelDB<Transaction>('transactions', {
    period,
    walletId: walletFilter || undefined,
    type: typeFilter || undefined,
    search: search.trim() || undefined,
  });

  const [editing, setEditing] = useState<Transaction | undefined>();
  const [formOpen, setFormOpen] = useState(false);

  const money = useMoneyFormatter();
  const walletName = (id: string) => wallets.items.find((w) => w.id === id)?.name ?? '—';

  const totals = useMemo(() => {
    const income = transactions.items.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0);
    const expense = transactions.items.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    return { income, expense, net: income - expense };
  }, [transactions.items]);

  async function save(payload: TransactionPayload) {
    if (editing) await transactions.update(editing.id, payload);
    else await transactions.create(payload);
    setFormOpen(false);
    setEditing(undefined);
  }

  async function remove(tx: Transaction) {
    if (!window.confirm(`Delete this ${tx.type} of ${money(tx.amount)}?`)) return;
    await transactions.remove(tx.id);
  }

  return (
    <>
      <Card
        title={`Activity · ${formatPeriod(period, settings.locale)}`}
        subtitle={`${money(totals.income)} in · ${money(totals.expense)} out · net ${money(totals.net)}`}
        actions={
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setEditing(undefined);
              setFormOpen(true);
            }}
            disabled={wallets.items.length === 0}
          >
            + New transaction
          </Button>
        }
      >
        <div className="toolbar">
          <Select value={walletFilter} onChange={(e) => setWalletFilter(e.target.value)} style={{ width: 'auto' }}>
            <option value="">All wallets</option>
            {wallets.items.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.icon} {wallet.name}
              </option>
            ))}
          </Select>
          <Select
            value={typeFilter}
            onChange={(e) => setTypeFilter(e.target.value as '' | TransactionType)}
            style={{ width: 'auto' }}
          >
            <option value="">All types</option>
            <option value="expense">Expense</option>
            <option value="income">Income</option>
            <option value="transfer">Transfer</option>
          </Select>
          <Input
            placeholder="Search note or category…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            style={{ maxWidth: 260 }}
          />
        </div>
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
          <div className="card-body">
            <Skeleton rows={6} />
          </div>
        ) : transactions.error ? (
          <div className="card-body">
            <Alert tone="error">{transactions.error}</Alert>
          </div>
        ) : transactions.items.length === 0 ? (
          <EmptyState
            icon="🧾"
            title="Nothing recorded here"
            description={
              wallets.items.length === 0
                ? 'Create a wallet first, then start adding transactions.'
                : 'No transactions match this month and these filters.'
            }
            action={
              wallets.items.length > 0 ? (
                <Button variant="primary" onClick={() => setFormOpen(true)}>
                  Add a transaction
                </Button>
              ) : undefined
            }
          />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Category / Route</th>
                  <th>Wallet</th>
                  <th>Note</th>
                  <th className="num">Amount</th>
                  <th className="num" />
                </tr>
              </thead>
              <tbody>
                {transactions.items.map((tx) => (
                  <tr key={tx.id}>
                    <td>{formatDate(tx.date, settings.locale)}</td>
                    <td>
                      <Badge
                        tone={tx.type === 'income' ? 'positive' : tx.type === 'expense' ? 'negative' : 'accent'}
                      >
                        {tx.type}
                      </Badge>
                    </td>
                    <td>
                      {tx.type === 'transfer'
                        ? `${walletName(tx.walletId)} → ${walletName(tx.toWalletId)}`
                        : tx.category}
                    </td>
                    <td className="text-muted">{walletName(tx.walletId)}</td>
                    <td className="text-muted">{tx.note || '—'}</td>
                    <td
                      className={cx(
                        'num',
                        tx.type === 'income' && 'text-positive',
                        tx.type === 'expense' && 'text-negative',
                      )}
                    >
                      {tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : ''}
                      {money(tx.amount)}
                    </td>
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
                          Edit
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
