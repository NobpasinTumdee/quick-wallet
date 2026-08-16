import { useState } from 'react';

import { useExcelQuery } from '../hooks/useExcelDB';
import { currentPeriod, cx, formatPeriod, shiftPeriod } from '../lib/format';
import { Route, useRoute } from '../lib/router';
import { BudgetsPage } from '../pages/BudgetsPage';
import { DashboardPage } from '../pages/DashboardPage';
import { InvestmentsPage } from '../pages/InvestmentsPage';
import { SettingsPage } from '../pages/SettingsPage';
import { TransactionsPage } from '../pages/TransactionsPage';
import { WalletsPage } from '../pages/WalletsPage';
import { useAuth } from '../state/AuthContext';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { DbHealth } from '../types';
import { Logo } from './Logo';
import { Alert, Button } from './ui';

const NAV: { route: Route; label: string; icon: string }[] = [
  { route: 'dashboard', label: 'Overview', icon: '📊' },
  { route: 'wallets', label: 'Wallets', icon: '👛' },
  { route: 'transactions', label: 'Activity', icon: '🧾' },
  { route: 'investments', label: 'Invest', icon: '📈' },
  { route: 'budgets', label: 'Budgets', icon: '🎯' },
  { route: 'settings', label: 'Settings', icon: '⚙️' },
];

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
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const [period, setPeriod] = useState(currentPeriod());

  const active = NAV.find((item) => item.route === route) ?? NAV[0];
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
              onClick={() => go(item.route)}
            >
              <span aria-hidden="true">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <div>
            Signed in as <strong>{user?.displayName}</strong>
          </div>
          <Button variant="ghost" size="sm" onClick={logout}>
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
              <>
                <Button
                  size="sm"
                  variant="ghost"
                  onClick={() => setPeriod((p) => shiftPeriod(p, -1))}
                  aria-label="Previous month"
                >
                  ‹
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
                  ›
                </Button>
              </>
            )}
          </div>
        </header>

        <main className="page">
          <DbStatusBanner />

          {route === 'dashboard' && <DashboardPage period={period} onNavigate={go} />}
          {route === 'wallets' && <WalletsPage />}
          {route === 'transactions' && <TransactionsPage period={period} />}
          {route === 'investments' && <InvestmentsPage />}
          {route === 'budgets' && <BudgetsPage period={period} />}
          {route === 'settings' && <SettingsPage />}
        </main>
      </div>

      <nav className="tabbar" aria-label="Main navigation">
        {NAV.map((item) => (
          <button
            key={item.route}
            type="button"
            className={cx('tabbar-item', route === item.route && 'is-active')}
            aria-current={route === item.route ? 'page' : undefined}
            onClick={() => go(item.route)}
          >
            <span className="tab-icon" aria-hidden="true">
              {item.icon}
            </span>
            {item.label}
          </button>
        ))}
      </nav>
    </div>
  );
}
