import { Wallet } from 'lucide-react';
import { useState } from 'react';

import { WalletForm, WalletPayload } from '../components/WalletForm';
import { Icon } from '../components/Icon';
import { WalletGridSkeleton } from '../components/Skeletons';
import { Alert, Badge, Button, Card, EmptyState, RefreshButton } from '../components/ui';
import { isOptimistic, useExcelDB } from '../hooks/useExcelDB';
import { cx } from '../lib/format';
import { useMoneyFormatter } from '../state/SettingsContext';
import { WalletBalance } from '../types';

export function WalletsPage() {
  const money = useMoneyFormatter();
  const [showArchived, setShowArchived] = useState(false);

  const wallets = useExcelDB<WalletBalance>('wallets', { includeArchived: true });
  const [editing, setEditing] = useState<WalletBalance | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const visible = wallets.items.filter((w) => showArchived || !w.archived);

  /** Closes immediately — the card is already in the list. See TransactionsPage. */
  function save(payload: WalletPayload) {
    const pending = editing ? wallets.update(editing.id, payload) : wallets.create(payload);
    setFormOpen(false);
    setEditing(undefined);
    pending.catch(() => undefined);
    return Promise.resolve();
  }

  async function remove(wallet: WalletBalance) {
    setNotice(null);
    try {
      await wallets.remove(wallet.id);
      setNotice(`Deleted "${wallet.name}".`);
    } catch (err) {
      // The backend blocks deleting a wallet with records — offer the cascade.
      const message = err instanceof Error ? err.message : 'Delete failed';
      const confirmed = window.confirm(
        `${message}\n\nDelete "${wallet.name}" AND all of its records permanently?`,
      );
      if (!confirmed) return;
      await wallets.remove(wallet.id, { cascade: true });
      setNotice(`Deleted "${wallet.name}" and its records.`);
    }
  }

  // Presentational split only — one fetch, two groups.
  const spending = visible.filter((w) => w.mode === 'expense');
  const investing = visible.filter((w) => w.mode === 'investment');

  const spendingTotal = spending.reduce((sum, w) => sum + w.balance, 0);
  const investingTotal = investing.reduce((sum, w) => sum + w.balance + w.investedCost, 0);

  function openNew() {
    setEditing(undefined);
    wallets.clearMutationError();
    setFormOpen(true);
  }

  /** One wallet, as a card in the mode's grid. */
  const walletCard = (wallet: WalletBalance) => (
    <article
      key={wallet.id}
      className={cx('wallet-card', wallet.archived && 'is-archived', isOptimistic(wallet) && 'is-pending')}
    >
      <header className="wallet-card-head">
        <span className="avatar" style={{ background: `${wallet.color}1f`, color: wallet.color }}>
          {wallet.icon || '💳'}
        </span>
        <div className="stack stack--tight" style={{ gap: 2 }}>
          <span className="wallet-card-name truncate">{wallet.name}</span>
          <span className="list-item-sub">
            {wallet.type === 'CREDIT' ? 'credit card' : wallet.kind} · {wallet.currency}
          </span>
        </div>
        {wallet.archived && <Badge>Archived</Badge>}
      </header>

      <div className="wallet-card-figures">
        <div className="metric">
          {/* A card's balance is stored negative like every other debt, but
              "Balance -฿5,000" is not how anyone thinks about a card. Flipped
              here for reading only — nothing downstream sees the change. */}
          <span className="section-label">
            {wallet.type === 'CREDIT' ? 'Owed' : wallet.mode === 'investment' ? 'Cash' : 'Balance'}
          </span>
          <span className={cx('metric-value', wallet.balance < 0 && 'text-negative')}>
            {money(wallet.type === 'CREDIT' ? Math.max(0, -wallet.balance) : wallet.balance)}
          </span>
        </div>
        {wallet.mode === 'investment' ? (
          <div className="metric metric--accent">
            <span className="section-label">Invested</span>
            <span className="metric-value">{money(wallet.investedCost)}</span>
          </div>
        ) : (
          <div className="metric">
            <span className="section-label">Activity</span>
            <span className="metric-value">{wallet.transactionCount}</span>
          </div>
        )}
      </div>

      {wallet.note && <p className="wallet-card-note truncate">{wallet.note}</p>}

      <footer className="wallet-card-foot">
        <span className="section-label">Opened {money(wallet.openingBalance, { compact: true })}</span>
        <div className="row-actions">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setEditing(wallet);
              wallets.clearMutationError();
              setFormOpen(true);
            }}
          >
            Edit
          </Button>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => void wallets.update(wallet.id, { archived: !wallet.archived })}
          >
            {wallet.archived ? 'Restore' : 'Archive'}
          </Button>
          <Button size="sm" variant="ghost" onClick={() => void remove(wallet)}>
            Delete
          </Button>
        </div>
      </footer>
    </article>
  );

  const group = (
    key: string,
    label: string,
    caption: string,
    total: number,
    items: WalletBalance[],
    emptyText: string,
  ) => (
    <section key={key} className="wallet-group">
      <header className="wallet-group-head">
        <div className="stack" style={{ gap: 2 }}>
          <h2 className="wallet-group-title">{label}</h2>
          <span className="list-item-sub">{caption}</span>
        </div>
        <div className="wallet-group-total">
          <span className="section-label">Total</span>
          <span className="metric-value">{money(total, { compact: true })}</span>
        </div>
      </header>

      {items.length === 0 ? (
        <div className="wallet-group-empty">
          <p className="text-muted">{emptyText}</p>
          <Button size="sm" onClick={openNew}>
            Add one
          </Button>
        </div>
      ) : (
        <div className="wallet-grid">{items.map(walletCard)}</div>
      )}
    </section>
  );

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="section-label">Accounts</span>
          <h1 className="page-title">Wallets</h1>
          <p className="page-lede">
            Spending wallets track day-to-day money. Investment wallets hold positions and are funded by
            a transfer.
          </p>
        </div>
        <div className="cluster">
          <RefreshButton
            onRefresh={wallets.refresh}
            busy={wallets.isValidating}
            label="Refresh wallets"
          />
          <Button size="sm" onClick={() => setShowArchived((v) => !v)}>
            {showArchived ? 'Hide archived' : 'Show archived'}
          </Button>
          <Button size="sm" variant="primary" onClick={openNew}>
            New wallet
          </Button>
        </div>
      </div>

      {wallets.mutationError && (
        <Alert tone="error" onDismiss={wallets.clearMutationError}>
          {wallets.mutationError}
        </Alert>
      )}
      {notice && (
        <Alert tone="success" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      {wallets.initialLoading ? (
        <WalletGridSkeleton cards={3} />
      ) : wallets.error && !wallets.items.length ? (
        <Card>
          <Alert tone="error">{wallets.error}</Alert>
        </Card>
      ) : visible.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon icon={Wallet} size="xl" />}
            title="No wallets yet"
            description="Create a cash or bank wallet to record spending, or an investment wallet to track stocks."
            action={
              <Button variant="primary" onClick={openNew}>
                Create a wallet
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {group(
            'expense',
            'Spending',
            'Income, expenses and transfers',
            spendingTotal,
            spending,
            'No spending wallets yet.',
          )}
          {group(
            'investment',
            'Investing',
            'Stock positions valued at cost',
            investingTotal,
            investing,
            'No investment wallets yet — add one to start tracking positions.',
          )}
        </>
      )}

      <WalletForm
        open={formOpen}
        wallet={editing}
        busy={wallets.mutating}
        error={wallets.mutationError}
        onClose={() => {
          setFormOpen(false);
          setEditing(undefined);
          wallets.clearMutationError();
        }}
        onSubmit={save}
      />
    </>
  );
}
