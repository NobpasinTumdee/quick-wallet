import { Target } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { invalidate, mutateMatching } from '../api/cache';
import { Icon } from '../components/Icon';
import { api } from '../api/client';
import { BudgetForm, BudgetPayload } from '../components/BudgetForm';
import { ListSkeleton } from '../components/Skeletons';
import { Alert, Badge, Button, Card, EmptyState, ProgressBar, RefreshButton } from '../components/ui';
import { isOptimistic, useExcelDB, useExcelQuery } from '../hooks/useExcelDB';
import { formatPercent, formatPeriod, shiftPeriod } from '../lib/format';
import { toast } from '../lib/toast';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { BudgetProgress, BudgetResponse, WalletBalance } from '../types';

export function BudgetsPage({ period }: { period: string }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const wallets = useExcelDB<WalletBalance>('wallets');
  const { data, initialLoading, isValidating, error, refresh } = useExcelQuery<BudgetResponse>('/api/budgets', {
    period,
  });

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
        toast.error(err instanceof Error ? err.message : t('budgets.saveFailed'));
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
          ? t('dashboard.allSpending')
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
    if (!window.confirm(t('budgets.deleteConfirm', { label: budget.targetLabel }))) return;
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
      setNotice(
        t('budgets.copied', {
          count: result.copied,
          skipped: result.skipped ? t('budgets.copiedSkipped', { count: result.skipped }) : '',
        }),
      );
    } catch (err) {
      setNotice(err instanceof Error ? err.message : t('budgets.copyFailed'));
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
          <h1 className="page-title">{t('budgets.title')}</h1>
          <p className="page-lede">
            {t('budgets.lede')}
          </p>
        </div>
        <div className="cluster">
          {/* Limits come from Budgets but the wallet-scope targets come from
              Wallets, so a manual refresh pulls both. */}
          <RefreshButton
            onRefresh={() => Promise.all([refresh(), wallets.refresh()])}
            busy={isValidating || wallets.isValidating}
            label={t('budgets.refresh')}
          />
          <Button size="sm" onClick={() => void copyLastMonth()}>
            {t('budgets.copyPrevious')}
          </Button>
          <Button size="sm" variant="primary" onClick={openNew}>
            {t('budgets.newBudget')}
          </Button>
        </div>
      </div>

      {/* ---- Plan summary ---- */}
      <section className="hero">
        <div className="hero-primary">
          <span className="section-label">{t('budgets.budgetedThisMonth')}</span>
          <span className="hero-value">{money(totals?.limit ?? 0)}</span>
          <div className="hero-meta">
            <Badge tone={spentShare > 100 ? 'negative' : spentShare > 80 ? 'warning' : 'positive'}>
              {t('budgets.spentBadge', { amount: money(totals?.spent ?? 0) })}
            </Badge>
            <span>
              {totals && totals.limit > 0
                ? t('budgets.planUsed', { percent: formatPercent(spentShare) })
                : t('budgets.nothingPlanned')}
            </span>
          </div>

          {/* How much of your income is committed, and what's still free. */}
          <div className="allocation">
            <div className="allocation-bar">
              <span className="allocation-fill" style={{ width: `${allocated}%` }} />
            </div>
            <div className="allocation-legend">
              <span>
                <strong>{formatPercent(allocated, 0)}</strong> {t('budgets.ofIncomeAllocated')}
              </span>
              <span className="text-faint">
                {t('budgets.unallocatedShare', { percent: formatPercent(Math.max(0, 100 - allocated), 0) })}
              </span>
            </div>
          </div>
        </div>

        <div className="hero-metrics">
          <div className="metric metric--accent">
            <span className="section-label">{t('budgets.baseIncome')}</span>
            <span className="metric-value">{money(baseIncome, { compact: true })}</span>
            <span className="metric-hint">
              {t(settings.monthlyIncome > 0 ? 'budgets.fromSettings' : 'budgets.fromRecordedIncome')}
            </span>
          </div>
          <div className="metric">
            <span className="section-label">{t('budgets.budgetLines')}</span>
            <span className="metric-value">{budgets.length}</span>
            <span className="metric-hint">
              {t('budgets.overLimitCount', { count: budgets.filter((b) => b.status === 'over').length })}
            </span>
          </div>
          <div className="metric metric--negative">
            <span className="section-label">{t('budgets.remaining')}</span>
            <span className="metric-value">
              {money(Math.max(0, (totals?.limit ?? 0) - (totals?.spent ?? 0)), { compact: true })}
            </span>
            <span className="metric-hint">{t('budgets.acrossAll')}</span>
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
            icon={<Icon icon={Target} size="xl" />}
            title={t('budgets.emptyThisMonth')}
            description={t('budgets.emptyBodyFull')}
            action={
              <Button variant="primary" onClick={openNew}>
                {t('budgets.createBudget')}
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
                    {budget.targetLabel || t('dashboard.allSpending')}
                    {budget.mode === 'percent' ? (
                      <Badge tone="accent">{t('budgets.percentOfIncome', { percent: budget.value })}</Badge>
                    ) : (
                      <Badge>{t('budgets.fixedBadge')}</Badge>
                    )}
                    {budget.status === 'over' && <Badge tone="negative">{t('budgets.overBadge')}</Badge>}
                  </span>
                  <span className="budget-numbers">
                    {unconfirmed ? <span className="text-faint">—</span> : money(budget.spent)}{' '}
                    <span className="text-faint">/ {money(budget.limit)}</span>
                  </span>
                </div>

                <ProgressBar
                  percent={unconfirmed ? 0 : budget.percentUsed}
                  tone={budget.status}
                  label={t('dashboard.budgetUsed', { label: budget.targetLabel, percent: formatPercent(budget.percentUsed) })}
                />

                <div className="budget-foot">
                  <span className="truncate">
                    {unconfirmed
                      ? t('budgets.savingEllipsis')
                      : t('budgets.percentUsed', { percent: formatPercent(budget.percentUsed) })}
                    {budget.mode === 'percent' && t('budgets.baseSuffix', { amount: money(budget.base) })}
                    {budget.note ? t('budgets.noteSuffix', { note: budget.note }) : ''}
                  </span>
                  <span className="cluster" style={{ flexWrap: 'nowrap' }}>
                    <span className={budget.remaining < 0 ? 'text-negative' : 'text-muted'}>
                      {budget.remaining < 0
                        ? t('budgets.amountOver', { amount: money(Math.abs(budget.remaining)) })
                        : t('budgets.amountLeft', { amount: money(budget.remaining) })}
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
                        {t('common.edit')}
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
