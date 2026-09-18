import { ArrowUpRight, ChartNoAxesCombined, Database } from 'lucide-react';
import { Suspense, lazy } from 'react';
import { useTranslation } from 'react-i18next';

import { AnalyticsHeatmap } from '../components/AnalyticsHeatmap';
import { AnalyticsPayees } from '../components/AnalyticsPayees';
import { CategoryBoxPlotCard } from '../components/CategoryBoxPlotCard';
import { CategoryPieChartCard } from '../components/CategoryPieChartCard';
import { Icon } from '../components/Icon';
import { SubscriptionHeatmapCard } from '../components/SubscriptionHeatmapCard';
import { Card, EmptyState } from '../components/ui';
import { useExcelDB, useExcelQuery } from '../hooks/useExcelDB';
import { formatPeriod } from '../lib/format';
import { Route, navigate } from '../lib/router';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { DashboardSummary, Transaction, WalletBalance } from '../types';

/**
 * The analytics hub.
 *
 * ---------------------------------------------------------------------------
 * WHY TWO WIDGETS LEFT THE DASHBOARD
 * ---------------------------------------------------------------------------
 * The cash-flow Sankey and the ten-year projection are both *study* pieces: you
 * open them to think, not to check something. On the Overview screen they
 * pushed the figures people actually glance at — balances, budget progress,
 * what went out today — below the fold. Here they sit with the other lean-back
 * views, and the dashboard gets its job back.
 *
 * ---------------------------------------------------------------------------
 * NO ENDPOINT OF ITS OWN
 * ---------------------------------------------------------------------------
 * Every widget reads the dashboard payload plus this month's transactions, both
 * of which the app already caches. Arriving from the Overview screen costs
 * nothing — the rows are warm — and `warmRoute` primes them from a hover.
 */

/* Recharts is ~300kB and three of these cards need it. Split so the route pays
   for it on arrival rather than every other screen paying at boot. */
const CashFlowSankey = lazy(() =>
  import('../components/CashFlowSankey').then((m) => ({ default: m.CashFlowSankey })),
);
const NetWorthProjection = lazy(() =>
  import('../components/NetWorthProjection').then((m) => ({ default: m.NetWorthProjection })),
);
const AnalyticsSavingsRate = lazy(() =>
  import('../components/AnalyticsSavingsRate').then((m) => ({ default: m.AnalyticsSavingsRate })),
);
const AnalyticsCategories = lazy(() =>
  import('../components/AnalyticsCategories').then((m) => ({ default: m.AnalyticsCategories })),
);

