import { Alert, Badge, Button, Card, EmptyState, ProgressBar, Skeleton } from '../components/ui';
import { useExcelQuery } from '../hooks/useExcelDB';
import { useStockQuotes } from '../hooks/useStockQuotes';
import { formatPercent, formatPeriod, formatDate, cx } from '../lib/format';
import { Route } from '../lib/router';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { DashboardSummary, Investment, WalletBalance } from '../types';

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
        <div style={{ marginTop: 'var(--space-4)' }}>
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

  // Presentational grouping only — the wallets themselves are unchanged.
  const spendWallets = data.wallets.filter((w) => w.mode === 'expense');
  const investWallets = data.wallets.filter((w) => w.mode === 'investment');

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

  const walletRow = (wallet: WalletBalance) => (
    <div key={wallet.id} className="list-item">
      <span className="avatar" style={{ background: `${wallet.color}1f`, color: wallet.color }}>
        {wallet.icon || '💳'}
      </span>
      <div className="list-item-main">
        <div className="list-item-title truncate">{wallet.name}</div>
        <div className="list-item-sub">
          {wallet.mode === 'investment'
            ? `${money(wallet.balance)} cash · ${money(wallet.investedCost)} invested`
            : `${wallet.kind} · ${wallet.transactionCount} record${wallet.transactionCount === 1 ? '' : 's'}`}
        </div>
      </div>
      <span className={cx('list-item-amount', wallet.balance < 0 && 'text-negative')}>
        {money(wallet.mode === 'investment' ? wallet.balance + wallet.investedCost : wallet.balance)}
      </span>
    </div>
  );

  return (
    <>
      {/* ---- Hero: one headline figure, everything else deliberately quieter ---- */}
      <section className="hero">
        <div className="hero-primary">
          <span className="section-label">Net worth · {formatPeriod(period, locale)}</span>
          <span className="hero-value">{money(netWorthLive)}</span>
          <div className="hero-meta">
            <Badge tone={data.monthNet >= 0 ? 'positive' : 'negative'}>
              {data.monthNet >= 0 ? '↑' : '↓'} {format(Math.abs(data.monthNet), { compact: true })} this month
            </Badge>
            {hasPositions && (
              <span>
                {money(portfolio.totalValue, true)} in {portfolio.positions.length} position
                {portfolio.positions.length === 1 ? '' : 's'} · {portfolio.provider} prices
              </span>
            )}
            {!hasPositions && (
              <span>
                {data.walletCount} wallet{data.walletCount === 1 ? '' : 's'}
              </span>
            )}
          </div>
        </div>

        <div className="hero-metrics">
          <div className="metric">
            <span className="section-label">Cash on hand</span>
            <span className="metric-value">{money(data.liquidBalance, true)}</span>
            <span className="metric-hint">Expense wallets</span>
          </div>
          <div className="metric metric--positive">
            <span className="section-label">Income</span>
            <span className="metric-value text-positive">{money(data.monthIncome, true)}</span>
            <span className="metric-hint">This month</span>
          </div>
          <div className="metric metric--negative">
            <span className="section-label">Spent</span>
            <span className="metric-value text-negative">{money(data.monthExpense, true)}</span>
            <span className="metric-hint">
              {data.categoryBreakdown.length} categor{data.categoryBreakdown.length === 1 ? 'y' : 'ies'}
            </span>
          </div>
          <div className="metric metric--accent">
            <span className="section-label">Saved</span>
            <span className="metric-value">{money(data.monthNet, true)}</span>
            <span className="metric-hint">Rate {formatPercent(data.savingsRate)}</span>
          </div>
          {hasPositions && (
            <div className={cx('metric', portfolio.totalPnl >= 0 ? 'metric--positive' : 'metric--negative')}>
              <span className="section-label">Unrealised</span>
              <span
                className={cx('metric-value', portfolio.totalPnl >= 0 ? 'text-positive' : 'text-negative')}
              >
                {formatPercent(portfolio.totalPnlPercent, 2, true)}
              </span>
              <span className="metric-hint">{format(portfolio.totalPnl, { signed: true })}</span>
            </div>
          )}
        </div>
      </section>

      {/* ---- Bento: panels sized by importance rather than a uniform grid ---- */}
      <div className="bento">
        <Card
          className="bento-item--wide"
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
              title="No budgets this month"
              description="Set limits by exact amount or as a share of income — 40% invest, 10% save, 20% needs."
              action={
                <Button variant="primary" size="sm" onClick={() => onNavigate('budgets')}>
                  Create a budget
                </Button>
              }
            />
          ) : (
            <div className="list">
              {data.budgets.slice(0, 5).map((budget) => (
                <div key={budget.id} className="budget-item">
                  <div className="budget-head">
                    <span className="budget-name truncate">
                      {budget.targetLabel || 'All spending'}
                      {budget.mode === 'percent' && <Badge tone="accent">{budget.value}%</Badge>}
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

        {/* Wallets split by mode — the two halves of the app, side by side. */}
        <Card
          className="bento-item--narrow"
          title="Wallets"
          actions={
            <Button size="sm" onClick={() => onNavigate('wallets')}>
              Manage
            </Button>
          }
          padded={false}
        >
          {spendWallets.length > 0 && (
            <>
              <div className="list-group-label">
                <span className="section-label">Spending</span>
                <span className="section-label">{money(data.liquidBalance, true)}</span>
              </div>
              <div className="list">{spendWallets.map(walletRow)}</div>
            </>
          )}

          {investWallets.length > 0 && (
            <>
              <div className="list-group-label">
                <span className="section-label">Investing</span>
                <span className="section-label">
                  {money(data.investmentCash + data.investedCost, true)}
                </span>
              </div>
              <div className="list">{investWallets.map(walletRow)}</div>
            </>
          )}
        </Card>

        <Card className="bento-item--half card--chart" title="Income vs spending" subtitle="Last 6 months">
          <div className="trend">
            {data.trend.map((point, index) => (
              <div key={point.period} className="trend-col">
                <div className="trend-bars">
                  <div
                    className="trend-bar trend-bar--income"
                    style={{
                      height: `${(point.income / maxTrend) * 100}%`,
                      animationDelay: `${index * 60}ms`,
                    }}
                    title={`Income ${money(point.income)}`}
                  />
                  <div
                    className="trend-bar trend-bar--expense"
                    style={{
                      height: `${(point.expense / maxTrend) * 100}%`,
                      animationDelay: `${index * 60 + 30}ms`,
                    }}
                    title={`Spent ${money(point.expense)}`}
                  />
                </div>
                <span className="trend-label">{point.period.slice(5)}</span>
              </div>
            ))}
          </div>
          <div className="legend" style={{ marginTop: 'var(--space-4)' }}>
            <span>
              <i className="legend-dot" style={{ background: 'var(--positive)' }} /> Income
            </span>
            <span>
              <i className="legend-dot" style={{ background: 'var(--negative)' }} /> Spending
            </span>
          </div>
        </Card>

        <Card className="bento-item--half" title="Where it went" subtitle={formatPeriod(period, locale)}>
          {data.categoryBreakdown.length === 0 ? (
            <EmptyState icon="🧾" title="Nothing spent yet" description="Expenses this month show up here." />
          ) : (
            <div className="stack stack--tight">
              {data.categoryBreakdown.slice(0, 7).map((row, index) => (
                <div key={row.category} className="share-row">
                  <span className="truncate">{row.category}</span>
                  <span className="share-track">
                    <span
                      className="share-fill"
                      style={{ width: `${row.share}%`, animationDelay: `${index * 55}ms` }}
                    />
                  </span>
                  <span className="numeric text-muted">{money(row.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card
          title="Recent activity"
          actions={
            <Button size="sm" onClick={() => onNavigate('transactions')}>
              See all
            </Button>
          }
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
                    <span
                      className="avatar"
                      aria-hidden="true"
                      style={
                        tx.type === 'income'
                          ? { background: 'var(--positive-soft)', color: 'var(--positive)' }
                          : tx.type === 'expense'
                            ? { background: 'var(--negative-soft)', color: 'var(--negative)' }
                            : undefined
                      }
                    >
                      {tx.type === 'income' ? '↑' : tx.type === 'expense' ? '↓' : '⇄'}
                    </span>
                    <div className="list-item-main">
                      <div className="list-item-title truncate">
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
      </div>
    </>
  );
}
