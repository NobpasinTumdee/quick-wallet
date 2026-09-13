import {
  ChevronLeft,
  ChevronRight,
  CreditCard,
  HandCoins,
  PiggyBank,
  LayoutDashboard,
  Landmark,
  LayoutGrid,
  LogOut,
  ChartNoAxesCombined,
  PanelLeftClose,
  PanelLeftOpen,
  Receipt,
  Repeat2,
  Settings,
  Target,
  TrendingUp,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { refreshPrefixes } from '../api/cache';
import { prefetch, useExcelDB, useExcelQuery } from '../hooks/useExcelDB';
import { useLanguageSync } from '../hooks/useLanguage';
import { useCreditCardDueAlert, useOverdueSubscriptionAlert } from '../hooks/useOverdueAlert';
import { useScrollToTop } from '../hooks/useScrollToTop';
import { useStoredBoolean } from '../hooks/useStoredBoolean';
import { currentPeriod, cx, formatPeriod, shiftPeriod } from '../lib/format';
import { resolveMobileNav } from '../lib/mobileNav';
import { NAV_LABEL_KEYS } from '../lib/navLabels';
import { TranslationKey } from '../locales';
import { Route, useRoute } from '../lib/router';
import { BudgetsPage } from '../pages/BudgetsPage';
import { CreditCardsPage } from '../pages/CreditCardsPage';
import { SharedExpensesPage } from '../pages/SharedExpensesPage';
import { AnalyticsPage } from '../pages/AnalyticsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { DebtManagerPage } from '../pages/DebtManagerPage';
import { GoalsPage } from '../pages/GoalsPage';
import { MoreMenuPage } from '../pages/MoreMenuPage';
import { NotFoundPage } from '../pages/NotFoundPage';
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
import { GestureNavWidget, Shortcut } from './GestureNavWidget';
import { QuickTransactionWidget } from './QuickTransactionWidget';
import { TransactionForm, TransactionPayload } from './TransactionForm';
import { Alert, Button, RefreshButton } from './ui';

/**
 * ---------------------------------------------------------------------------
 * WHY THESE CARRY A KEY AND NOT A LABEL
 * ---------------------------------------------------------------------------
 * This array is module-level — it is built once, when the module is first
 * imported, and never again. A translated string baked in here would therefore
 * be the language that happened to be active at import time, and would keep
 * that language for the rest of the session no matter what the user picked.
 *
 * Holding the *key* instead and resolving it with `t()` at render moves the
 * lookup inside React's render cycle, where `useTranslation` has already
 * subscribed the component to `languageChanged`. Switching language re-renders
 * and every label follows.
 *
 * The payoff is that one change covers four surfaces: the desktop sidebar, the
 * mobile tab bar, the gesture arc's shortcuts and the topbar title all read
 * their text from this one list.
 */
interface NavItem {
  route: Route;
  /** A key into the dictionary — see `src/locales/en.ts`. */
  labelKey: TranslationKey;
  icon: LucideIcon;
}

const NAV: NavItem[] = [
  { route: 'dashboard', labelKey: NAV_LABEL_KEYS.dashboard, icon: LayoutDashboard },
  { route: 'wallets', labelKey: NAV_LABEL_KEYS.wallets, icon: Wallet },
  { route: 'cards', labelKey: NAV_LABEL_KEYS.cards, icon: CreditCard },
  { route: 'transactions', labelKey: NAV_LABEL_KEYS.transactions, icon: Receipt },
  { route: 'investments', labelKey: NAV_LABEL_KEYS.investments, icon: TrendingUp },
  { route: 'analytics', labelKey: NAV_LABEL_KEYS.analytics, icon: ChartNoAxesCombined },
  { route: 'goals', labelKey: NAV_LABEL_KEYS.goals, icon: PiggyBank },
  { route: 'budgets', labelKey: NAV_LABEL_KEYS.budgets, icon: Target },
  { route: 'splits', labelKey: NAV_LABEL_KEYS.splits, icon: HandCoins },
  { route: 'subscriptions', labelKey: NAV_LABEL_KEYS.subscriptions, icon: Repeat2 },
  { route: 'debt', labelKey: NAV_LABEL_KEYS.debt, icon: Landmark },
];

/**
 * Settings lives in the topbar instead of the nav lists — icon only, on every
 * breakpoint. Kept in the same shape as a NAV row so the topbar title lookup
 * below can treat it as one.
 */
const SETTINGS_ITEM: NavItem = {
  route: 'settings',
  labelKey: NAV_LABEL_KEYS.settings,
  icon: Settings,
};

/**
 * The app directory. Also outside NAV, and for the opposite reason to Settings:
 * the sidebar lists every screen already, so a "More" entry there would be a
 * link to a list of the links beside it. It exists for the phone.
 */
const MORE_ITEM: NavItem = {
  route: 'more',
  labelKey: NAV_LABEL_KEYS.more,
  icon: LayoutGrid,
};

/**
 * How the routes split on a phone.
 *
 * ---------------------------------------------------------------------------
 * WHY FOUR TABS AND FIVE ARC SLOTS
 * ---------------------------------------------------------------------------
 * Both numbers are physical, not editorial. Seven tabs across a 320px bar is
 * 45px each — under the 44px touch minimum once padding is removed. Six arc
 * items overlap at that width (see `arcRadius`). So nine slots is what a phone
 * holds, and the app has more screens than that.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LAYOUT IS NOW THE USER'S
 * ---------------------------------------------------------------------------
 * It used to be two hardcoded arrays here, chosen by how often *we* guessed a
 * screen gets opened. That guess is wrong for anyone whose money works
 * differently — somebody paying down three loans wants Debt on the bar far more
 * than Invest. The split now comes from `settings.mobileNavConfig`, and the
 * defaults this file used to hardcode live in `DEFAULT_MOBILE_NAV`.
 *
 * Nothing reads that setting raw: `resolveMobileNav` repairs it first, which is
 * what guarantees four tabs, no duplicates, no dead buttons for retired routes,
 * and — the one rule a user cannot override — a way to reach the directory, and
 * therefore every screen.
 *
 * The desktop sidebar is unaffected: it renders NAV in full and always has.
 */

/** Resolves a route id to its NAV row. Settings and More live outside NAV. */
function navItemFor(route: Route): NavItem {
  return [...NAV, SETTINGS_ITEM, MORE_ITEM].find((item) => item.route === route) ?? NAV[0];
}

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
    case 'cards':
      /* The unscoped ledger, because a statement straddles a month boundary and
         an installment plan runs years out — see useCreditCards. */
      prefetch('/api/wallets', { includeArchived: true });
      prefetch('/api/transactions', { limit: 2000 });
      break;
    case 'transactions':
      prefetch('/api/transactions', { period });
      prefetch('/api/wallets', { includeArchived: true });
      break;
    case 'investments':
      prefetch('/api/investments');
      prefetch('/api/wallets');
      prefetch('/api/watchlist');
      break;
    case 'analytics':
      /* Everything the widgets read is the dashboard payload plus a year of
         rows — no endpoint of its own. */
      prefetch('/api/dashboard', { period });
      prefetch('/api/transactions', { limit: 2000 });
      break;
    case 'goals':
      prefetch('/api/goals');
      prefetch('/api/wallets');
      break;
    case 'debt':
      prefetch('/api/debts');
      prefetch('/api/wallets');
      break;
    case 'budgets':
      prefetch('/api/budgets', { period });
      prefetch('/api/wallets');
      break;
    case 'splits':
      prefetch('/api/bill-splits');
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
  cards: ['/api/wallets', '/api/transactions'],
  transactions: ['/api/transactions', '/api/wallets'],
  investments: ['/api/investments', '/api/wallets', '/api/watchlist'],
  analytics: ['/api/dashboard', '/api/transactions'],
  goals: ['/api/goals', '/api/wallets'],
  debt: ['/api/debts', '/api/wallets'],
  budgets: ['/api/budgets', '/api/wallets'],
  splits: ['/api/bill-splits', '/api/wallets'],
  subscriptions: ['/api/subscriptions', '/api/wallets'],
  settings: ['/api/health'],
  /* Nothing to refresh on screens that show no data. */
  more: [],
  notFound: [],
};

