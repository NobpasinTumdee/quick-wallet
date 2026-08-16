import { Badge, Card, EmptyState, ProgressBar, Skeleton, StatCard, Alert, Button } from '../components/ui';
import { useExcelQuery } from '../hooks/useExcelDB';
import { useStockQuotes } from '../hooks/useStockQuotes';
import { formatPercent, formatPeriod, formatDate, cx } from '../lib/format';
import { Route } from '../lib/router';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { DashboardSummary, Investment } from '../types';

export function DashboardPage({ period, onNavigate }: { period: string; onNavigate: (route: Route) => void }) {
  const { settings } = useSettings();
  const { locale } = settings;
  const format = useMoneyFormatter();

  const { data, initialLoading, error, refresh } = useExcelQuery<DashboardSummary>('/api/dashboard', {
    period,
  });
  const positions = (data?.openPositions ?? []) as Investment[];
  const portfolio = useStockQuotes(positions);

  const money = (value: number, compact = false) => format(value, { compact });

  if (initialLoading) {
    return (
      <Card title="Loading your overview">
        <Skeleton rows={6} />
      </Card>
    );
  }

  if (error || !data) {
    return (
      <Card title="Couldn't load the dashboard">
        <Alert tone="error">{error ?? 'No data returned'}</Alert>
        <div style={{ marginTop: 12 }}>
          <Button onClick={() => void refresh()}>Try again</Button>
        </div>
      </Card>
    );
  }

  const hasPositions = positions.length > 0;
  // Swap cost basis for live market value so net worth reflects today's prices.
  const netWorthLive = hasPositions
    ? data.netWorth - portfolio.totalCost + portfolio.totalValue
    : data.netWorth;

  const maxTrend = Math.max(1, ...data.trend.map((t) => Math.max(t.income, t.expense)));
  const isEmpty = data.walletCount === 0;

  if (isEmpty) {
    return (
      <Card>
        <EmptyState
          icon="👛"
          title="Create your first wallet"
          description="Wallets are where transactions and positions live. Add one, then start recording activity."
          action={
            <Button variant="primary" onClick={() => onNavigate('wallets')}>
              Go to wallets
            </Button>
          }
        />
      </Card>
    );
  }

  return (
    <>
      <div className="grid grid--stats">
        <StatCard
          label="Net worth"
          tone="accent"
          icon="💎"
          value={money(netWorthLive, true)}
          hint={
            hasPositions
              ? `${money(portfolio.totalValue, true)} in positions · ${portfolio.provider} prices`
              : `${data.walletCount} wallet${data.walletCount === 1 ? '' : 's'}`
          }
        />
        <StatCard label="Cash on hand" icon="💵" value={money(data.liquidBalance, true)} hint="Expense wallets" />
        <StatCard
          label="Income"
          tone="positive"
          icon="↑"
          value={money(data.monthIncome, true)}
          hint={formatPeriod(period, locale)}
        />
        <StatCard
          label="Spent"
          tone="negative"
          icon="↓"
          value={money(data.monthExpense, true)}
          hint={`${data.categoryBreakdown.length} categor${data.categoryBreakdown.length === 1 ? 'y' : 'ies'}`}
        />
        <StatCard
          label="Saved this month"
          tone={data.monthNet >= 0 ? 'positive' : 'negative'}
          icon="🏦"
          value={money(data.monthNet, true)}
          hint={`Savings rate ${formatPercent(data.savingsRate)}`}
        />
        {hasPositions && (
          <StatCard
            label="Unrealised P&L"
            tone={portfolio.totalPnl >= 0 ? 'positive' : 'negative'}
            icon="📈"
            value={formatPercent(portfolio.totalPnlPercent, 2, true)}
            hint={`${format(portfolio.totalPnl, { signed: true })} on ${money(portfolio.totalCost, true)} cost`}
          />
        )}
      </div>

      <div className="grid grid--split">
        <Card
          title="Budget progress"
          subtitle={formatPeriod(period, locale)}
          actions={
            <Button size="sm" onClick={() => onNavigate('budgets')}>
              Manage
            </Button>
          }
          padded={data.budgets.length === 0}
        >
          {data.budgets.length === 0 ? (
            <EmptyState
              icon="🎯"
              title="No budgets for this month"
              description="Set limits by exact amount or as a share of income — 40% invest, 10% save, 20% needs."
              action={
                <Button variant="primary" size="sm" onClick={() => onNavigate('budgets')}>
                  Create a budget
                </Button>
              }
            />
          ) : (
            <div className="list">
              {data.budgets.slice(0, 6).map((budget) => (
                <div key={budget.id} className="budget-item">
                  <div className="budget-head">
                    <span className="budget-name">
                      {budget.targetLabel || 'All spending'}
                      {budget.mode === 'percent' && <Badge tone="accent">{budget.value}%</Badge>}
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
                    <span>{formatPercent(budget.percentUsed)} used</span>
                    <span className={budget.remaining < 0 ? 'text-negative' : ''}>
                      {budget.remaining < 0
                        ? `${money(Math.abs(budget.remaining))} over`
                        : `${money(budget.remaining)} left`}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card title="Wallets" actions={<Button size="sm" onClick={() => onNavigate('wallets')}>Manage</Button>} padded={false}>
          <div className="list">
            {data.wallets.map((wallet) => (
              <div key={wallet.id} className="list-item">
                <span className="avatar" style={{ background: `${wallet.color}22`, color: wallet.color }}>
                  {wallet.icon || '💳'}
                </span>
                <div className="list-item-main">
                  <div className="list-item-title">{wallet.name}</div>
                  <div className="list-item-sub">
                    {wallet.mode === 'investment'
                      ? `Cash ${money(wallet.balance)} · ${money(wallet.investedCost)} invested`
                      : `${wallet.kind} · ${wallet.transactionCount} record${wallet.transactionCount === 1 ? '' : 's'}`}
                  </div>
                </div>
                <span className={cx('list-item-amount', wallet.balance < 0 && 'text-negative')}>
                  {money(wallet.mode === 'investment' ? wallet.balance + wallet.investedCost : wallet.balance)}
                </span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <div className="grid grid--split">
        <Card title="Income vs spending" subtitle="Last 6 months">
          <div className="trend">
            {data.trend.map((point) => (
              <div key={point.period} className="trend-col">
                <div className="trend-bars">
                  <div
                    className="trend-bar trend-bar--income"
                    style={{ height: `${(point.income / maxTrend) * 100}%` }}
                    title={`Income ${money(point.income)}`}
                  />
                  <div
                    className="trend-bar trend-bar--expense"
                    style={{ height: `${(point.expense / maxTrend) * 100}%` }}
                    title={`Spent ${money(point.expense)}`}
                  />
                </div>
                <span className="trend-label">{point.period.slice(5)}</span>
              </div>
            ))}
          </div>
          <div className="legend" style={{ marginTop: 12 }}>
            <span>
              <i className="legend-dot" style={{ background: 'var(--positive)' }} /> Income
            </span>
            <span>
              <i className="legend-dot" style={{ background: 'var(--negative)' }} /> Spending
            </span>
          </div>
        </Card>

        <Card title="Where it went" subtitle={formatPeriod(period, locale)}>
          {data.categoryBreakdown.length === 0 ? (
            <EmptyState icon="🧾" title="Nothing spent yet" description="Expenses recorded this month show up here." />
          ) : (
            <div>
              {data.categoryBreakdown.slice(0, 7).map((row) => (
                <div key={row.category} className="share-row">
                  <span className="list-item-title">{row.category}</span>
                  <span className="share-track">
                    <span className="share-fill" style={{ width: `${row.share}%` }} />
                  </span>
                  <span className="numeric text-muted">{money(row.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      <Card
        title="Recent activity"
        actions={<Button size="sm" onClick={() => onNavigate('transactions')}>See all</Button>}
        padded={false}
      >
        {data.recentTransactions.length === 0 ? (
          <EmptyState icon="🧾" title="No transactions yet" description="Add one from the Activity tab." />
        ) : (
          <div className="list">
            {data.recentTransactions.map((tx) => {
              const wallet = data.wallets.find((w) => w.id === tx.walletId);
              const target = data.wallets.find((w) => w.id === tx.toWalletId);
              const sign = tx.type === 'income' ? '+' : tx.type === 'expense' ? '-' : '';
              return (
                <div key={tx.id} className="list-item">
                  <span className="avatar" aria-hidden="true">
                    {tx.type === 'income' ? '↑' : tx.type === 'expense' ? '↓' : '⇄'}
                  </span>
                  <div className="list-item-main">
                    <div className="list-item-title">
                      {tx.type === 'transfer' ? `${wallet?.name ?? '?'} → ${target?.name ?? '?'}` : tx.category}
                    </div>
                    <div className="list-item-sub">
                      {formatDate(tx.date, locale)}
                      {tx.note ? ` · ${tx.note}` : wallet ? ` · ${wallet.name}` : ''}
                    </div>
                  </div>
                  <span
                    className={cx(
                      'list-item-amount',
                      tx.type === 'income' && 'text-positive',
                      tx.type === 'expense' && 'text-negative',
                    )}
                  >
                    {sign}
                    {money(tx.amount)}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </Card>
    </>
  );
}
