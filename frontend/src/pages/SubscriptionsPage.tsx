/**
 * Subscriptions & recurring bills.
 *
 * A timeline rather than a table: the only question this screen answers is
 * "what needs paying, and when", so the bills are grouped by urgency and the
 * due ones get real estate rather than a row like any other.
 *
 * Nothing runs on a schedule. A bill becomes due because today caught up with
 * its `nextDueDate`, and confirming payment writes the expense and rolls the
 * cycle — see the note at the top of the Subscriptions section in Code.gs.
 */

import { AlarmClock, CalendarClock, CalendarDays, Repeat2, Wallet as WalletIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';

import { Icon } from '../components/Icon';
import { ListSkeleton } from '../components/Skeletons';
import { TranslationKey } from '../locales';
import { SubscriptionForm, SubscriptionPayload } from '../components/SubscriptionForm';
import { Alert, Badge, Button, Card, EmptyState, RefreshButton } from '../components/ui';
import { isOptimistic, useExcelDB } from '../hooks/useExcelDB';
import { todayKey, useSubscriptions } from '../hooks/useSubscriptions';
import { cx, formatDate } from '../lib/format';
import { toast } from '../lib/toast';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Subscription, WalletBalance } from '../types';

type Bucket = 'due' | 'soon' | 'later';

/* Keys, not labels: module-level arrays are built once at import time. */
const BUCKETS: {
  key: Bucket;
  titleKey: TranslationKey;
  blurbKey: TranslationKey;
  icon: typeof AlarmClock;
}[] = [
  { key: 'due', titleKey: 'recurring.bucketDueTitle', blurbKey: 'recurring.bucketDueBlurb', icon: AlarmClock },
  { key: 'soon', titleKey: 'recurring.bucketSoonTitle', blurbKey: 'recurring.bucketSoonBlurb', icon: CalendarClock },
  { key: 'later', titleKey: 'recurring.bucketLaterTitle', blurbKey: 'recurring.bucketLaterBlurb', icon: CalendarDays },
];

const FREQUENCY_KEY: Record<Subscription['frequency'], TranslationKey> = {
  weekly: 'recurring.freqWeekly',
  monthly: 'recurring.freqMonthly',
  yearly: 'recurring.freqYearly',
};

/** Whole days from today to `dateKey`; negative when overdue. */
function daysUntil(dateKey: string, today: string): number {
  const toUtc = (key: string) => {
    const [y, m, d] = key.split('-').map(Number);
    return Date.UTC(y, (m || 1) - 1, d || 1);
  };
  // Both ends anchored to UTC midnight, so a DST boundary cannot make a day
  // 23 or 25 hours long and round the answer off by one.
  return Math.round((toUtc(dateKey) - toUtc(today)) / 86_400_000);
}

function bucketFor(days: number): Bucket {
  if (days <= 0) return 'due';
  if (days <= 7) return 'soon';
  return 'later';
}

/** `t` threaded in rather than hooked — this is a pure formatter. */
function relativeLabel(days: number, t: TFunction): string {
  if (days === 0) return t('recurring.dueTodayFull');
  if (days < 0) return t('recurring.overdueBy', { count: Math.abs(days) });
  if (days === 1) return t('recurring.dueTomorrowFull');
  return t('recurring.dueIn', { count: days });
}

