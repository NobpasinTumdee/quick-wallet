import { Suspense, type ReactNode } from 'react';
import type { TFunction } from 'i18next';

import { AnalyticsHeatmap } from './AnalyticsHeatmap';
import { AnalyticsPayees } from './AnalyticsPayees';
import { CategoryBoxPlotCard } from './CategoryBoxPlotCard';
import { CategoryPieChartCard } from './CategoryPieChartCard';
import { SubscriptionHeatmapCard } from './SubscriptionHeatmapCard';
import { Card } from './ui';
import { cx, formatPeriod } from '../lib/format';
import type { AnalyticsCardId } from '../lib/layout/analyticsCards';
import { lazyWithRetry } from '../lib/lazyWithRetry';
import type { Route } from '../lib/router';
import type { useMoneyFormatter } from '../state/SettingsContext';
import type { DashboardSummary, Transaction, WalletBalance } from '../types';

/* Recharts is ~300kB and these cards need it. Split so the route pays for it
   on arrival rather than every other screen paying at boot. */
const CashFlowSankey = lazyWithRetry(() =>
  import('./CashFlowSankey').then((m) => ({ default: m.CashFlowSankey })),
);
const NetWorthProjection = lazyWithRetry(() =>
  import('./NetWorthProjection').then((m) => ({ default: m.NetWorthProjection })),
);
const AnalyticsSavingsRate = lazyWithRetry(() =>
  import('./AnalyticsSavingsRate').then((m) => ({ default: m.AnalyticsSavingsRate })),
);
const AnalyticsCategories = lazyWithRetry(() =>
  import('./AnalyticsCategories').then((m) => ({ default: m.AnalyticsCategories })),
);

/** What the Analytics cards are drawn from. */
export interface AnalyticsCardContext {
  t: TFunction;
  period: string;
  locale: string;
  money: ReturnType<typeof useMoneyFormatter>;
  data: DashboardSummary | null | undefined;
  monthTransactions: { items: Transaction[]; initialLoading: boolean; isValidating: boolean };
  wallets: WalletBalance[];
  onNavigate?: (route: Route) => void;
  /** Home only: an extra control at the end of each card's header (Open in Analytics). */
  headerExtra?: ReactNode;
}

/**
 * One Analytics card, given the class that sizes it on the desktop grid
 * (empty elsewhere) and `fill`: sized in grid rows (a placed layout), so the
 * charts that can take the height left in their card do. The markup is exactly the page's own; only where each
 * card goes comes from the layout. Every card reads the dashboard payload
 * and this month's transactions, both cached by the app, or fetches what it
 * needs itself (the bills calendar, the two range-picker cards).
 */
export function renderAnalyticsCard(
  id: AnalyticsCardId,
  sizeClass: string,
  ctx: AnalyticsCardContext,
  fill = false,
): ReactNode {
  const { t, period, locale, money, data, monthTransactions, wallets, onNavigate, headerExtra } = ctx;
  const trend = data?.trend ?? [];
  switch (id) {
    /* First, and full width. Every other widget here looks backwards at money
       already gone; this is the only one that looks forward, and a bottleneck
       three weeks out is worth more than any of them. Full width because the
       grid is seven columns of calendar plus an insights row — it does not
       tile into a half. */
    case 'bills':
      return <SubscriptionHeatmapCard period={period} className={cx('bento-item--full', sizeClass)} onNavigate={onNavigate} headerExtra={headerExtra} />;

    case 'savingsRate':
      return (
        <Card
          className={cx('bento-item', sizeClass)}
          title={t('analytics.savingsRateTitle')}
          subtitle={t('analytics.savingsRateSubtitle')}
          actions={headerExtra}
        >
          <Suspense fallback={<div className="proj proj--loading" aria-hidden="true" />}>
            <AnalyticsSavingsRate trend={trend} money={money} locale={locale} fill={fill} />
          </Suspense>
        </Card>
      );

    /* Paired with the treemap on purpose. The two read the same composition
       differently: a donut is good at "what share", a treemap at "how do the
       small ones compare", and side by side neither has to be both. They
       share `categoryComposition`, so the parts always agree. */
    case 'categoryPie':
      return <CategoryPieChartCard className={cx('bento-item--half', sizeClass)} period={period} headerExtra={headerExtra} />;

    case 'categoryTree':
      return (
        <Card
          className={cx('bento-item--half', sizeClass)}
          title={t('analytics.categoriesTitle')}
          subtitle={t('analytics.categoriesSubtitle')}
          actions={headerExtra}
        >
          <Suspense fallback={<div className="atree atree--loading" aria-hidden="true" />}>
            <AnalyticsCategories transactions={monthTransactions.items} money={money} fill={fill} />
          </Suspense>
        </Card>
      );

    case 'spendHeatmap':
      return (
        <Card
          className={cx('bento-item--half', sizeClass)}
          title={t('analytics.heatmapTitle')}
          subtitle={formatPeriod(period, locale)}
          actions={headerExtra}
        >
          <AnalyticsHeatmap transactions={monthTransactions.items} period={period} money={money} locale={locale} />
        </Card>
      );

    /* Full width: the x-axis is one band per category and the plot scrolls
       horizontally when it runs out of room, so a half-card would put it in
       a scroller at every breakpoint. */
    case 'categoryBoxplot':
      return <CategoryBoxPlotCard period={period} className={cx('bento-item--full', sizeClass)} headerExtra={headerExtra} />;

    case 'payees':
      return (
        <Card
          className={cx('bento-item--half', sizeClass)}
          title={t('analytics.merchantsTitle')}
          subtitle={t('analytics.merchantsSubtitle')}
          actions={headerExtra}
          padded={false}
        >
          <AnalyticsPayees transactions={monthTransactions.items} money={money} locale={locale} />
        </Card>
      );

    /* Migrated off the Overview screen. */
    case 'sankey':
      return (
        <Suspense
          fallback={<div className={cx('card bento-item--full sankey-placeholder', sizeClass)} aria-hidden="true" />}
        >
          <CashFlowSankey
            className={cx('bento-item--full', sizeClass)}
            transactions={monthTransactions.items}
            wallets={wallets}
            period={period}
            loading={monthTransactions.initialLoading}
            stale={monthTransactions.isValidating}
            headerExtra={headerExtra}
          />
        </Suspense>
      );

    case 'projection':
      return (
        <Card
          className={cx('bento-item--full', sizeClass)}
          title={t('analytics.projectionTitle')}
          subtitle={t('analytics.projectionSubtitle')}
          actions={headerExtra}
        >
          <Suspense fallback={<div className="proj proj--loading" aria-hidden="true" />}>
            <NetWorthProjection startingNetWorth={data?.netWorth ?? 0} trend={trend} money={money} locale={locale} fill={fill} />
          </Suspense>
        </Card>
      );
  }
}
