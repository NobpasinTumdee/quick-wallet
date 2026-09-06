import { useEffect } from 'react';

import { toast } from '../lib/toast';
import { useAuth } from '../state/AuthContext';
import { useMoneyFormatter } from '../state/SettingsContext';
import { Subscription } from '../types';
import { todayKey, useSubscriptions } from './useSubscriptions';

/**
 * "You have unpaid subscriptions" — raised once when the app opens.
 *
 * ---------------------------------------------------------------------------
 * WHY A MODULE-LEVEL LATCH, KEYED ON THE USER
 * ---------------------------------------------------------------------------
 * The requirement is "once per app open, then leave me alone".
 *
 *   - component state resets on every remount, so switching tabs and coming
 *     back would re-fire it
 *   - `sessionStorage` outlives a reload, so reopening the app in the same
 *     browser session would silently swallow the notice
 *
 * Module scope is exactly the lifetime wanted: it lives as long as the loaded
 * bundle, which is precisely "this app session".
 *
 * It stores *which user* was alerted rather than a bare boolean. On a shared
 * machine, signing out and in as someone else is a fresh app open as far as
 * this notice is concerned, and a boolean would swallow the second person's
 * bills. Keying on the id also means AuthContext needs no hook into this file —
 * `state/` importing from `hooks/` would have closed a cycle back through
 * SettingsContext.
 *
 * The check itself is a pure read of the subscriptions cache. `useSubscriptions`
 * subscribes to the same key the Recurring tab uses, so opening that tab paints
 * from cache instead of costing a second round trip — the alert warms it.
 */
let alertedFor: string | null = null;

/** Escape hatch for tests. Production resets itself when the user changes. */
export function resetOverdueAlert(): void {
  alertedFor = null;
}

/** Due today or earlier. Date keys are `YYYY-MM-DD`, so string compare is safe. */
export function isOverdue(subscription: Subscription, today = todayKey()): boolean {
  return Boolean(subscription.nextDueDate) && subscription.nextDueDate <= today;
}

export function useOverdueSubscriptionAlert(): void {
  const { user } = useAuth();
  const { items, initialLoading, error } = useSubscriptions();
  const money = useMoneyFormatter();

  useEffect(() => {
    if (!user || alertedFor === user.id) return;
    // Wait for real data. Firing off an empty cache would report nothing due on
    // every cold start, and firing after a failed fetch would be a guess.
    if (initialLoading || error || !items.length) return;

    // Latched before the toast so a re-render mid-effect can't double-fire.
    alertedFor = user.id;

    const today = todayKey();
    const overdue = items.filter((row) => isOverdue(row, today));
    if (!overdue.length) return;

    const count = overdue.length;
    const total = overdue.reduce((sum, row) => sum + (Number(row.amount) || 0), 0);

    toast.warning(
      count === 1
        ? `${overdue[0].name} is due. Open Recurring to confirm the payment.`
        : `${count} payments totalling ${money(total)} are due. Open Recurring to confirm them.`,
      count === 1 ? '1 unpaid subscription' : `${count} unpaid subscriptions`,
    );
  }, [user, items, initialLoading, error, money]);
}
