import { ArrowUpRight } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { renderAnalyticsCard } from './AnalyticsCards';
import { revealCardOn } from './CardBoard';
import { Icon } from './Icon';
import { renderCardSkeleton } from './skeleton/cardSkeletons';
import { Button } from './ui';
import { useExcelDB, useExcelQuery } from '../hooks/useExcelDB';
import type { AnalyticsCardId } from '../lib/layout/analyticsCards';
import { ANALYTICS_EDIT_PAGE } from '../lib/layout/homeEditStore';
import type { TranslationKey } from '../locales/en';
import type { Route } from '../lib/router';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import type { DashboardSummary, Transaction, WalletBalance } from '../types';

/** The cards that read this month's transactions (the rest fetch their own, or read the dashboard). */
const NEEDS_MONTH = new Set<AnalyticsCardId>(['categoryTree', 'spendHeatmap', 'payees', 'sankey']);
/** The cards drawn from the dashboard payload (Home loads it already, same request). */
const NEEDS_DASHBOARD = new Set<AnalyticsCardId>(['savingsRate', 'projection']);

/**
 * A copy of an Analytics card on Home. Mounted only for a card that has been
 * added, so Home without one asks the server for nothing new. What it reads
 * goes through the same cached requests the Analytics page makes (same keys),
 * so the two pages share them; the period is the shell's, the top bar's month.
 * Controls inside the card (a range, a chart/table toggle) are its own, as on
 * any page. "Open in Analytics" goes to that page, same month, scrolled to the card.
 */
export function HomeAnalyticsCard({
  id,
  sizeClass,
  fill,
  period,
  onNavigate,
}: {
  id: AnalyticsCardId;
  sizeClass: string;
  fill: boolean;
  period: string;
  onNavigate: (route: Route) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const needsMonth = NEEDS_MONTH.has(id);
  const needsDashboard = NEEDS_DASHBOARD.has(id);

  const dashboard = useExcelQuery<DashboardSummary>('/api/dashboard', { period }, { enabled: needsDashboard });
  const monthTransactions = useExcelDB<Transaction>('transactions', { period }, { enabled: needsMonth });
  const wallets = useExcelDB<WalletBalance>('wallets', undefined, { enabled: id === 'sankey' });

  const title = t(`catalog.${id}` as TranslationKey);
  const open = (
    <Button
      size="sm"
      variant="ghost"
      aria-label={t('catalog.openInAnalytics', { title })}
      title={t('catalog.openInAnalyticsShort')}
      onClick={() => {
        revealCardOn(ANALYTICS_EDIT_PAGE, id);
        onNavigate('analytics');
      }}
    >
      <Icon icon={ArrowUpRight} size="sm" />
    </Button>
  );

  /* Nothing cached yet: the card's own skeleton at its size (Home's other
     cards are already up). The Sankey draws its own frame. */
  const loading =
    (needsMonth && id !== 'sankey' && monthTransactions.initialLoading) || (needsDashboard && dashboard.initialLoading);
  if (loading) return <>{renderCardSkeleton(id, { sizeClass })}</>;

  return (
    <>
      {renderAnalyticsCard(
        id,
        sizeClass,
        {
          t,
          period,
          locale: settings.locale,
          money,
          data: dashboard.data,
          monthTransactions,
          wallets: wallets.items,
          onNavigate,
          headerExtra: open,
        },
        fill,
      )}
    </>
  );
}
