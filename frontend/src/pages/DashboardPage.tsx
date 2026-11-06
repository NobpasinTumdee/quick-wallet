import {
  ArrowDown,
  ArrowLeftRight,
  ArrowRight,
  ArrowUp,
  Calculator,
  ChartNoAxesCombined,
  ChevronDown,
  Globe,
  History,
  Receipt,
  Target,
  Unlock,
  Wallet,
} from 'lucide-react';
import { Fragment, ReactNode, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../components/Icon';
import { TileAmount } from '../components/TileAmount';
import { RecordedAt } from '../components/RecordedAt';
import { DashboardSkeleton } from '../components/Skeletons';
import { FinancialInboxWidget } from '../components/FinancialInboxWidget';
import { WalletIconRenderer } from '../components/WalletIconRenderer';
import { FitList } from '../components/FitList';
import { BalanceView, SwipeableBalanceCard } from '../components/SwipeableBalanceCard';
import { Alert, Badge, Button, Card, EmptyState, ProgressBar, RefreshButton } from '../components/ui';
import { useExcelDB, useExcelQuery } from '../hooks/useExcelDB';
import { useStockQuotes } from '../hooks/useStockQuotes';
import { BalanceContextId, balanceContexts, historicalContexts } from '../lib/balanceContexts';
import { periodRange } from '../lib/cashflow';
import { formatPercent, formatPeriod, formatDate, cx } from '../lib/format';
import { useMobileV2 } from '../lib/mobileLayout';
import { positionKeyOf } from '../lib/positions';
import { Route } from '../lib/router';
import type { TranslationKey } from '../locales/en';
import { useAuth } from '../state/AuthContext';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { DashboardSummary, Goal, Investment, Transaction, TransactionType, WalletBalance } from '../types';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import { SIDEBAR_QUERY, useMediaQuery } from '../hooks/useMediaQuery';
import { HOME_CARDS, HOME_LAYOUT_PAGE, HOME_LEGACY_LAYOUT_PAGE, HomeCardId } from '../lib/layout/homeCards';
import { useCardLayout, useEffectiveSpans, useGridMetrics } from '../lib/layout/useCardLayout';
import { setHomeEditing, useHomeEditing } from '../lib/layout/homeEditStore';
import { CardLayout, updateCard } from '../lib/layout/layoutModel';
import {
  GridLayout,
  fitGridToWidth,
  gridArea,
  isPlaced,
  migrateV1,
  placeFlowLayout,
  readingOrder,
  serializeGridLayout,
  setGridCardFlags,
  toCardLayout,
} from '../lib/layout/gridModel';
import { continueRecent } from '../lib/layout/recentRows';
import { toast } from '../lib/toast';


const IncomeSpendingChart = lazyWithRetry(() =>
  import('../components/IncomeSpendingChart').then((m) => ({ default: m.IncomeSpendingChart })),
);


/* The tax modal drags in its own receipt UI and, on export, jsPDF. None of it
   belongs in the Dashboard's chunk when most visits never open it — and this
   is the default route, so its chunk is the one everybody pays for. */
/* Edit mode for the desktop layout: its own chunk, loaded when Customize is
   pressed — almost no visit to Home ever needs it. */
/** The cash-flow chart's plot height when its card is set to Tall. */
const TALL_CHART_HEIGHT = 400;

const CardLayoutEditor = lazyWithRetry(() => import('../components/CardLayoutEditor'));

const TaxCalculatorModal = lazyWithRetry(() =>
  import('../components/TaxCalculatorModal').then((m) => ({ default: m.TaxCalculatorModal })),
);

/** How far back the cash-flow chart looks. One year of scrollable history. */
const HISTORY_MONTHS = 12;

/** The new phone layout's quick-add buttons, in the form's own order. */
const QUICK_TYPES: { type: TransactionType; label: TranslationKey; icon: typeof ArrowDown }[] = [
  { type: 'expense', label: 'forms.typeExpense', icon: ArrowDown },
  { type: 'income', label: 'forms.typeIncome', icon: ArrowUp },
  { type: 'transfer', label: 'forms.typeTransfer', icon: ArrowLeftRight },
];

export function DashboardPage({
  period,
  onNavigate,
  onQuickAdd,
}: {
  period: string;
  onNavigate: (route: Route) => void;
  /** Opens the shell's New transaction form with this type already picked —
   *  the same form, path and validation the "+" button's tap opens. Used by
   *  the new phone layout's Expense / Income / Transfer buttons. */
  onQuickAdd?: (type: TransactionType) => void;
}) {
  const { settings } = useSettings();
  const { locale } = settings;
  const format = useMoneyFormatter();
  /* The new phone layout: hero header, quick-add buttons, the content sheet.
     False on desktop and in Classic, which render exactly as before. */
  const mobileV2 = useMobileV2();
  const { user } = useAuth();

  /* ---- Customisable layout (desktop with the sidebar only) ----
     Below 1000px none of this applies and the bento renders exactly as it
     always has. At 1000px and up the same cards are placed on a 12-column
     grid from the saved layout — or from the default, which reproduces the
     old 6-column arrangement to the pixel. */
  const layoutActive = useMediaQuery(SIDEBAR_QUERY);
  const {
    layout: gridLayout,
    save: saveGridLayout,
    reset: resetLayout,
    isCustom,
  } = useCardLayout(HOME_LAYOUT_PAGE, HOME_LEGACY_LAYOUT_PAGE, user?.id, HOME_CARDS, layoutActive);
  /* Flow layouts (the default, and every layout saved before free placement)
     are drawn and edited in order-and-width terms, exactly as before. */
  const layout = useMemo(() => toCardLayout(gridLayout, HOME_CARDS), [gridLayout]);
  const saveLayout = (next: CardLayout<HomeCardId>) => saveGridLayout(migrateV1(next));
  const [gridElement, setGridElement] = useState<HTMLDivElement | null>(null);
  const gridMetrics = useGridMetrics(gridElement, layoutActive);

  /* Each card's drawn width in a flow layout on this screen. */
  const spans = useEffectiveSpans(layout, HOME_CARDS, gridMetrics);

  /* A placed layout (cards with x/y/w/h in cells) as drawn on this screen:
     a card too narrow here is widened and the rest reflows. */
  const placedLayout =
    layoutActive && isPlaced(gridLayout) ? fitGridToWidth(gridLayout, HOME_CARDS, gridMetrics.width, gridMetrics.gap) : null;

  /* Edit mode works on cells. Opening it on a flow layout turns what is on
     screen into a placed draft — every card where it is, as tall as it
     measures, rounded to whole rows — so editing starts from exactly what
     you see. Done saves the draft only if something changed, so opening
     and closing never converts a layout by itself. Cancel drops it; leaving
     Home or going below the sidebar breakpoint ends it without saving. */
  const editing = useHomeEditing() && layoutActive;
  const [draft, setDraft] = useState<GridLayout<HomeCardId> | null>(null);
  const draftStart = useRef('');
  if (editing && !draft) {
    let start: GridLayout<HomeCardId>;
    if (placedLayout) {
      start = placedLayout;
    } else {
      /* Read from the flow grid still on screen: its children are the
         visible cards, in order. */
      const visible = layout.cards.filter((card) => !card.hidden);
      const children = gridElement ? (Array.from(gridElement.children) as HTMLElement[]) : [];
      const heights: Record<string, number> = {};
      if (children.length === visible.length) visible.forEach((card, index) => (heights[card.id] = children[index].offsetHeight));
      start = fitGridToWidth(
        placeFlowLayout(gridLayout, HOME_CARDS, spans, heights, gridMetrics.gap || 24),
        HOME_CARDS,
        gridMetrics.width,
        gridMetrics.gap,
      );
    }
    draftStart.current = serializeGridLayout(start);
    setDraft(start);
  }
  if (!editing && draft) setDraft(null);
  useEffect(() => {
    if (!layoutActive) setHomeEditing(false);
  }, [layoutActive]);
  useEffect(() => () => setHomeEditing(false), []);

  const { data, initialLoading, isValidating, error, refresh } = useExcelQuery<DashboardSummary>(
    '/api/dashboard',
    { period },
  );
  // The dashboard summary only carries aggregates and a handful of recent rows;
  // the Sankey needs every transaction in the month. Same cache key the Activity
  // tab uses when its filters are clear, so the two share one request.

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

  /* The goal envelopes, for the third balance reading. Cached under the same
     key the Goals screen uses, so arriving there costs no second request — and
     `useExcelDB` paints from that cache when it is already warm. */
  const goals = useExcelDB<Goal>('goals');

  const positions = (data?.openPositions ?? []) as Investment[];
  const portfolio = useStockQuotes(positions);

  /* The tax estimate is expensive and entirely on demand, so all that lives up
     here is a boolean. The modal fetches nothing until its own button is
     pressed — see the note at the top of TaxCalculatorModal. */
  const [taxOpen, setTaxOpen] = useState(false);

  /**
   * Which reading the balance card shows.
   *
   * The override is keyed on the period, not held as a bare boolean, so that
   * stepping the month picker returns to the sensible default for wherever you
   * land — historical in the past, current in the present — while an explicit
   * choice still sticks for as long as you stay on that month. A plain boolean
   * would carry "show me today's money" into March and quietly make the label
   * and the figure disagree.
   *
   * Declared up here with the other hooks rather than beside the markup it
   * drives: everything below the early returns runs conditionally, and a hook
   * there changes the hook count between renders.
   */
  const [override, setOverride] = useState<{ period: string; historical: boolean } | null>(null);

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

  /* ---- Time travel ----
     Same fallback convention as the figures below: an older Code.gs sends no
     snapshot, and the card simply behaves as it always did. */
  const canTimeTravel = Boolean(data.isHistorical && data.historical);

  const showingHistorical =
    canTimeTravel && (override?.period === period ? override.historical : true);

  /* Deliberately NOT `netWorthLive`. Live quotes are today's prices, and
     applying them to a March balance would report what those holdings are worth
     now against the cash position as it was then — a figure true of no moment in
     time. The snapshot carries holdings at cost, and the caption says so. */
  const heroValue = showingHistorical ? (data.historical?.netWorth ?? 0) : netWorthLive;

  /* ---- The three readings ----
     Past months get two: a goal envelope has no history, so subtracting
     today's earmarks from March's balance would report a figure true of no
     moment in time. See `historicalContexts`. */
  const contexts = showingHistorical
    ? historicalContexts(heroValue, data.historical?.liquidBalance ?? 0)
    : balanceContexts({
      netWorth: netWorthLive,
      liquidBalance: data.liquidBalance,
      goals: goals.items,
    });

  const CONTEXT_ICON: Record<BalanceContextId, typeof Globe> = {
    total: Globe,
    liquid: Wallet,
    available: Unlock,
  };
  const CONTEXT_LABEL: Record<BalanceContextId, string> = {
    total: t('dashboard.contextTotal'),
    liquid: t('dashboard.contextLiquid'),
    available: t('dashboard.contextAvailable'),
  };

  const balanceViews: BalanceView[] = contexts.map((context) => ({
    id: context.id,
    icon: CONTEXT_ICON[context.id],
    label: CONTEXT_LABEL[context.id],
    amount: money(context.value),
    value: context.value,
    muted: showingHistorical,
    /* Only the goals reading waits on a second request. The other two are
       already on the dashboard payload, so they paint immediately. */
    pending: context.id === 'available' && goals.initialLoading,
    note:
      context.id === 'liquid' && context.deducted !== 0
        ? t('dashboard.contextLiquidNote', { amount: money(context.deducted, true) })
        : context.id === 'available'
          ? context.deducted > 0
            ? t('dashboard.contextAvailableNote', { amount: money(context.deducted, true) })
            : t('dashboard.contextAvailableNone')
          : undefined,
  }));

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
      <WalletIconRenderer icon={wallet.icon} color={wallet.color} className="avatar" />
      <div className="list-item-main">
        <div className="list-item-title truncate">{wallet.name}</div>
        <div className="list-item-sub">
          {wallet.mode === 'investment'
            ? t('dashboard.walletInvested', { cash: money(wallet.balance), invested: money(wallet.investedCost) })
            : `${wallet.kind} · ${t('dashboard.recordCount', { count: wallet.transactionCount })}`}
        </div>
      </div>
      <span className={cx('list-item-amount', wallet.balance < 0 && 'text-negative')}>
        {mobileV2 ? (
          <TileAmount
            text={money(wallet.mode === 'investment' ? wallet.balance + wallet.investedCost : wallet.balance)}
            code={format.display}
          />
        ) : (
          money(wallet.mode === 'investment' ? wallet.balance + wallet.investedCost : wallet.balance)
        )}
      </span>
    </div>
  );

  /* Built once and placed by layout: inside the hero in Classic and on
     desktop, at the top of the content sheet in the new phone layout. */
  const metrics = (
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
  );

  /* ---- The cards ----
     One function per card, taking the extra class that sizes it on the
     desktop grid (empty below 1000px). Their markup is exactly what it was;
     only where each one is placed now comes from the layout. */
  /* "+3 more" under a list that does not show every row in its card. */
  const moreLink = (count: number, kind: 'budgets' | 'categories') => (
    <Button
      size="sm"
      variant="ghost"
      className="fit-more-link"
      aria-label={t(kind === 'budgets' ? 'layout.moreBudgets' : 'layout.moreCategories', { n: count })}
      onClick={() => onNavigate(kind === 'budgets' ? 'budgets' : 'analytics')}
    >
      {t('layout.moreCount', { n: count })}
    </Button>
  );

  /* Each card, given its width class, the first version's "Tall" height
     step, and `fill`: sized in grid rows (a placed layout), so its content
     adapts to the height — lists show as many rows as fit, the chart grows. */
  const homeCards: Record<HomeCardId, (sizeClass: string, tall: boolean, fill: boolean) => ReactNode> = {
    budgets: (sizeClass, tall, fill) => (
      <Card
        className={cx('bento-item--wide', sizeClass)}
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
          <FitList
            items={data.budgets}
            fallback={tall ? 10 : 5}
            active={fill}
            className="list"
            more={(count) => moreLink(count, 'budgets')}
            renderItem={(budget) => (
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
            )}
          />
        )}
      </Card>
    ),

    /* Wallets split by mode — the two halves of the app, side by side. */
    wallets: (sizeClass) => (
      <Card
        className={cx('bento-item--narrow', sizeClass)}
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
            <div className={cx('list', mobileV2 && 'home-wallet-grid')}>{spendWallets.map(walletRow)}</div>
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
            <div className={cx('list', mobileV2 && 'home-wallet-grid')}>{investWallets.map(walletRow)}</div>
          </>
        )}
      </Card>
    ),

    /* Twelve months of paired bars. At half width each month gets ~40px,
       which is why the component scrolls horizontally; given the full row
       it mostly does not have to. */
    cashflow: (sizeClass, tall, fill) => (
      <Suspense
        fallback={<div className={cx('card bento-item--full ischart-placeholder', sizeClass)} aria-hidden="true" />}
      >
        <IncomeSpendingChart
          className={cx('bento-item--full', sizeClass)}
          transactions={history.items}
          trend={data.trend}
          period={period}
          months={HISTORY_MONTHS}
          loading={history.initialLoading}
          stale={history.isValidating}
          chartHeight={tall ? TALL_CHART_HEIGHT : undefined}
          fillHeight={fill}
        />
      </Suspense>
    ),

    breakdown: (sizeClass, tall, fill) => (
      <Card className={cx('bento-item--half', sizeClass)} title={t('dashboard.breakdownTitle')} subtitle={formatPeriod(period, locale)}>
        {data.categoryBreakdown.length === 0 ? (
          <EmptyState icon={<Icon icon={Receipt} size="xl" />} title={t('dashboard.nothingSpentTitle')} description={t('dashboard.nothingSpentBody')} />
        ) : (
          <FitList
            items={data.categoryBreakdown}
            fallback={tall ? 14 : 7}
            active={fill}
            className="stack stack--tight"
            more={(count) => moreLink(count, 'categories')}
            renderItem={(row, index) => (
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
            )}
          />
        )}
      </Card>
    ),

    /* Half width by default so it pairs with "Where it went". */
    recent: (sizeClass, _tall, fill) => (
      <Card
        className={cx('bento-item--half', sizeClass)}
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
          <FitList
            /* Taller than eight rows: read on in the chart's year of rows,
               in the server's own order (see recentRows.ts). */
            items={
              fill
                ? continueRecent(data.recentTransactions, history.initialLoading ? null : history.items, historyWindow.to)
                : data.recentTransactions
            }
            fallback={data.recentTransactions.length}
            active={fill}
            className="list"
            renderItem={(tx) => {
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
                      {/* Inline here rather than on its own line: this list is
                          four rows in a half-width card, and a third line per
                          row would cost more than the time is worth. */}
                      <RecordedAt createdAt={tx.createdAt} locale={locale} variant="inline" />
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
            }}
          />
        )}
      </Card>
    ),

    /* What the balances do not know about yet. */
    inbox: (sizeClass) => <FinancialInboxWidget wallets={data.wallets} className={sizeClass || undefined} />,

    /* ---- Gateway to /analytics ----
       Full width and last by default, so it reads as "there is more, through
       here" rather than competing with the figures above it.

       It carries real weight on a phone: the gesture arc is capped at five
       items and Analytics did not make the cut, so this card is the only
       way onto that screen below 1000px. A whole card rather than a button
       for the same reason — it has to be findable, not just present. */
    analytics: (sizeClass) => (
      <button
        type="button"
        className={cx('card bento-item--full analytics-cta', sizeClass)}
        onClick={() => onNavigate('analytics')}
      >
        <span className="analytics-cta-mark" aria-hidden="true">
          <Icon icon={ChartNoAxesCombined} />
        </span>
        <span className="analytics-cta-body">
          <span className="analytics-cta-title">{t('analytics.title')}</span>
          <span className="analytics-cta-sub">{t('analytics.subtitle')}</span>
        </span>
        <Icon icon={ArrowRight} size="sm" className="analytics-cta-arrow" />
      </button>
    ),
  };

  /* A collapsed card on Home: its title and a way back. Expanding saves. */
  const collapsedBar = (id: HomeCardId, sizeClass: string) => {
    const def = HOME_CARDS.find((item) => item.id === id)!;
    const title = t(def.titleKey);
    return (
      <section className={cx('card lcollapsed', sizeClass)} aria-label={title}>
        <span className="lcollapsed-title truncate">{title}</span>
        <Button
          size="sm"
          variant="ghost"
          aria-expanded={false}
          aria-label={t('layout.expandCard', { title })}
          onClick={() =>
            isPlaced(gridLayout)
              ? saveGridLayout(setGridCardFlags(gridLayout, id, { collapsed: false }))
              : saveLayout(updateCard(layout, HOME_CARDS, id, { collapsed: false }))
          }
        >
          <Icon icon={ChevronDown} size="sm" />
          {t('layout.expand')}
        </Button>
      </section>
    );
  };

  /* Below 1000px: the registry's own order, no size classes — the bento as it
     always was. At 1000px and up: the layout's order and drawn widths, hidden
     cards left out. A saved custom layout also turns off `dense`, so a card
     stays exactly where it was put instead of back-filling an earlier gap. */
  const placed = layoutActive
    ? layout.cards
        .filter((card) => !card.hidden)
        .map((card) => ({ id: card.id, sizeClass: `lspan-${spans[card.id] ?? card.w}`, tall: card.h === 'tall', collapsed: !!card.collapsed }))
    : HOME_CARDS.map((def) => ({ id: def.id, sizeClass: '', tall: false, collapsed: false }));

  /* A placed layout: each card in its own cells, sized in rows, its content
     filling exactly that. Cards are in reading order, so Tab and a screen
     reader go top to bottom, left to right. */
  const plainBento = placedLayout ? (
    <div ref={setGridElement} className="bento layout-12 is-custom is-placed">
      {readingOrder(placedLayout.cards).map((card) => (
        <div key={card.id} className="lplace" style={gridArea(card)}>
          {card.collapsed ? collapsedBar(card.id, '') : homeCards[card.id]('', false, true)}
        </div>
      ))}
    </div>
  ) : (
    <div
      ref={setGridElement}
      className={cx('bento', layoutActive && 'layout-12', layoutActive && isCustom && 'is-custom')}
    >
      {placed.map((item) => (
        <Fragment key={item.id}>
          {item.collapsed ? collapsedBar(item.id, item.sizeClass) : homeCards[item.id](item.sizeClass, item.tall, false)}
        </Fragment>
      ))}
    </div>
  );

  const finishEditing = (next: GridLayout<HomeCardId> | null) => {
    if (next && serializeGridLayout(next) !== draftStart.current) {
      saveGridLayout(next);
      toast.success(t('layout.saved'));
    }
    setHomeEditing(false);
  };

  const bento = (
    <>
    {/* ---- Bento: panels sized by importance rather than a uniform grid ---- */}
    {editing && draft ? (
      <Suspense fallback={plainBento}>
        <CardLayoutEditor
          registry={HOME_CARDS}
          draft={draft}
          onChange={(next) => setDraft(next as GridLayout<HomeCardId>)}
          metrics={gridMetrics}
          renderCard={(id) => homeCards[id as HomeCardId]('', false, true)}
          gridRef={setGridElement}
          gridClassName="bento layout-12 is-custom is-placed"
          onDone={() => finishEditing(draft)}
          onCancel={() => finishEditing(null)}
          onReset={() => {
            resetLayout();
            setHomeEditing(false);
            toast.success(t('layout.resetDone'));
          }}
        />
      </Suspense>
    ) : (
      plainBento
    )}
    </>
  );

  /* "Good evening, Nob" — or just "Good evening" without a name. */
  const hour = new Date().getHours();
  const greetingPart = hour < 12 ? 'Morning' : hour < 18 ? 'Afternoon' : 'Evening';
  const displayName = user?.displayName?.trim();

  return (
    <>
      {/* ---- Hero: one headline figure, everything else deliberately quieter ---- */}
      <section className={cx('hero', mobileV2 && 'home-hero')}>
        {mobileV2 && (
          <p className="home-greeting">
            {displayName
              ? t(`home.greeting${greetingPart}Name` as const, { name: displayName })
              : t(`home.greeting${greetingPart}` as const)}
          </p>
        )}
        <div className="hero-primary">
          <SwipeableBalanceCard
            splitDecimals={mobileV2}
            currencyChip={mobileV2 ? format.display : undefined}
            label={
              showingHistorical
                ? t('dashboard.endOfMonthBalance', { month: formatPeriod(period, locale) })
                : `${t('dashboard.netWorth')} · ${formatPeriod(period, locale)}`
            }
            views={balanceViews}
            actions={
              /* Outside the scroller on purpose: these act on the card, not on
                 the reading being shown, and a refresh button that swiped away
                 with the figure would be a button you have to chase. */
              <div className="cluster" style={{ gap: 4 }}>
                {canTimeTravel && (
                  /* One button, not a segmented control: there are exactly two
                     readings and the label above already says which one is
                     showing, so a second persistent control would restate it. */
                  <Button
                    size="sm"
                    variant="ghost"
                    className={cx('hero-timetravel', showingHistorical && 'is-active')}
                    aria-pressed={showingHistorical}
                    title={
                      showingHistorical
                        ? t('dashboard.showCurrentBalance')
                        : t('dashboard.showEndOfMonthBalance')
                    }
                    aria-label={
                      showingHistorical
                        ? t('dashboard.showCurrentBalance')
                        : t('dashboard.showEndOfMonthBalance')
                    }
                    onClick={() => setOverride({ period, historical: !showingHistorical })}
                  >
                    <Icon icon={showingHistorical ? History : Wallet} size="sm" />
                  </Button>
                )}
                <RefreshButton
                  onRefresh={() => Promise.all([refresh(), portfolio.refresh(), goals.refresh()])}
                  busy={isValidating}
                  label={t('dashboard.refresh')}
                />
              </div>
            }
          >
            {/* The indicator that this is not present-day money. Stated in
                words under the figure rather than only as an icon, because the
                one mistake this feature can cause — reading a March balance as
                your current one — is expensive and silent. */}
            {showingHistorical && (
              <span className="hero-timetravel-note">
                <Icon icon={History} size="sm" />
                {t('dashboard.asItStood', { date: formatDate(data.asOfDate ?? '', locale) })}
                {hasPositions && <em>{t('dashboard.holdingsAtCost')}</em>}
              </span>
            )}
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
          </SwipeableBalanceCard>
        </div>

        {mobileV2 && onQuickAdd && (
          <div className="home-actions" role="group" aria-label={t('home.quickAdd')}>
            {QUICK_TYPES.map((option) => (
              <button
                key={option.type}
                type="button"
                className={cx('home-action', `is-${option.type}`)}
                onClick={() => onQuickAdd(option.type)}
              >
                <Icon icon={option.icon} size="sm" />
                {t(option.label)}
              </button>
            ))}
          </div>
        )}

        {!mobileV2 && metrics}
      </section>

      {mobileV2 ? (
        /* The content sheet: rounded top corners over the hero's foot, the
           metrics first, then every panel in the same order as always. */
        <div className="home-sheet">
          {metrics}
          {bento}
        </div>
      ) : (
        bento
      )}

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
