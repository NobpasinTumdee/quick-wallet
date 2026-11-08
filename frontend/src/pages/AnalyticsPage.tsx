import { ArrowUpRight, CalendarCheck, ChartNoAxesCombined, Database } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { renderAnalyticsCard } from '../components/AnalyticsCards';
import {
  CardBoardArrange,
  CardBoardArrangeEmpty,
  CardBoardArrangeLink,
  CardBoardConfig,
  CardBoardGrid,
  useCardBoard,
} from '../components/CardBoard';
import { Icon } from '../components/Icon';
import { renderCardSkeleton } from '../components/skeleton/cardSkeletons';
import { Card, EmptyState } from '../components/ui';
import { useExcelDB, useExcelQuery } from '../hooks/useExcelDB';
import {
  ANALYTICS_CARDS,
  ANALYTICS_LAYOUT_PAGE,
  ANALYTICS_TABLET_HALVES,
  type AnalyticsCardId,
} from '../lib/layout/analyticsCards';
import { ANALYTICS_ARRANGE_ENTRY, ANALYTICS_ARRANGE_TEXTS } from '../lib/layout/arrangeTexts';
import { ANALYTICS_EDIT_PAGE } from '../lib/layout/homeEditStore';
import { currentPeriod, cx, formatPeriod, shiftPeriod } from '../lib/format';
import { ANALYTICS_ORDER_FORMAT } from '../lib/layout/layoutFormats';
import { Route, navigate, openReview } from '../lib/router';
import { useAuth } from '../state/AuthContext';
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

/** The Analytics cards and where their layouts are kept (see CardBoard). */
const ANALYTICS_BOARD: CardBoardConfig<AnalyticsCardId> = {
  editPage: ANALYTICS_EDIT_PAGE,
  gridPage: ANALYTICS_LAYOUT_PAGE,
  orderFormat: ANALYTICS_ORDER_FORMAT,
  registry: ANALYTICS_CARDS,
  halves: ANALYTICS_TABLET_HALVES,
  /* The Deep Analytics link: first, full width, never moved. */
  leadCount: 1,
  arrange: { texts: ANALYTICS_ARRANGE_TEXTS, entry: ANALYTICS_ARRANGE_ENTRY },
  editorTexts: {
    editTitle: 'layout.editTitleAnalytics',
    resetTitle: 'layout.resetTitleAnalytics',
    hiddenNone: 'layout.hiddenNoneAnalytics',
    announceStart: 'layout.announceStartAnalytics',
  },
  messages: { saved: 'layout.saved', resetDone: 'layout.resetDone' },
};

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
  const { user } = useAuth();
  const board = useCardBoard(ANALYTICS_BOARD, user?.id);

  const trend = data?.trend ?? [];

  /* The launch point for Deep Analytics, which is now its own route. A plain
     navigation, so this page imports nothing of the explorer: the page itself is
     `lazyWithRetry()` in AppShell, and nothing here can pull it into the main bundle.

     Rendered in both the full page and the empty state — a user with no
     spending yet may still have debts, goals or investments worth exploring,
     and the empty state must not wall them off. */
  /* The month review beside it: this month's when a past month is shown,
     otherwise last month's (the latest finished one). */
  const reviewMonth = period < currentPeriod() ? period : shiftPeriod(currentPeriod(), -1);
  const deep = (
    /* One lead for the grid (leadCount 1): full width on the 12-column grid
       too (lspan-12; nothing below 1000px), the two links side by side from
       640px, so the cards below stay where they were on a wider screen. */
    <div className={cx('analytics-leads bento-item--full', board.layoutActive && 'lspan-12')}>
    <button
      type="button"
      className="deep-entry"
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
    <button type="button" className="deep-entry" onClick={() => openReview(reviewMonth)}>
      <span className="deep-entry-mark" aria-hidden="true">
        <Icon icon={CalendarCheck} />
      </span>
      <span className="deep-entry-text">
        <strong>{t('review.analyticsTitle')}</strong>
        <span>{t('review.analyticsHint', { month: formatPeriod(reviewMonth, locale) })}</span>
      </span>
      <Icon icon={ArrowUpRight} size="sm" className="deep-entry-arrow" />
    </button>
    </div>
  );

  /* Each card's skeleton in its saved place and size, the Deep Analytics
     link real (it needs no data), and one "Loading…" for the page. */
  if (initialLoading || monthTransactions.initialLoading) {
    return (
      <>
        <CardBoardGrid
          board={board}
          lead={deep}
          loading
          renderCard={() => null}
          skeleton={(id, sizeClass, minHeight) => renderCardSkeleton(id, { sizeClass, minHeight })}
          empty={<CardBoardArrangeEmpty board={board} />}
        />
        {!board.layoutActive && board.placed.length > 0 && (
          <div className="page-arrange">
            <CardBoardArrangeLink board={board} />
          </div>
        )}
        <CardBoardArrange board={board} />
      </>
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
    <>
    <CardBoardGrid
      board={board}
      lead={deep}
      renderCard={(id, sizeClass, _tall, fill) =>
        renderAnalyticsCard(id, sizeClass, {
          t,
          period,
          locale,
          money,
          data,
          monthTransactions,
          wallets: wallets.items,
          onNavigate,
        }, fill)
      }
      /* Every card hidden on a phone: the Deep Analytics link stays, with a way back. */
      empty={<CardBoardArrangeEmpty board={board} />}
    />
    {/* New layout: the link sits in the page's bottom padding, out of the
        flow, so the cards and the page's height do not move (see CSS). */}
    {!board.layoutActive && board.placed.length > 0 && (
      <div className="page-arrange">
        <CardBoardArrangeLink board={board} />
      </div>
    )}
    <CardBoardArrange board={board} />
    </>
  );
}