/** Warns when database.xlsx can't be written — almost always "open in Excel". */
function DbStatusBanner() {
  const { t } = useTranslation();
  const { data } = useExcelQuery<DbHealth>('/api/health', undefined, { refreshInterval: 20_000 });
  const [dismissed, setDismissed] = useState(false);

  if (!data || dismissed) return null;
  if (!data.fileLocked && !data.lastError) return null;

  return (
    <Alert
      tone={data.fileLocked ? 'warning' : 'error'}
      title={t(data.fileLocked ? 'settings.workbookLocked' : 'settings.workbookSaveFailed')}
      onDismiss={() => setDismissed(true)}
    >
      {data.hint ?? data.lastError}
    </Alert>
  );
}

export function AppShell() {
  const { t } = useTranslation();
  const [route, go] = useRoute();
  const { user, logout } = useAuth();
  const { settings, reload: reloadSettings } = useSettings();
  const money = useMoneyFormatter();
  const [period, setPeriod] = useState(currentPeriod());

  /* A new screen starts at the top. Keyed on the route alone, so stepping the
     month picker — which changes `period`, not the route — leaves the reader
     where they were. */
  useScrollToTop(route);

  /* The phone's layout, repaired on the way in — see `resolveMobileNav`. Memoed
     on the stored value rather than on `settings`, so an unrelated preference
     change (currency, theme) does not rebuild the nav arrays. */
  const mobileNav = useMemo(
    () => resolveMobileNav(settings.mobileNavConfig),
    [settings.mobileNavConfig],
  );
  /* Split so the bar reads left-to-right around the button: two, button, two. */
  const tabLeft = useMemo(() => mobileNav.tabs.slice(0, 2).map(navItemFor), [mobileNav.tabs]);
  const tabRight = useMemo(() => mobileNav.tabs.slice(2).map(navItemFor), [mobileNav.tabs]);
  const navShortcuts = useMemo<Shortcut[]>(() => mobileNav.arc.map(navItemFor), [mobileNav.arc]);

  /* Raises the "you have unpaid subscriptions" toast once per app open. Lives
     here rather than on the Recurring page precisely because the point is to
     catch bills the user has not gone looking for. */
  /* Adopts the account's saved locale once settings arrive, so signing in on a
     device that has never seen this account still lands in their language. */
  useLanguageSync();

  useOverdueSubscriptionAlert();
  /* And the same for card bills. Separate hook, separate latch: the two depend
     on different requests that resolve at different times, so sharing one would
     let whichever arrived first swallow the other. */
  useCreditCardDueAlert();

  /* ---- Quick add ----
     The floating button lives at the shell level so it is reachable from every
     route, which means the full-form fallback has to live here too.

     `enabled: false` on the transactions collection is deliberate: this mount
     only ever *writes*. Subscribing would fetch an unscoped 500-row list on
     every app open for data nothing on screen is showing. Writes still reach
     every cached copy — `mutateMatching` patches by key prefix, so a row added
     from the Overview page appears in Activity's month-scoped list too. */
  /* Rail mode. Read synchronously from localStorage on first render, so the
     sidebar never paints wide and then snaps shut. */
  const [railed, , toggleRail] = useStoredBoolean('quick-wallet.sidebar-railed', false);

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

  const active = navItemFor(route);

  /** One tab-bar link. Shared by both sides of the centre button. */
  const tab = (item: NavItem) => (
    <button
      key={item.route}
      type="button"
      className={cx('tabbar-item', route === item.route && 'is-active')}
      aria-current={route === item.route ? 'page' : undefined}
      // On touch there is no hover, but touchstart still lands ~100ms before
      // the click resolves.
      onTouchStart={() => warmRoute(item.route, period)}
      onClick={() => go(item.route)}
    >
      <span className="tab-icon">
        <Icon icon={item.icon} />
      </span>
      {t(item.labelKey)}
    </button>
  );
  const showPeriodPicker = route === 'dashboard' || route === 'budgets' || route === 'transactions';

  return (
    <div className={cx('shell', railed && 'is-railed')}>
      <aside className="sidebar">
        <div className="sidebar-brand">
          <Logo size={30} />
          <span className="sidebar-label">{t('auth.appName')}</span>
        </div>

        {/* Only rendered where the sidebar exists at all — below 1000px the tab
            bar takes over and there is nothing to collapse. */}
        <button
          type="button"
          className="sidebar-rail-toggle"
          onClick={toggleRail}
          aria-expanded={!railed}
          aria-label={railed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
          title={railed ? t('nav.expandSidebar') : t('nav.collapseSidebar')}
        >
          <Icon icon={railed ? PanelLeftOpen : PanelLeftClose} size="sm" />
          <span className="sidebar-label">{t('nav.collapse')}</span>
        </button>

        <nav className="sidebar-nav">
          {NAV.map((item) => (
            <button
              key={item.route}
              type="button"
              className={cx('sidebar-item', route === item.route && 'is-active')}
              aria-current={route === item.route ? 'page' : undefined}
              /* The label is hidden visually in rail mode but stays in the DOM,
                 so the accessible name never depends on the width. `title`
                 gives the same thing to a mouse. */
              title={railed ? t(item.labelKey) : undefined}
              onMouseEnter={() => warmRoute(item.route, period)}
              onFocus={() => warmRoute(item.route, period)}
              onClick={() => go(item.route)}
            >
              <Icon icon={item.icon} />
              <span className="sidebar-label">{t(item.labelKey)}</span>
            </button>
          ))}
        </nav>

        <div className="sidebar-foot">
          <div className="sidebar-label">
            {t('nav.signedInAs')} <strong>{user?.displayName}</strong>
          </div>
          <Button
            variant="ghost"
            size="sm"
            onClick={logout}
            title={railed ? t('nav.signOut') : undefined}
            aria-label={t('nav.signOut')}
          >
            <Icon icon={LogOut} size="sm" />
            <span className="sidebar-label">{t('nav.signOut')}</span>
          </Button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          {/* Only visible on phones, where the sidebar (and its brand) is hidden. */}
          <Logo size={30} className="topbar-logo" label={t('auth.appName')} />
          <div className="topbar-title">
            <h1>{t(active.labelKey)}</h1>
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
                  aria-label={t('common.previousMonth')}
                >
                  <Icon icon={ChevronLeft} size="sm" />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPeriod(currentPeriod())}
                  disabled={period === currentPeriod()}
                >
                  {t('common.today')}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPeriod((p) => shiftPeriod(p, 1))}
                  aria-label={t('common.nextMonth')}
                >
                  <Icon icon={ChevronRight} size="sm" />
                </Button>
              </div>
            )}
            <RefreshButton onRefresh={refreshCurrentRoute} label={t('common.refreshPage')} />

            <Button
              size="sm"
              variant="ghost"
              className={cx('topbar-settings', route === 'settings' && 'is-active')}
              aria-label={t('nav.settings')}
              aria-current={route === 'settings' ? 'page' : undefined}
              title={t('nav.settings')}
              onClick={() => go('settings')}
            >
              <Icon icon={SETTINGS_ITEM.icon} size="sm" />
            </Button>

            {/* Mobile only — see .topbar-signout.

                The sidebar carries this on desktop, and the sidebar is
                display:none below 1000px, which left signing out genuinely
                unreachable on a phone: not buried, absent. Rendered here rather
                than added to the gesture arc because that menu commits on
                release, and an action you cannot undo in one tap has no place
                somewhere a slip of the thumb confirms it. */}
            <Button
              size="sm"
              variant="ghost"
              className="topbar-signout"
              aria-label={t('nav.signOut')}
              title={t('nav.signOut')}
              onClick={logout}
            >
              <Icon icon={LogOut} size="sm" />
            </Button>
          </div>
        </header>

        <main className="page">
          <DbStatusBanner />

          {route === 'dashboard' && <DashboardPage period={period} onNavigate={go} />}
          {route === 'wallets' && <WalletsPage />}
          {route === 'cards' && <CreditCardsPage />}
          {route === 'transactions' && <TransactionsPage period={period} />}
          {route === 'investments' && <InvestmentsPage />}
          {route === 'budgets' && <BudgetsPage period={period} />}
          {route === 'splits' && <SharedExpensesPage />}
          {route === 'subscriptions' && <SubscriptionsPage onNavigate={go} />}
          {route === 'analytics' && <AnalyticsPage period={period} onNavigate={go} />}
          {route === 'goals' && <GoalsPage />}
          {route === 'debt' && <DebtManagerPage />}
          {route === 'settings' && <SettingsPage />}
          {route === 'more' && (
            <MoreMenuPage
              onNavigate={go}
              /* The shell owns `period`, so warming is passed down rather than
                 the page reaching for it. A directory is the one screen where
                 prefetch reliably pays: you are one tap from somewhere. */
              onPrefetch={(next) => warmRoute(next, period)}
            />
          )}
          {route === 'notFound' && <NotFoundPage onNavigate={go} />}
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

      <nav className="tabbar" aria-label={t('nav.mainNavigation')}>
        {tabLeft.map(tab)}
        {/* An empty grid cell, not a wrapper: the centre button is a sibling of
            the bar, so it can sit above the backdrop its own menu raises. A
            child could not — .tabbar creates a stacking context. */}
        <span className="tabbar-slot" aria-hidden="true" />
        {tabRight.map(tab)}
      </nav>

      {/* Rendered beside the bar rather than inside it, and hidden with it on
          desktop. See the stacking note above. */}
      <GestureNavWidget shortcuts={navShortcuts} activeRoute={route} onNavigate={go} />
    </div>
  );
}
