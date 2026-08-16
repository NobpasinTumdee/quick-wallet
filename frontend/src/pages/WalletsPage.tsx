import { useState } from 'react';

import { WalletForm, WalletPayload } from '../components/WalletForm';
import { Alert, Badge, Button, Card, EmptyState, Skeleton } from '../components/ui';
import { useExcelDB } from '../hooks/useExcelDB';
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

  async function save(payload: WalletPayload) {
    if (editing) await wallets.update(editing.id, payload);
    else await wallets.create(payload);
    setFormOpen(false);
    setEditing(undefined);
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

  return (
    <>
      <Card
        title="Wallets"
        subtitle="Expense wallets track day-to-day money. Investment wallets hold stock positions."
        actions={
          <>
            <Button size="sm" onClick={() => setShowArchived((v) => !v)}>
              {showArchived ? 'Hide archived' : 'Show archived'}
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
              + New wallet
            </Button>
          </>
        }
        padded={false}
      >
        {wallets.mutationError && (
          <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
            <Alert tone="error" onDismiss={wallets.clearMutationError}>
              {wallets.mutationError}
            </Alert>
          </div>
        )}
        {notice && (
          <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
            <Alert tone="success" onDismiss={() => setNotice(null)}>
              {notice}
            </Alert>
          </div>
        )}

        {wallets.initialLoading ? (
          <div className="card-body">
            <Skeleton rows={4} />
          </div>
        ) : wallets.error ? (
          <div className="card-body">
            <Alert tone="error">{wallets.error}</Alert>
          </div>
        ) : visible.length === 0 ? (
          <EmptyState
            icon="👛"
            title="No wallets yet"
            description="Create a cash or bank wallet to record spending, or an investment wallet to track stocks."
            action={
              <Button variant="primary" onClick={() => setFormOpen(true)}>
                Create a wallet
              </Button>
            }
          />
        ) : (
          <div className="list">
            {visible.map((wallet) => (
              <div key={wallet.id} className="list-item">
                <span className="avatar" style={{ background: `${wallet.color}22`, color: wallet.color }}>
                  {wallet.icon || '💳'}
                </span>
                <div className="list-item-main">
                  <div className="list-item-title">
                    {wallet.name}{' '}
                    {wallet.mode === 'investment' && <Badge tone="accent">Investment</Badge>}
                    {wallet.archived && <Badge>Archived</Badge>}
                  </div>
                  <div className="list-item-sub">
                    {wallet.kind} · {wallet.currency} · opened with {money(wallet.openingBalance)}
                    {wallet.mode === 'investment' && ` · ${money(wallet.investedCost)} invested`}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div className={cx('list-item-amount', wallet.balance < 0 && 'text-negative')}>
                    {money(wallet.balance)}
                  </div>
                  <div className="row-actions" style={{ marginTop: 4 }}>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(wallet);
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
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

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
