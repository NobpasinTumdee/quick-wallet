import { useState } from 'react';

import { api } from '../api/client';
import { BudgetForm, BudgetPayload } from '../components/BudgetForm';
import { Alert, Badge, Button, Card, EmptyState, ProgressBar, Skeleton, StatCard } from '../components/ui';
import { useExcelDB, useExcelQuery } from '../hooks/useExcelDB';
import { formatPercent, formatPeriod, shiftPeriod } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { BudgetProgress, BudgetResponse, WalletBalance } from '../types';

export function BudgetsPage({ period }: { period: string }) {
  const { settings } = useSettings();
  const wallets = useExcelDB<WalletBalance>('wallets');
  const { data, initialLoading, error, refresh } = useExcelQuery<BudgetResponse>('/api/budgets', { period });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetProgress | undefined>();
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const money = useMoneyFormatter();
  const budgets = data?.budgets ?? [];
  const totals = data?.totals;

  async function save(payload: BudgetPayload) {
    setBusy(true);
    setFormError(null);
    try {
      if (editing) await api.patch(`/api/budgets/${editing.id}`, payload);
      else await api.post('/api/budgets', payload);
      await refresh();
      setFormOpen(false);
      setEditing(undefined);
    } catch (err) {
      setFormError(err instanceof Error ? err.message : 'Could not save the budget');
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function remove(budget: BudgetProgress) {
    if (!window.confirm(`Delete the "${budget.targetLabel}" budget?`)) return;
    await api.delete(`/api/budgets/${budget.id}`);
    await refresh();
  }

  async function copyLastMonth() {
    setNotice(null);
    try {
      const result = await api.post<{ copied: number; skipped: number }>('/api/budgets/copy', {
        from: shiftPeriod(period, -1),
        to: period,
      });
      await refresh();
      setNotice(`Copied ${result.copied} budget(s)${result.skipped ? `, skipped ${result.skipped} already set` : ''}.`);
    } catch (err) {
      setNotice(err instanceof Error ? err.message : 'Copy failed');
    }
  }

  return (
    <>
      <div className="grid grid--stats">
        <StatCard label="Total budgeted" icon="🎯" value={money(totals?.limit ?? 0)} hint={formatPeriod(period, settings.locale)} />
        <StatCard
          label="Spent against budgets"
          tone={(totals?.spent ?? 0) > (totals?.limit ?? 0) ? 'negative' : 'neutral'}
          icon="💸"
          value={money(totals?.spent ?? 0)}
          hint={totals && totals.limit > 0 ? `${formatPercent((totals.spent / totals.limit) * 100)} of plan` : '—'}
        />
        <StatCard
          label="Income allocated"
          tone="accent"
          icon="📐"
          value={formatPercent(totals?.percentAllocated ?? 0, 0)}
          hint={`${formatPercent(totals?.percentUnallocated ?? 100, 0)} unallocated`}
        />
        <StatCard
          label="Base income"
          icon="🏦"
          value={money(settings.monthlyIncome || budgets[0]?.base || 0)}
          hint={settings.monthlyIncome > 0 ? 'From Settings' : 'Derived from recorded income'}
        />
      </div>

      {notice && (
        <Alert tone="info" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Card
        title={`Budgets · ${formatPeriod(period, settings.locale)}`}
        subtitle="Percent budgets track a share of your income; fixed budgets track a flat amount."
        actions={
          <>
            <Button size="sm" onClick={() => void copyLastMonth()}>
              Copy last month
            </Button>
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setEditing(undefined);
                setFormError(null);
                setFormOpen(true);
              }}
            >
              + New budget
            </Button>
          </>
        }
        padded={false}
      >
        {initialLoading ? (
          <div className="card-body">
            <Skeleton rows={4} />
          </div>
        ) : error ? (
          <div className="card-body">
            <Alert tone="error">{error}</Alert>
          </div>
        ) : budgets.length === 0 ? (
          <EmptyState
            icon="🎯"
            title="No budgets for this month"
            description="Try a 40 / 10 / 20 split — Invest 40%, Save 10%, Needs 20% — or set flat amounts per category."
            action={
              <Button variant="primary" onClick={() => setFormOpen(true)}>
                Create a budget
              </Button>
            }
          />
        ) : (
          <div className="list">
            {budgets.map((budget) => (
              <div key={budget.id} className="budget-item">
                <div className="budget-head">
                  <span className="budget-name">
                    {budget.targetLabel || 'All spending'}
                    {budget.mode === 'percent' ? (
                      <Badge tone="accent">{budget.value}% of income</Badge>
                    ) : (
                      <Badge>fixed</Badge>
                    )}
                    {budget.status === 'over' && <Badge tone="negative">over</Badge>}
                  </span>
                  <span className="budget-numbers">
                    {money(budget.spent)} / {money(budget.limit)}
                  </span>
                </div>

                <ProgressBar
                  percent={budget.percentUsed}
                  tone={budget.status}
                  label={`${budget.targetLabel}: ${formatPercent(budget.percentUsed)} used`}
                />

                <div className="budget-foot">
                  <span>
                    {formatPercent(budget.percentUsed)} used
                    {budget.mode === 'percent' && ` · base ${money(budget.base)}`}
                    {budget.note ? ` · ${budget.note}` : ''}
                  </span>
                  <span className="row-actions">
                    <span className={budget.remaining < 0 ? 'text-negative' : 'text-muted'}>
                      {budget.remaining < 0
                        ? `${money(Math.abs(budget.remaining))} over`
                        : `${money(budget.remaining)} left`}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(budget);
                        setFormError(null);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => void remove(budget)}>
                      ✕
                    </Button>
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <BudgetForm
        open={formOpen}
        period={period}
        budget={editing}
        wallets={wallets.items}
        percentAllocated={totals?.percentAllocated ?? 0}
        derivedBase={budgets.find((b) => b.base > 0)?.base ?? 0}
        busy={busy}
        error={formError}
        onClose={() => {
          setFormOpen(false);
          setEditing(undefined);
          setFormError(null);
        }}
        onSubmit={save}
      />
    </>
  );
}
