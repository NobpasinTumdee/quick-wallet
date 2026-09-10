import { useEffect } from 'react';

import { DUE_SOON_DAYS } from '../lib/creditMath';
import { toast } from '../lib/toast';
import { useAuth } from '../state/AuthContext';
import { useMoneyFormatter } from '../state/SettingsContext';
import { Subscription } from '../types';
import { useCreditCards } from './useCreditCards';
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

/**
 * The same latch, kept separately for credit card bills.
 *
 * Two latches rather than one because the two notices depend on different data
 * that arrives at different times: subscriptions is one request, cards needs
 * both the wallets and the ledger. Sharing a latch would mean whichever
 * resolved first silently swallowed the other, and which one that is would
 * depend on the network.
 */
let cardsAlertedFor: string | null = null;

/** Escape hatch for tests. Production resets itself when the user changes. */
export function resetOverdueAlert(): void {
  alertedFor = null;
  cardsAlertedFor = null;
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

/**
 * "Your card bill is due" — raised once per app open, alongside the
 * subscriptions notice above.
 *
 * ---------------------------------------------------------------------------
 * WHY IT WARNS ON THE STATEMENT BALANCE AND NOT THE CURRENT ONE
 * ---------------------------------------------------------------------------
 * The current balance includes charges made since the statement closed, and
 * those are not due on this due date — they are due on the next one. Warning on
 * the full balance would tell someone who cleared their statement on Monday and
 * bought lunch on Tuesday that they still owe money, which is both wrong and
 * the fastest way to teach them to ignore the notice.
 *
 * `computeCardState` already resolves the cycle, so all this decides is when to
 * speak: money genuinely billed, and a due date inside the window.
 */
export function useCreditCardDueAlert(): void {
  const { user } = useAuth();
  const { cards, initialLoading, error } = useCreditCards();
  const money = useMoneyFormatter();

  useEffect(() => {
    if (!user || cardsAlertedFor === user.id) return;
    // Same rule as the subscriptions notice: wait for real data rather than
    // reporting "nothing due" off an empty cache or a failed fetch.
    if (initialLoading || error || !cards.length) return;

    cardsAlertedFor = user.id;

    const overdue = cards.filter((card) => card.overdue);
    const dueSoon = cards.filter((card) => card.dueSoon);
    if (!overdue.length && !dueSoon.length) return;

    /* Overdue is the more urgent of the two and gets its own toast, because
       folding them together would round "you have missed a payment" down into
       "some bills are coming up". */
    if (overdue.length) {
      const total = overdue.reduce((sum, card) => sum + card.statementBalance, 0);
      toast.error(
        overdue.length === 1
          ? `${overdue[0].wallet.name} was due ${overdue[0].paymentDueDate}. ${money(
              overdue[0].statementBalance,
            )} outstanding.`
          : `${overdue.length} cards are past due, totalling ${money(total)}.`,
        overdue.length === 1 ? 'Card payment overdue' : 'Card payments overdue',
      );
    }

    if (dueSoon.length) {
      const total = dueSoon.reduce((sum, card) => sum + card.statementBalance, 0);
      const soonest = dueSoon.reduce((a, b) =>
        (a.daysUntilDue ?? 0) <= (b.daysUntilDue ?? 0) ? a : b,
      );
      const days = soonest.daysUntilDue ?? 0;
      const when = days === 0 ? 'today' : days === 1 ? 'tomorrow' : `in ${days} days`;

      toast.warning(
        dueSoon.length === 1
          ? `${money(soonest.statementBalance)} on ${soonest.wallet.name} is due ${when}.`
          : `${dueSoon.length} card bills totalling ${money(total)} are due within ${DUE_SOON_DAYS} days — the soonest ${when}.`,
        dueSoon.length === 1 ? 'Card payment due soon' : 'Card payments due soon',
      );
    }
  }, [user, cards, initialLoading, error, money]);
}