export function SubscriptionsPage() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();

  const subscriptions = useSubscriptions();
  const wallets = useExcelDB<WalletBalance>('wallets');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Subscription | undefined>();
  const [formError, setFormError] = useState<string | null>(null);
  /** Ids with a payment in flight, so one button can spin without freezing the rest. */
  const [paying, setPaying] = useState<string[]>([]);

  // Recomputed per render rather than stored: leaving the tab open past
  // midnight should roll a bill into "due" on its own.
  const today = todayKey();

  const grouped = useMemo(() => {
    const groups: Record<Bucket, { subscription: Subscription; days: number }[]> = {
      due: [],
      soon: [],
      later: [],
    };
    for (const subscription of subscriptions.items) {
      const days = daysUntil(subscription.nextDueDate, today);
      groups[bucketFor(days)].push({ subscription, days });
    }
    for (const key of Object.keys(groups) as Bucket[]) {
      groups[key].sort((a, b) => a.days - b.days);
    }
    return groups;
  }, [subscriptions.items, today]);

  const dueTotal = grouped.due.reduce((sum, entry) => sum + (Number(entry.subscription.amount) || 0), 0);
  const monthlyEquivalent = useMemo(
    () =>
      subscriptions.items.reduce((sum, s) => {
        const amount = Number(s.amount) || 0;
        // Normalised so weekly and yearly bills are comparable at a glance.
        if (s.frequency === 'weekly') return sum + (amount * 52) / 12;
        if (s.frequency === 'yearly') return sum + amount / 12;
        return sum + amount;
      }, 0),
    [subscriptions.items],
  );

  const walletName = (id: string) => wallets.items.find((w) => w.id === id)?.name ?? t('recurring.unknownWallet');

  async function confirmPayment(subscription: Subscription) {
    setPaying((ids) => [...ids, subscription.id]);
    try {
      await subscriptions.pay(subscription);
      toast.success(t('recurring.paidToast', { name: subscription.name, amount: money(Number(subscription.amount) || 0) }));
    } catch {
      // useExcelDB already toasted the failure and the hook rolled the caches back.
    } finally {
      setPaying((ids) => ids.filter((id) => id !== subscription.id));
    }
  }

  function save(payload: SubscriptionPayload) {
    const id = editing?.id;
    setFormError(null);
    setFormOpen(false);
    setEditing(undefined);

    const pending = id ? subscriptions.update(id, payload) : subscriptions.create(payload);
    pending.catch(() => undefined);
  }

  async function remove(subscription: Subscription) {
    if (!window.confirm(`Delete the "${subscription.name}" subscription? Past payments are kept.`)) return;
    await subscriptions.remove(subscription.id).catch(() => undefined);
  }

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="section-label">Recurring</span>
          <h1 className="page-title">Subscriptions</h1>
          <p className="page-lede">
            Bills you pay on a cycle. Nothing is charged automatically — confirm a payment and it
            records the expense, then moves to the next cycle.
          </p>
        </div>
        <div className="cluster">
          <RefreshButton
            onRefresh={() => Promise.all([subscriptions.refresh(), wallets.refresh()])}
            busy={subscriptions.isValidating || wallets.isValidating}
            label={t('recurring.refresh')}
          />
          <Button
            size="sm"
            variant="primary"
            onClick={() => {
              setEditing(undefined);
              setFormError(null);
              setFormOpen(true);
            }}
            disabled={wallets.items.length === 0}
          >
            New subscription
          </Button>
        </div>
      </div>

      {subscriptions.mutationError && (
        <Alert tone="error" onDismiss={subscriptions.clearMutationError}>
          {subscriptions.mutationError}
        </Alert>
      )}

      {/* ---- Summary ---- */}
      {subscriptions.items.length > 0 && (
        <section className="hero hero--compact">
          <div className="hero-primary">
            <span className="section-label">{t('recurring.committedMonthly')}</span>
            <span className="hero-value">{money(monthlyEquivalent)}</span>
            <div className="hero-meta">
              <Badge tone={grouped.due.length ? 'negative' : 'positive'}>
                {grouped.due.length
                  ? t('recurring.dueSummary', { count: grouped.due.length, amount: money(dueTotal) })
                  : t('recurring.nothingDue')}
              </Badge>
              <span>
                {t('recurring.subscriptionCount', { count: subscriptions.items.length })}
              </span>
            </div>
          </div>
        </section>
      )}

      {subscriptions.initialLoading ? (
        <Card padded>
          <ListSkeleton rows={4} />
        </Card>
      ) : subscriptions.error && !subscriptions.items.length ? (
        <Card padded>
          <Alert tone="error">{subscriptions.error}</Alert>
        </Card>
      ) : subscriptions.items.length === 0 ? (
        <Card padded>
          <EmptyState
            icon={<Icon icon={Repeat2} size="xl" />}
            title={t('recurring.emptyTitle')}
            description={
              wallets.items.length === 0
                ? t('recurring.createWalletFirst')
                : t('recurring.emptyHint')
            }
            action={
              wallets.items.length > 0 && (
                <Button variant="primary" onClick={() => setFormOpen(true)}>
                  {t('recurring.addFirst')}
                </Button>
              )
            }
          />
        </Card>
      ) : (
        <div className="timeline">
          {BUCKETS.map((bucket) => {
            const entries = grouped[bucket.key];
            if (!entries.length) return null;

            return (
              <section key={bucket.key} className={cx('timeline-group', `timeline-group--${bucket.key}`)}>
                <header className="timeline-head">
                  <span className="timeline-dot" aria-hidden="true">
                    <Icon icon={bucket.icon} size="sm" />
                  </span>
                  <div>
                    <h2 className="timeline-title">
                      {t(bucket.titleKey)}
                      <span className="timeline-count">{entries.length}</span>
                    </h2>
                    <p className="timeline-blurb">{t(bucket.blurbKey)}</p>
                  </div>
                </header>

                <div className="timeline-items">
                  {entries.map(({ subscription, days }) => {
                    const pending = paying.includes(subscription.id) || isOptimistic(subscription);
                    const amount = Number(subscription.amount) || 0;

                    return (
                      <article
                        key={subscription.id}
                        className={cx('sub-card', pending && 'is-pending')}
                      >
                        <span className="sub-rail" aria-hidden="true" />

                        <div className="sub-main">
                          <div className="sub-title-row">
                            <h3 className="sub-name truncate">{subscription.name}</h3>
                            <Badge tone={bucket.key === 'due' ? 'negative' : bucket.key === 'soon' ? 'warning' : 'neutral'}>
                              {relativeLabel(days, t)}
                            </Badge>
                          </div>

                          <div className="sub-meta">
                            <span>
                              <Icon icon={Repeat2} size="sm" />
                              {t(FREQUENCY_KEY[subscription.frequency])}
                            </span>
                            <span>
                              <Icon icon={WalletIcon} size="sm" />
                              {walletName(subscription.walletId)}
                            </span>
                            <span>
                              <Icon icon={CalendarDays} size="sm" />
                              {formatDate(subscription.nextDueDate, settings.locale)}
                            </span>
                            {subscription.category && <Badge tone="accent">{subscription.category}</Badge>}
                          </div>

                          {subscription.note && <p className="sub-note truncate">{subscription.note}</p>}
                        </div>

                        <div className="sub-side">
                          <span className="sub-amount">{money(amount)}</span>

                          <div className="sub-actions">
                            {bucket.key === 'due' && (
                              <Button
                                size="sm"
                                variant="primary"
                                loading={pending}
                                disabled={pending}
                                onClick={() => void confirmPayment(subscription)}
                              >
                                Confirm payment
                              </Button>
                            )}
                            <Button
                              size="sm"
                              variant="ghost"
                              onClick={() => {
                                setEditing(subscription);
                                setFormError(null);
                                setFormOpen(true);
                              }}
                            >
                              Edit
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => void remove(subscription)}>
                              ✕
                            </Button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <SubscriptionForm
        open={formOpen}
        subscription={editing}
        wallets={wallets.items}
        categories={settings.categories}
        error={formError}
        onClose={() => {
          setFormOpen(false);
          setEditing(undefined);
          setFormError(null);
        }}
        onSubmit={save}
      />
    </>
  );
}
