import {
  ChevronLeft,
  ChevronRight,
  LayoutDashboard,
  LogOut,
  Receipt,
  Repeat2,
  Settings,
  Target,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useState } from 'react';

import { refreshPrefixes } from '../api/cache';
import { prefetch, useExcelDB, useExcelQuery } from '../hooks/useExcelDB';
import { useOverdueSubscriptionAlert } from '../hooks/useOverdueAlert';
import { currentPeriod, cx, formatPeriod, shiftPeriod } from '../lib/format';
import { Route, useRoute } from '../lib/router';
import { BudgetsPage } from '../pages/BudgetsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { InvestmentsPage } from '../pages/InvestmentsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { SubscriptionsPage } from '../pages/SubscriptionsPage';
import { TransactionsPage } from '../pages/TransactionsPage';
import { WalletsPage } from '../pages/WalletsPage';
import { useAuth } from '../state/AuthContext';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { DbHealth, Transaction, WalletBalance } from '../types';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { QuickTransactionWidget } from './QuickTransactionWidget';
import { TransactionForm, TransactionPayload } from './TransactionForm';
import { Alert, Button, RefreshButton } from './ui';

const NAV: { route: Route; label: string; icon: LucideIcon }[] = [
  { route: 'dashboard', label: 'Overview', icon: LayoutDashboard },
  { route: 'wallets', label: 'Wallets', icon: Wallet },
  { route: 'transactions', label: 'Activity', icon: Receipt },
  { route: 'investments', label: 'Invest', icon: TrendingUp },
  { route: 'budgets', label: 'Budgets', icon: Target },
  { route: 'subscriptions', label: 'Recurring', icon: Repeat2 },
];

/**
 * Settings lives in the topbar instead of the nav lists — icon only, on every
 * breakpoint. Kept in the same shape as a NAV row so the topbar title lookup
 * below can treat it as one.
 */
const SETTINGS_ITEM: { route: Route; label: string; icon: LucideIcon } = {
  route: 'settings',
  label: 'Settings',
  icon: Settings,
};

/**
 * What each tab needs before it can paint. Warmed on hover — a pointer takes
 * 200-400ms to travel and click, which buys a meaningful head start on a
 * request that takes 1-3s.
 */
function warmRoute(route: Route, period: string): void {
  switch (route) {
    case 'dashboard':
      prefetch('/api/dashboard', { period });
      break;
    case 'wallets':
      prefetch('/api/wallets', { includeArchived: true });
      break;
    case 'transactions':
      prefetch('/api/transactions', { period });
      prefetch('/api/wallets', { includeArchived: true });
      break;
    case 'investments':
      prefetch('/api/investments');
      prefetch('/api/wallets');
      break;
    case 'budgets':
      prefetch('/api/budgets', { period });
      prefetch('/api/wallets');
      break;
    case 'subscriptions':
      prefetch('/api/subscriptions');
      prefetch('/api/wallets');
      break;
    default:
      break;
  }
}

/**
 * What the topbar's Refresh button re-fetches, per route.
 *
 * Deliberately the same map as `warmRoute` above, one level less precise: these
 * are cache-key *prefixes*, so `/api/transactions` also catches the cached
 * copies carrying query params. Settings is absent because its data does not
 * live in this cache — see `refreshCurrentRoute` below.
 */
const ROUTE_DATA: Record<Route, string[]> = {
  dashboard: ['/api/dashboard'],
  wallets: ['/api/wallets'],
  transactions: ['/api/transactions', '/api/wallets'],
  investments: ['/api/investments', '/api/wallets'],
  budgets: ['/api/budgets', '/api/wallets'],
  subscriptions: ['/api/subscriptions', '/api/wallets'],
  settings: ['/api/health'],
};

/** Warns when database.xlsx can't be written — almost always "open in Excel". */
function DbStatusBanner() {
  const { data } = useExcelQuery<DbHealth>('/api/health', undefined, { refreshInterval: 20_000 });
  const [dismissed, setDismissed] = useState(false);

  if (!data || dismissed) return null;
  if (!data.fileLocked && !data.lastError) return null;

  return (
    <Alert
      tone={data.fileLocked ? 'warning' : 'error'}
      title={data.fileLocked ? 'database.xlsx is open elsewhere' : 'Could not save the workbook'}
      onDismiss={() => setDismissed(true)}
    >
      {data.hint ?? data.lastError}
    </Alert>
  );
}

