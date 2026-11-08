import { Suspense, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { Badge, Card } from '../ui';
import { useExcelDB } from '../../hooks/useExcelDB';
import { useAuth } from '../../state/AuthContext';
import { useMoneyFormatter, useSettings } from '../../state/SettingsContext';
import { cx, todayKey } from '../../lib/format';
import { useSyncedLayout } from '../../lib/layout/useSyncedLayout';
import { lazyWithRetry } from '../../lib/lazyWithRetry';
import { registerSafeSpendStrings } from '../../locales/safeSpend';
import { SAFE_SPEND_SYNC_FORMAT, computeSafeSpend, type SafeSpendResult, type SafeSpendSettings } from '../../lib/safeSpend';
import type { DashboardSummary, Debt, Goal, Subscription, Transaction } from '../../types';

/* The breakdown and settings: their own chunk, loaded on the first tap. */
const SafeSpendSheet = lazyWithRetry(() => import('./SafeSpendSheet').then((m) => ({ default: m.SafeSpendSheet })));

/* Before anything here renders: the strings travel with this chunk. */
registerSafeSpendStrings();

const STATE_TONE = { ok: 'positive', tight: 'warning', over: 'negative' } as const;
const STATE_KEY = { ok: 'safeSpend.stateOk', tight: 'safeSpend.stateTight', over: 'safeSpend.stateOver' } as const;

/**
 * Home's Safe-to-spend card. Its own chunk, so nothing here — nor the
 * recurring and debt lists it reads — is loaded unless a layout has the card.
 * The dashboard summary, the month's transactions and the goals come from
 * Home, which already has them.
 */
export function SafeSpendCard({
  sizeClass,
  period,
  summary,
  transactions,
  listsLoading,
  goals,
  fallback,
}: {
  sizeClass: string;
  period: string;
  summary: DashboardSummary | undefined;
  transactions: Transaction[];
  listsLoading: boolean;
  goals: Goal[];
  fallback: ReactNode;
}) {
  const { user } = useAuth();
  const { settings: appSettings } = useSettings();
  /* Same cache keys as the Recurring and Debt screens, so either is free afterwards. */
  const subscriptions = useExcelDB<Subscription>('subscriptions');
  const debts = useExcelDB<Debt>('debts');
  const { layout: settings, save } = useSyncedLayout(SAFE_SPEND_SYNC_FORMAT, user?.id);

  const today = todayKey();
  const result = useMemo(
    () =>
      summary
        ? computeSafeSpend({
            period,
            today,
            wallets: summary.wallets ?? [],
            goals,
            subscriptions: subscriptions.items,
            debts: debts.items,
            transactions,
            budgets: summary.budgets ?? [],
            trend: summary.trend ?? [],
            paydays: appSettings.paydays ?? [],
            settings,
            monthIncome: summary.monthIncome,
            monthExpense: summary.monthExpense,
            historical: summary.historical ?? null,
          })
        : null,
    [summary, period, today, goals, subscriptions.items, debts.items, transactions, appSettings.paydays, settings],
  );

  if (!result || subscriptions.initialLoading || debts.initialLoading || listsLoading) return <>{fallback}</>;
  return (
    <CardBody
      result={result}
      sizeClass={sizeClass}
      period={period}
      wallets={summary?.wallets ?? []}
      settings={settings}
      onSettings={save}
    />
  );
}

type Size = 'small' | 'medium' | 'large';

/** From the card body's measured size; a card that grows with its content (phones) is medium. */
export function sizeOf(w: number, h: number): Size {
  if (h === 0) return 'medium';
  if (h < 150) return 'small';
  if (h >= 250 || (w >= 520 && h >= 190)) return 'large';
  return 'medium';
}

function CardBody({
  result,
  sizeClass,
  period,
  wallets,
  settings,
  onSettings,
}: {
  result: SafeSpendResult;
  sizeClass: string;
  period: string;
  wallets: DashboardSummary['wallets'];
  settings: SafeSpendSettings;
  onSettings: (next: SafeSpendSettings) => void;
}) {
  const { t } = useTranslation();
  const { settings: appSettings } = useSettings();
  const money = useMoneyFormatter();
  const [open, setOpen] = useState(false);

  const bodyRef = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const card = bodyRef.current?.closest<HTMLElement>('.card');
    const body = card?.querySelector<HTMLElement>('.card-body');
    if (!card || !body) return undefined;
    const measure = () => {
      const placed = Boolean(card.closest('.is-placed'));
      setBox({ w: Math.round(body.clientWidth), h: placed ? Math.round(body.clientHeight) : 0 });
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(body);
    return () => observer.disconnect();
  }, []);
  const size = sizeOf(box.w, box.h);

  const { mode, left, perDay, todayLeft, state } = result;
  const dayLabel = (date: string) => {
    const [y, m, d] = date.split('-').map(Number);
    return new Date(y, m - 1, d).toLocaleDateString(appSettings.locale, { day: 'numeric', month: 'short' });
  };

  const headline =
    left === null ? '—' : left < 0 ? t('safeSpend.overBy', { amount: money(-left) }) : money(left);
  const sub =
    mode === 'past'
      ? left === null
        ? t('safeSpend.pastUnknown')
        : t('safeSpend.pastLeft')
      : mode === 'future'
        ? t('safeSpend.futureLeft')
        : left !== null && left < 0
          ? t('safeSpend.daysToGo', { count: result.daysLeft })
          : t('safeSpend.leftThisMonth', { count: result.daysLeft });
  const perDayText =
    mode === 'past'
      ? result.pastPerDay !== null
        ? t('safeSpend.avgPerDay', { amount: money(result.pastPerDay) })
        : null
      : perDay !== null && perDay > 0
        ? t('safeSpend.perDay', { amount: money(perDay) })
        : t('safeSpend.perDayNone');

  /* Spent vs left: what this month has spent against what it may still spend. */
  const spent = mode === 'past' ? result.monthExpense : result.spentSoFar;
  const room = Math.max(0, left ?? 0);
  const spentShare = spent + room > 0 ? Math.round((spent / (spent + room)) * 100) : 0;
  const nextBills = result.bills.filter((bill) => !bill.overdue).slice(0, 3);

  return (
    <>
      <Card
        className={cx('ss-card', `ss-card--${size}`, `ss-card--${state}`, sizeClass)}
        title={t('safeSpend.title')}
        actions={
          mode !== 'past' && left !== null ? <Badge tone={STATE_TONE[state]}>{t(STATE_KEY[state])}</Badge> : undefined
        }
      >
        <div ref={bodyRef} className="ss-body">
          <button
            type="button"
            className="ss-main"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
            aria-label={`${t('safeSpend.title')}: ${headline}. ${perDayText ?? ''} ${t('safeSpend.openBreakdown')}`}
          >
            <span className={cx('ss-amount', left !== null && left < 0 && 'text-negative')}>{headline}</span>
            <span className="ss-sub">{sub}</span>
            {perDayText && <span className="ss-perday">{perDayText}</span>}
            {size !== 'small' && mode === 'live' && todayLeft !== null && left !== null && left >= 0 && (
              <span className={cx('ss-today', todayLeft < 0 && 'text-negative')}>
                {todayLeft >= 0
                  ? t('safeSpend.todayLeft', { amount: money(todayLeft) })
                  : t('safeSpend.todayOver', { amount: money(-todayLeft) })}
              </span>
            )}
          </button>

          {size === 'large' && (
            <>
              {mode !== 'future' && (
                <div className="ss-bar-wrap">
                  <div
                    className="ss-bar"
                    role="img"
                    aria-label={t('safeSpend.barLabel', { spent: money(spent), left: money(room) })}
                  >
                    <span className="ss-bar-spent" style={{ width: `${spentShare}%` }} />
                  </div>
                  <div className="ss-bar-legend">
                    <span>{t('safeSpend.spent', { amount: money(spent) })}</span>
                    <span>{t('safeSpend.room', { amount: money(room) })}</span>
                  </div>
                </div>
              )}
              {mode !== 'past' && (
                <div className="ss-next">
                  <h3 className="section-label">{t('safeSpend.nextBills')}</h3>
                  {nextBills.length === 0 ? (
                    <p className="ss-none">{t('safeSpend.noBills')}</p>
                  ) : (
                    <ul className="ss-bills">
                      {nextBills.map((bill) => (
                        <li key={bill.key}>
                          <span className="ss-bill-date">{dayLabel(bill.date)}</span>
                          <span className="ss-bill-name">{bill.name}</span>
                          <span className="ss-bill-amount">{money(bill.amount)}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      </Card>
      {open && (
        <Suspense fallback={null}>
          <SafeSpendSheet
            result={result}
            period={period}
            wallets={wallets}
            settings={settings}
            onSettings={onSettings}
            onClose={() => setOpen(false)}
          />
        </Suspense>
      )}
    </>
  );
}

