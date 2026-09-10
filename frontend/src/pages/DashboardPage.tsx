import { Calculator, Receipt, Target, Wallet } from 'lucide-react';
import { Suspense, lazy, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../components/Icon';
import { DashboardSkeleton } from '../components/Skeletons';
import { Alert, Badge, Button, Card, EmptyState, ProgressBar, RefreshButton } from '../components/ui';
import { useExcelDB, useExcelQuery } from '../hooks/useExcelDB';
import { useStockQuotes } from '../hooks/useStockQuotes';
import { periodRange } from '../lib/cashflow';
import { formatPercent, formatPeriod, formatDate, cx } from '../lib/format';
import { positionKeyOf } from '../lib/positions';
import { Route } from '../lib/router';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { DashboardSummary, Investment, Transaction, WalletBalance } from '../types';

/**
 * Recharts is ~300kB of the bundle for one card on one screen. Splitting it out
 * lets the shell, the login screen and every other route paint without it; the
 * chunk then loads alongside the dashboard's own 1-3s data request, so it is
 * ready before the data it draws.
 */
const CashFlowSankey = lazy(() =>
  import('../components/CashFlowSankey').then((m) => ({ default: m.CashFlowSankey })),
);

const IncomeSpendingChart = lazy(() =>
  import('../components/IncomeSpendingChart').then((m) => ({ default: m.IncomeSpendingChart })),
);

/* Recharts again, plus the projection maths. Lazy for the same reason the two
   above are: the widget is below the fold and most visits never scroll to it. */
const NetWorthProjection = lazy(() =>
  import('../components/NetWorthProjection').then((m) => ({ default: m.NetWorthProjection })),
);

/* The tax modal drags in its own receipt UI and, on export, jsPDF. None of it
   belongs in the Dashboard's chunk when most visits never open it — and this
   is the default route, so its chunk is the one everybody pays for. */
const TaxCalculatorModal = lazy(() =>
  import('../components/TaxCalculatorModal').then((m) => ({ default: m.TaxCalculatorModal })),
);

/** How far back the cash-flow chart looks. One year of scrollable history. */
const HISTORY_MONTHS = 12;

export function DashboardPage({ period, onNavigate }: { period: string; onNavigate: (route: Route) => void }) {
  const { settings } = useSettings();
  const { locale } = settings;
  const format = useMoneyFormatter();

  const { data, initialLoading, isValidating, error, refresh } = useExcelQuery<DashboardSummary>(
    '/api/dashboard',
    { period },
  );
  // The dashboard summary only carries aggregates and a handful of recent rows;
  // the Sankey needs every transaction in the month. Same cache key the Activity
  // tab uses when its filters are clear, so the two share one request.
  const monthTransactions = useExcelDB<Transaction>('transactions', { period });

  // A year of rows for the cash-flow chart, which groups them by month itself
  // rather than taking the server's fixed six-month rollup. Its own cache key,
  // so it neither disturbs the shared `{ period }` request above nor refetches
  // when the user pages between months inside the window.
  const historyWindow = useMemo(() => periodRange(period, HISTORY_MONTHS), [period]);
  const history = useExcelDB<Transaction>('transactions', {
    from: historyWindow.from,
    to: historyWindow.to,
    // The server caps at 5000 and returns newest first, so an account busier
    // than this loses its oldest months — the ones already off the left edge.
    limit: 5000,
  });

  const positions = (data?.openPositions ?? []) as Investment[];
  const portfolio = useStockQuotes(positions);

  /* The tax estimate is expensive and entirely on demand, so all that lives up
     here is a boolean. The modal fetches nothing until its own button is
     pressed — see the note at the top of TaxCalculatorModal. */
  const [taxOpen, setTaxOpen] = useState(false);

  /* `positions` is one row per *purchase*, so a dollar-cost-averaged ticker
     appears several times. The headline counts holdings instead — three buys of
     Apple is one position, and saying "3 positions" would overstate how spread
     out the portfolio is. Totals below are unaffected: they sum money, not rows. */
  const holdingCount = useMemo(
    () => new Set(positions.map((row) => positionKeyOf(row))).size,
    [positions],
  );

  const money = (value: number, compact = false) => format(value, { compact });
  const { t } = useTranslation();

  // Only shown when there is genuinely nothing cached. Revisiting this page
  // paints the previous data immediately and refreshes behind the scenes.
  if (initialLoading) return <DashboardSkeleton />;

  // Only a hard failure with nothing cached blocks the page. A failed refresh
  // over good data leaves the data on screen.
  if (!data) {
    return (
      <Card title={t('dashboard.loadFailed')}>
        <Alert tone="error">{error ?? t('dashboard.noData')}</Alert>
        <div style={{ marginTop: 'var(--space-4)' }}>
          <Button onClick={() => void refresh()}>{t('common.tryAgain')}</Button>
        </div>
      </Card>
    );
  }

  const hasPositions = positions.length > 0;
  // Swap cost basis for live market value so net worth reflects today's prices.
  const netWorthLive = hasPositions
    ? data.netWorth - portfolio.totalCost + portfolio.totalValue
    : data.netWorth;

  /* ---- Cash and card debt ----
     `netWorth` already nets the two: a credit wallet's balance is negative, so
     summing spending wallets subtracts the debt. What was missing was saying so
     — a user seeing only the total had no way to tell a small net worth from a
     healthy one with a card outstanding against it.

     The fallbacks cover the window between deploying this frontend and pushing
     the matching Code.gs: an older payload has no `cashBalance`, and reading
     `undefined` into a currency formatter renders NaN rather than failing
     loudly. With no credit wallets the two are equal anyway. */
  const cashBalance = data.cashBalance ?? data.liquidBalance;
  const creditDebt = data.creditDebt ?? 0;
  const safeToSpend = data.safeToSpend ?? data.liquidBalance;
  const hasDebt = creditDebt > 0;

  const isEmpty = data.walletCount === 0;

  // Presentational grouping only — the wallets themselves are unchanged.
  const spendWallets = data.wallets.filter((w) => w.mode === 'expense');
  const investWallets = data.wallets.filter((w) => w.mode === 'investment');

  if (isEmpty) {
    return (
      <Card>
        <EmptyState
          icon={<Icon icon={Wallet} size="xl" />}
          title={t('dashboard.firstWalletTitle')}
          description={t('dashboard.firstWalletBody')}
          action={
            <Button variant="primary" onClick={() => onNavigate('wallets')}>
              {t('dashboard.goToWallets')}
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
            ? t('dashboard.walletInvested', { cash: money(wallet.balance), invested: money(wallet.investedCost) })
            : `${wallet.kind} · ${t('dashboard.recordCount', { count: wallet.transactionCount })}`}
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
          {/* The button replaces the old passive refresh-dot: it spins on a
              background revalidation too, so it reports the same thing while
              also being actionable. */}
          <div className="hero-label-row">
            <span className="section-label">
              {t('dashboard.netWorth')} · {formatPeriod(period, locale)}
            </span>
            <RefreshButton
              onRefresh={() => Promise.all([refresh(), portfolio.refresh()])}
              busy={isValidating}
              label={t('dashboard.refresh')}
            />
          </div>
          <span className="hero-value">{money(netWorthLive)}</span>
          <div className="hero-meta">
            <Badge tone={data.monthNet >= 0 ? 'positive' : 'negative'}>
              {data.monthNet >= 0
                ? t('dashboard.monthNetUp', { amount: format(Math.abs(data.monthNet), { compact: true }) })
                : t('dashboard.monthNetDown', { amount: format(Math.abs(data.monthNet), { compact: true }) })}
            </Badge>
            {hasPositions && (
              <span>
                {t('dashboard.inPositions', {
                  count: holdingCount,
                  amount: money(portfolio.totalValue, true),
                  provider: portfolio.provider,
                })}
              </span>
            )}
            {!hasPositions && (
              <span>{t('dashboard.walletCount', { count: data.walletCount })}</span>
            )}
          </div>

          {/* Sits under the headline figure rather than in the card actions:
              it opens a different kind of thing — a document you take away —
              and it is the one control here that runs work rather than
              refreshing a view. */}
          <button type="button" className="tax-cta" onClick={() => setTaxOpen(true)}>
            <Icon icon={Calculator} size="sm" />
            {t('dashboard.taxCta')}
          </button>
        </div>

        <div className="hero-metrics">
          <div className="metric">
            <span className="section-label">{t('dashboard.cashOnHand')}</span>
            <span className="metric-value">{money(cashBalance, true)}</span>
            <span className="metric-hint">
              {hasDebt ? t('dashboard.afterCards', { amount: money(safeToSpend, true) }) : t('dashboard.cashWallets')}
            </span>
          </div>
          {hasDebt && (
            <div className="metric metric--negative">
              <span className="section-label">{t('dashboard.cardDebt')}</span>
              <span className="metric-value text-negative">{money(creditDebt, true)}</span>
              <span className="metric-hint">
                {data.creditLimit > 0
                  ? t('dashboard.limitUsed', { percent: formatPercent(data.creditUtilization, 0) })
                  : t('dashboard.alreadySubtracted')}
              </span>
            </div>
          )}
          <div className="metric metric--positive">
            <span className="section-label">{t('dashboard.income')}</span>
            <span className="metric-value text-positive">{money(data.monthIncome, true)}</span>
            <span className="metric-hint">{t('common.thisMonth')}</span>
          </div>
          <div className="metric metric--negative">
            <span className="section-label">{t('dashboard.spent')}</span>
            <span className="metric-value text-negative">{money(data.monthExpense, true)}</span>
            <span className="metric-hint">
              {t('dashboard.categoryCount', { count: data.categoryBreakdown.length })}
            </span>
          </div>
          <div className="metric metric--accent">
            <span className="section-label">{t('dashboard.savedLabel')}</span>
            <span className="metric-value">{money(data.monthNet, true)}</span>
            <span className="metric-hint">{t('dashboard.savingsRate', { percent: formatPercent(data.savingsRate) })}</span>
          </div>
          {hasPositions && (
            <div className={cx('metric', portfolio.totalPnl >= 0 ? 'metric--positive' : 'metric--negative')}>
              <span className="section-label">{t('dashboard.unrealised')}</span>
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
          title={t('dashboard.budgetProgress')}
          subtitle={formatPeriod(period, locale)}
          actions={
            <Button size="sm" onClick={() => onNavigate('budgets')}>
              {t('common.manage')}
            </Button>
          }
          padded={data.budgets.length === 0}
        >
          {data.budgets.length === 0 ? (
            <EmptyState
              icon={<Icon icon={Target} size="xl" />}
              title={t('dashboard.noBudgetsTitle')}
              description={t('dashboard.noBudgetsBody')}
              action={
                <Button variant="primary" size="sm" onClick={() => onNavigate('budgets')}>
                  {t('dashboard.createBudget')}
                </Button>
              }
            />
          ) : (
            <div className="list">
              {data.budgets.slice(0, 5).map((budget) => (
                <div key={budget.id} className="budget-item">
                  <div className="budget-head">
                    <span className="budget-name truncate">
                      {budget.targetLabel || t('dashboard.allSpending')}
                      {budget.mode === 'percent' && <Badge tone="accent">{budget.value}%</Badge>}
                    </span>
                    <span className="budget-numbers">
                      {money(budget.spent)} <span className="text-faint">/ {money(budget.limit)}</span>
                    </span>
                  </div>
                  <ProgressBar
                    percent={budget.percentUsed}
                    tone={budget.status}
                    label={t('dashboard.budgetUsed', { label: budget.targetLabel, percent: formatPercent(budget.percentUsed) })}
                  />
                  <div className="budget-foot">
                    <span>{formatPercent(budget.percentUsed)} used</span>
                    <span className={budget.remaining < 0 ? 'text-negative' : ''}>
                      {budget.remaining < 0
                        ? t('dashboard.budgetOver', { amount: money(Math.abs(budget.remaining)) })
                        : t('dashboard.budgetLeft', { amount: money(budget.remaining) })}
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
          title={t('dashboard.walletsTitle')}
          actions={
            <Button size="sm" onClick={() => onNavigate('wallets')}>
              {t('common.manage')}
            </Button>
          }
          padded={false}
        >
          {spendWallets.length > 0 && (
            <>
              <div className="list-group-label">
                <span className="section-label">{t('dashboard.spending')}</span>
                <span className="section-label">{money(data.liquidBalance, true)}</span>
              </div>
              <div className="list">{spendWallets.map(walletRow)}</div>
            </>
          )}

          {investWallets.length > 0 && (
            <>
              <div className="list-group-label">
                <span className="section-label">{t('dashboard.investing')}</span>
                <span className="section-label">
                  {money(data.investmentCash + data.investedCost, true)}
                </span>
              </div>
              <div className="list">{investWallets.map(walletRow)}</div>
            </>
          )}
        </Card>

        {/* Twelve months of paired bars. At half width each month gets ~40px,
            which is why the component scrolls horizontally; given the full row
            it mostly does not have to. */}
        <Suspense
          fallback={<div className="card bento-item--full ischart-placeholder" aria-hidden="true" />}
        >
          <IncomeSpendingChart
            className="bento-item--full"
            transactions={history.items}
            trend={data.trend}
            period={period}
            months={HISTORY_MONTHS}
            loading={history.initialLoading}
            stale={history.isValidating}
          />
        </Suspense>

        {/* Sits beside the cash-flow chart: one card looks back at what was
            saved, the next asks what that rate becomes. `netWorthLive` and the
            dashboard's own trend are reused, so the widget costs no request. */}
        <Card
          /* Full row, not `--wide`. A span-4 card between two span-3 cards
             cannot tile a 6-column grid — 4 + 3 = 7 — so it wrapped and left a
             three-column hole behind it. It also wants the width: a ten-year
             curve plus two sliders is cramped at four columns. */
          className="bento-item--full"
          title={t('dashboard.projectionTitle')}
          subtitle={t('dashboard.projectionSubtitle')}
        >
          <Suspense fallback={<div className="proj proj--loading" aria-hidden="true" />}>
            <NetWorthProjection
              startingNetWorth={netWorthLive}
              trend={data.trend}
              money={format}
              locale={locale}
            />
          </Suspense>
        </Card>

        <Card className="bento-item--half" title={t('dashboard.breakdownTitle')} subtitle={formatPeriod(period, locale)}>
          {data.categoryBreakdown.length === 0 ? (
            <EmptyState icon={<Icon icon={Receipt} size="xl" />} title={t('dashboard.nothingSpentTitle')} description={t('dashboard.nothingSpentBody')} />
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

        <Suspense fallback={<div className="card sankey-placeholder" aria-hidden="true" />}>
          <CashFlowSankey
            transactions={monthTransactions.items}
            wallets={data.wallets}
            period={period}
            loading={monthTransactions.initialLoading}
            stale={monthTransactions.isValidating}
          />
        </Suspense>

        {/* Half width so it pairs with "Where it went" — dense packing lifts it
            into that row's empty half rather than leaving one there. */}
        <Card
          className="bento-item--half"
          title={t('dashboard.recentTitle')}
          actions={
            <Button size="sm" onClick={() => onNavigate('transactions')}>
              {t('common.seeAll')}
            </Button>
          }
          padded={false}
        >
          {data.recentTransactions.length === 0 ? (
            <EmptyState icon={<Icon icon={Receipt} size="xl" />} title={t('dashboard.noTransactionsTitle')} description={t('dashboard.noTransactionsBody')} />
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

      {/* The chunk is only fetched once the button is pressed, and the
          component itself holds no subscription and issues no request until
          its own Run calculation button is pressed. */}
      {taxOpen && (
        <Suspense fallback={null}>
          <TaxCalculatorModal open onClose={() => setTaxOpen(false)} />
        </Suspense>
      )}
    </>
  );
}
