import { useState } from 'react';

import { api } from '../api/client';
import { BudgetForm, BudgetPayload } from '../components/BudgetForm';
import { Alert, Badge, Button, Card, EmptyState, ProgressBar, Skeleton } from '../components/ui';
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

  function openNew() {
    setEditing(undefined);
    setFormError(null);
    setFormOpen(true);
  }

  const allocated = Math.min(100, totals?.percentAllocated ?? 0);
  const baseIncome = settings.monthlyIncome || budgets.find((b) => b.base > 0)?.base || 0;
  const spentShare = totals && totals.limit > 0 ? (totals.spent / totals.limit) * 100 : 0;

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="section-label">{formatPeriod(period, settings.locale)}</span>
          <h1 className="page-title">Budgets</h1>
          <p className="page-lede">
            Percentage budgets track a share of your income; fixed budgets track a flat amount.
          </p>
        </div>
        <div className="cluster">
          <Button size="sm" onClick={() => void copyLastMonth()}>
            Copy last month
          </Button>
          <Button size="sm" variant="primary" onClick={openNew}>
            New budget
          </Button>
        </div>
      </div>

      {/* ---- Plan summary ---- */}
      <section className="hero">
        <div className="hero-primary">
          <span className="section-label">Budgeted this month</span>
          <span className="hero-value">{money(totals?.limit ?? 0)}</span>
          <div className="hero-meta">
            <Badge tone={spentShare > 100 ? 'negative' : spentShare > 80 ? 'warning' : 'positive'}>
              {money(totals?.spent ?? 0)} spent
            </Badge>
            <span>
              {totals && totals.limit > 0 ? `${formatPercent(spentShare)} of plan used` : 'Nothing planned yet'}
            </span>
          </div>

          {/* How much of your income is committed, and what's still free. */}
          <div className="allocation">
            <div className="allocation-bar">
              <span className="allocation-fill" style={{ width: `${allocated}%` }} />
            </div>
            <div className="allocation-legend">
              <span>
                <strong>{formatPercent(allocated, 0)}</strong> of income allocated
              </span>
              <span className="text-faint">
                {formatPercent(Math.max(0, 100 - allocated), 0)} unallocated
              </span>
            </div>
          </div>
        </div>

        <div className="hero-metrics">
          <div className="metric metric--accent">
            <span className="section-label">Base income</span>
            <span className="metric-value">{money(baseIncome, { compact: true })}</span>
            <span className="metric-hint">
              {settings.monthlyIncome > 0 ? 'From Settings' : 'From recorded income'}
            </span>
          </div>
          <div className="metric">
            <span className="section-label">Budget lines</span>
            <span className="metric-value">{budgets.length}</span>
            <span className="metric-hint">
              {budgets.filter((b) => b.status === 'over').length} over limit
            </span>
          </div>
          <div className="metric metric--negative">
            <span className="section-label">Remaining</span>
            <span className="metric-value">
              {money(Math.max(0, (totals?.limit ?? 0) - (totals?.spent ?? 0)), { compact: true })}
            </span>
            <span className="metric-hint">Across all budgets</span>
          </div>
        </div>
      </section>

      {notice && (
        <Alert tone="info" onDismiss={() => setNotice(null)}>
          {notice}
        </Alert>
      )}

      <Card padded={initialLoading || Boolean(error) || budgets.length === 0}>
        {initialLoading ? (
          <Skeleton rows={4} />
        ) : error ? (
          <Alert tone="error">{error}</Alert>
        ) : budgets.length === 0 ? (
          <EmptyState
            icon="🎯"
            title="No budgets for this month"
            description="Try a 40 / 10 / 20 split — Invest 40%, Save 10%, Needs 20% — or set flat amounts per category."
            action={
              <Button variant="primary" onClick={openNew}>
                Create a budget
              </Button>
            }
          />
        ) : (
          <div className="list">
            {budgets.map((budget) => (
              <div key={budget.id} className="budget-item">
                <div className="budget-head">
                  <span className="budget-name truncate">
                    {budget.targetLabel || 'All spending'}
                    {budget.mode === 'percent' ? (
                      <Badge tone="accent">{budget.value}% of income</Badge>
                    ) : (
                      <Badge>fixed</Badge>
                    )}
                    {budget.status === 'over' && <Badge tone="negative">over</Badge>}
                  </span>
                  <span className="budget-numbers">
                    {money(budget.spent)} <span className="text-faint">/ {money(budget.limit)}</span>
                  </span>
                </div>

                <ProgressBar
                  percent={budget.percentUsed}
                  tone={budget.status}
                  label={`${budget.targetLabel}: ${formatPercent(budget.percentUsed)} used`}
                />

                <div className="budget-foot">
                  <span className="truncate">
                    {formatPercent(budget.percentUsed)} used
                    {budget.mode === 'percent' && ` · base ${money(budget.base)}`}
                    {budget.note ? ` · ${budget.note}` : ''}
                  </span>
                  <span className="cluster" style={{ flexWrap: 'nowrap' }}>
                    <span className={budget.remaining < 0 ? 'text-negative' : 'text-muted'}>
                      {budget.remaining < 0
                        ? `${money(Math.abs(budget.remaining))} over`
                        : `${money(budget.remaining)} left`}
                    </span>
                    <span className="row-actions">
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