export function AppShell() {
  const [route, go] = useRoute();
  const { user, logout } = useAuth();
  const { settings, reload: reloadSettings } = useSettings();
  const money = useMoneyFormatter();
  const [period, setPeriod] = useState(currentPeriod());

  /* Raises the "you have unpaid subscriptions" toast once per app open. Lives
     here rather than on the Recurring page precisely because the point is to
     catch bills the user has not gone looking for. */
  useOverdueSubscriptionAlert();

  /* ---- Quick add ----
     The floating button lives at the shell level so it is reachable from every
     route, which means the full-form fallback has to live here too.

     `enabled: false` on the transactions collection is deliberate: this mount
     only ever *writes*. Subscribing would fetch an unscoped 500-row list on
     every app open for data nothing on screen is showing. Writes still reach
     every cached copy — `mutateMatching` patches by key prefix, so a row added
     from the Overview page appears in Activity's month-scoped list too. */
  const [quickFormOpen, setQuickFormOpen] = useState(false);
  const quickWallets = useExcelDB<WalletBalance>('wallets');
  const quickTransactions = useExcelDB<Transaction>('transactions', undefined, { enabled: false });

  function saveQuickTransaction(payload: TransactionPayload) {
    // Optimistic, like every other write: the row is cached before this
    // resolves, so the sheet closes now and a failure toasts and rolls back.
    quickTransactions.create(payload).catch(() => undefined);
    setQuickFormOpen(false);
    return Promise.resolve();
  }

  /**
   * Re-fetches whatever the current screen is showing. Settings keeps its row
   * in SettingsContext rather than the request cache, so it needs its own
   * reload alongside the cached health check.
   */
  const refreshCurrentRoute = useCallback(async () => {
    const work: Promise<unknown>[] = [refreshPrefixes(ROUTE_DATA[route])];
    if (route === 'settings') work.push(reloadSettings());
    await Promise.all(work);
  }, [route, reloadSettings]);

  const active = [...NAV, SETTINGS_ITEM].find((item) => item.route === route) ?? NAV[0];
  const showPeriodPicker = route === 'dashboard' || route === 'budgets' || route === 'transactions';

  return (
    <div className="shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo size={30} /> Quick Wallet
        </div>
        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <button
              key={item.route}
              type="button"
              className={cx('sidebar-item', route === item.route && 'is-active')}
              aria-current={route === item.route ? 'page' : undefined}
              onMouseEnter={() => warmRoute(item.route, period)}
              onFocus={() => warmRoute(item.route, period)}
              onClick={() => go(item.route)}
            >
              <Icon icon={item.icon} />
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div>
            Signed in as <strong>{user?.displayName}</strong>
          </div>
          <Button variant="ghost" size="sm" onClick={logout}>
            <Icon icon={LogOut} size="sm" />
            Sign out
          </Button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          {/* Only visible on phones, where the sidebar (and its brand) is hidden. */}
          <Logo size={30} className="topbar-logo" label="Quick Wallet" />
          <div className="topbar-title">
            <h1>{active.label}</h1>
            <span>
              {money.converting ? `${money.base} → ${money.display}` : money.base} ·{' '}
              {formatPeriod(period, settings.locale)}
            </span>
          </div>
          <div className="topbar-tools">
            {showPeriodPicker && (
              /* Three controls grouped so they read as a single month stepper. */
              <div className="period-nav">
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPeriod((p) => shiftPeriod(p, -1))}
                  aria-label="Previous month"
                >
                  <Icon icon={ChevronLeft} size="sm" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPeriod(currentPeriod())}
                  disabled={period === currentPeriod()}
                >
                  Today
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPeriod((p) => shiftPeriod(p, 1))}
                  aria-label="Next month"
                >
                  <Icon icon={ChevronRight} size="sm" />
                </Button>
              </div>
            )}
            <RefreshButton onRefresh={refreshCurrentRoute} label="Refresh this page" />

            <Button
              size="sm"
              variant="ghost"
              className={cx('topbar-settings', route === 'settings' && 'is-active')}
              aria-label="Settings"
              aria-current={route === 'settings' ? 'page' : undefined}
              title="Settings"
              onClick={() => go('settings')}
            >
              <Icon icon={SETTINGS_ITEM.icon} size="sm" />
            </Button>
          </div>
        </header>

        <main className="page">
          <DbStatusBanner />

          {route === 'dashboard' && <DashboardPage period={period} onNavigate={go} />}
          {route === 'wallets' && <WalletsPage />}
          {route === 'transactions' && <TransactionsPage period={period} />}
          {route === 'investments' && <InvestmentsPage />}
          {route === 'budgets' && <BudgetsPage period={period} />}
          {route === 'subscriptions' && <SubscriptionsPage />}
          {route === 'settings' && <SettingsPage />}
        </main>
      </div>

      <QuickTransactionWidget
        wallets={quickWallets.items}
        onOpenFullForm={() => setQuickFormOpen(true)}
      />

      <TransactionForm
        open={quickFormOpen}
        wallets={quickWallets.items.filter((w) => !w.archived)}
        busy={quickTransactions.mutating}
        error={quickTransactions.mutationError}
        onClose={() => {
          setQuickFormOpen(false);
          quickTransactions.clearMutationError();
        }}
        onSubmit={saveQuickTransaction}
      />

      <nav className="tabbar" aria-label="Main navigation">
        {NAV.map((item) => (
          <button
            key={item.route}
            type="button"
            className={cx('tabbar-item', route === item.route && 'is-active')}
            aria-current={route === item.route ? 'page' : undefined}
            // On touch there is no hover, but touchstart still lands ~100ms
            // before the click resolves.
            onTouchStart={() => warmRoute(item.route, period)}
            onClick={() => go(item.route)}
          >
            <span className="tab-icon">
              <Icon icon={item.icon} />
            </span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