export function AnalyticsPage({
  period,
  onNavigate,
}: {
  period: string;
  onNavigate?: (route: Route) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const locale = settings.locale;

  const { data, initialLoading } = useExcelQuery<DashboardSummary>('/api/dashboard', { period });
  const monthTransactions = useExcelDB<Transaction>('transactions', { period });
  const wallets = useExcelDB<WalletBalance>('wallets');

  const trend = data?.trend ?? [];

  /* The launch point for Deep Analytics, which is now its own route. A plain
     navigation, so this page imports nothing of the explorer: the page itself is
     `lazy()` in AppShell, and nothing here can pull it into the main bundle.

     Rendered in both the full page and the empty state — a user with no
     spending yet may still have debts, goals or investments worth exploring,
     and the empty state must not wall them off. */
  const deep = (
    <button
      type="button"
      className="deep-entry bento-item--full"
      onClick={() => (onNavigate ?? navigate)('deep-analytics')}
      aria-label={t('explorer.entryAria')}
    >
      <span className="deep-entry-mark" aria-hidden="true">
        <Icon icon={Database} />
      </span>
      <span className="deep-entry-text">
        <strong>{t('explorer.entryTitle')}</strong>
        <span>{t('explorer.entryHint')}</span>
      </span>
      <Icon icon={ArrowUpRight} size="sm" className="deep-entry-arrow" />
    </button>
  );

  /* One empty state for the page beats six cards each drawing their own
     skeleton — this screen is read as a whole, not card by card. */
  if (initialLoading || monthTransactions.initialLoading) {
    return (
      <Card title={t('analytics.title')} subtitle={t('analytics.subtitle')}>
        <EmptyState
          icon={<Icon icon={ChartNoAxesCombined} size="xl" />}
          title={t('common.loading')}
          description=""
        />
      </Card>
    );
  }

  const hasSpending = monthTransactions.items.some((tx) => tx.type === 'expense');
  const hasHistory = trend.some((month) => month.income > 0 || month.expense > 0);

  if (!hasSpending && !hasHistory) {
    return (
      <div className="stack">
        {deep}
        <Card title={t('analytics.title')} subtitle={t('analytics.subtitle')}>
          <EmptyState
            icon={<Icon icon={ChartNoAxesCombined} size="xl" />}
            title={t('analytics.empty')}
            description={t('analytics.emptyHint')}
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="bento">
      {deep}

      {/* First, and full width. Every other widget here looks backwards at
          money already gone; this is the only one that looks forward, and a
          bottleneck three weeks out is worth more than any of them. Full width
          because the grid is seven columns of calendar plus an insights row —
          it does not tile into a half. */}
      <SubscriptionHeatmapCard period={period} className="bento-item--full" onNavigate={onNavigate} />

      <Card
        className="bento-item"
        title={t('analytics.savingsRateTitle')}
        subtitle={t('analytics.savingsRateSubtitle')}
      >
        <Suspense fallback={<div className="proj proj--loading" aria-hidden="true" />}>
          <AnalyticsSavingsRate trend={trend} money={money} locale={locale} />
        </Suspense>
      </Card>

      {/* Full width: twelve months of a time series, the same argument the
          income-vs-spending chart makes on the Overview screen. It also keeps
          the half-card count even — an odd one strands itself beside a
          three-column hole. */}

      {/* Paired with the treemap on purpose. The two read the same
          composition differently: a donut is good at "what share", a treemap at
          "how do the small ones compare", and side by side neither has to be
          both. They share `categoryComposition`, so the parts always agree. */}
      <CategoryPieChartCard className="bento-item--half" period={period} />

      <Card
        className="bento-item--half"
        title={t('analytics.categoriesTitle')}
        subtitle={t('analytics.categoriesSubtitle')}
      >
        <Suspense fallback={<div className="atree atree--loading" aria-hidden="true" />}>
          <AnalyticsCategories transactions={monthTransactions.items} money={money} />
        </Suspense>
      </Card>

      <Card
        className="bento-item--half"
        title={t('analytics.heatmapTitle')}
        subtitle={formatPeriod(period, locale)}
      >
        <AnalyticsHeatmap
          transactions={monthTransactions.items}
          period={period}
          money={money}
          locale={locale}
        />
      </Card>

      {/* Full width: the x-axis is one band per category and the plot scrolls
          horizontally when it runs out of room, so a half-card would put it in
          a scroller at every breakpoint. */}
      <CategoryBoxPlotCard period={period} className="bento-item--full" />

      <Card
        className="bento-item--half"
        title={t('analytics.merchantsTitle')}
        subtitle={t('analytics.merchantsSubtitle')}
        padded={false}
      >
        <AnalyticsPayees transactions={monthTransactions.items} money={money} locale={locale} />
      </Card>

      {/* Full width: a four-column table is the widget here that gains most
          from the extra room, and it pairs the heatmap with the treemap as the
          screen's only half-cards. */}

      {/* ---- Migrated off the Overview screen ---- */}
      <Suspense
        fallback={<div className="card bento-item--full sankey-placeholder" aria-hidden="true" />}
      >
        <CashFlowSankey
          className="bento-item--full"
          transactions={monthTransactions.items}
          wallets={wallets.items}
          period={period}
          loading={monthTransactions.initialLoading}
          stale={monthTransactions.isValidating}
        />
      </Suspense>

      <Card
        className="bento-item--full"
        title={t('analytics.projectionTitle')}
        subtitle={t('analytics.projectionSubtitle')}
      >
        <Suspense fallback={<div className="proj proj--loading" aria-hidden="true" />}>
          <NetWorthProjection
            startingNetWorth={data?.netWorth ?? 0}
            trend={trend}
            money={money}
            locale={locale}
          />
        </Suspense>
      </Card>
    </div>
  );
}
