import { useState } from 'react';

import { invalidate, mutateMatching } from '../api/cache';
import { api } from '../api/client';
import { BudgetForm, BudgetPayload } from '../components/BudgetForm';
import { ListSkeleton } from '../components/Skeletons';
import { Alert, Badge, Button, Card, EmptyState, ProgressBar } from '../components/ui';
import { isOptimistic, useExcelDB, useExcelQuery } from '../hooks/useExcelDB';
import { formatPercent, formatPeriod, shiftPeriod } from '../lib/format';
import { toast } from '../lib/toast';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { BudgetProgress, BudgetResponse, WalletBalance } from '../types';

export function BudgetsPage({ period }: { period: string }) {
  const { settings } = useSettings();
  const wallets = useExcelDB<WalletBalance>('wallets');
  const { data, initialLoading, error, refresh } = useExcelQuery<BudgetResponse>('/api/budgets', { period });

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<BudgetProgress | undefined>();
  // No `busy` flag any more: the form closes on submit rather than waiting for
  // the network, so there is no in-flight state for it to render.
  const [formError, setFormError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const money = useMoneyFormatter();
  const budgets = data?.budgets ?? [];
  const totals = data?.totals;

  /**
   * `/api/budgets` returns a shaped object rather than a plain array, so these
   * patch the cached response directly instead of going through useExcelDB.
   * Same contract: apply locally, send, reconcile or roll back + toast.
   */
  function runOptimistic(apply: (current: BudgetResponse) => BudgetResponse, send: () => Promise<unknown>) {
    const rollback = mutateMatching<BudgetResponse>('/api/budgets', (current) => apply(current));

    return send()
      .then(() => {
        // Limits and spend are server-derived; pull the authoritative copy.
        invalidate(['/api/budgets', '/api/dashboard']);
      })
      .catch((err: unknown) => {
        rollback();
        toast.error(err instanceof Error ? err.message : 'Could not save the budget');
        throw err;
      });
  }

  function recalc(budget: BudgetProgress): BudgetProgress {
    const limit = budget.mode === 'percent' ? (budget.base * budget.value) / 100 : budget.value;
    const percentUsed = limit > 0 ? (budget.spent / limit) * 100 : 0;
    return {
      ...budget,
      limit,
      remaining: limit - budget.spent,
      percentUsed,
      status: percentUsed >= 100 ? 'over' : percentUsed >= 80 ? 'warning' : 'ok',
    };
  }

  function save(payload: BudgetPayload) {
    const editingId = editing?.id;
    setFormError(null);
    setFormOpen(false);
    setEditing(undefined);

    const label =
      payload.scope === 'wallet'
        ? (wallets.items.find((w) => w.id === payload.targetId)?.name ?? payload.targetId)
        : payload.scope === 'global'
          ? 'All spending'
          : payload.targetId;

    const pending = runOptimistic(
      (current) => {
        if (!current) return current;

        if (editingId) {
          return {
            ...current,
            budgets: current.budgets.map((b) =>
              b.id === editingId
                ? // `spent` is unaffected by editing a limit, so the recomputed
                  // progress here is exactly what the server will return.
                  recalc({ ...b, ...payload, targetLabel: label })
                : b,
            ),
          };
        }

        const base = payload.baseIncome || settings.monthlyIncome || baseIncome;
        const limit = payload.mode === 'percent' ? (base * payload.value) / 100 : payload.value;

        return {
          ...current,
          budgets: [
            ...current.budgets,
            {
              ...payload,
              id: `optimistic:${Date.now()}`,
              userId: '',
              targetLabel: label,
              createdAt: new Date().toISOString(),
              base,
              limit,
              // Unknown until the server tallies the period — the row renders a
              // placeholder for these rather than a wrong number.
              spent: 0,
              remaining: limit,
              percentUsed: 0,
              status: 'ok',
            } as BudgetProgress,
          ],
          totals: {
            ...current.totals,
            limit: current.totals.limit + limit,
            percentAllocated:
              current.totals.percentAllocated + (payload.mode === 'percent' ? payload.value : 0),
          },
        };
      },
      () =>
        editingId ? api.patch(`/api/budgets/${editingId}`, payload) : api.post('/api/budgets', payload),
    );

    pending.catch(() => undefined);
    return Promise.resolve();
  }

  async function remove(budget: BudgetProgress) {
    if (!window.confirm(`Delete the "${budget.targetLabel}" budget?`)) return;
    await runOptimistic(
      (current) =>
        current
          ? {
              ...current,
              budgets: current.budgets.filter((b) => b.id !== budget.id),
              totals: {
                ...current.totals,
                limit: current.totals.limit - budget.limit,
                spent: current.totals.spent - budget.spent,
                percentAllocated:
                  current.totals.percentAllocated - (budget.mode === 'percent' ? budget.value : 0),
              },
            }
          : current,
      () => api.delete(`/api/budgets/${budget.id}`),
    ).catch(() => undefined);
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
          <ListSkeleton rows={4} />
        ) : error && !budgets.length ? (
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
            {budgets.map((budget) => {
              // Spend for a brand-new budget isn't known until the server tallies
              // the period, so show a placeholder rather than a misleading 0.
              const unconfirmed = isOptimistic(budget);
              return (
              <div key={budget.id} className={unconfirmed ? 'budget-item is-pending' : 'budget-item'}>
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
                    {unconfirmed ? <span className="text-faint">—</span> : money(budget.spent)}{' '}
                    <span className="text-faint">/ {money(budget.limit)}</span>
                  </span>
                </div>

                <ProgressBar
                  percent={unconfirmed ? 0 : budget.percentUsed}
                  tone={budget.status}
                  label={`${budget.targetLabel}: ${formatPercent(budget.percentUsed)} used`}
                />

                <div className="budget-foot">
                  <span className="truncate">
                    {unconfirmed ? 'Saving…' : `${formatPercent(budget.percentUsed)} used`}
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
              );
            })}
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
