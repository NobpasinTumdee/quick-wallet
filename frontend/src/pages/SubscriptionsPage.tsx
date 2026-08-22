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

import { Icon } from '../components/Icon';
import { ListSkeleton } from '../components/Skeletons';
import { SubscriptionForm, SubscriptionPayload } from '../components/SubscriptionForm';
import { Alert, Badge, Button, Card, EmptyState, RefreshButton } from '../components/ui';
import { isOptimistic, useExcelDB } from '../hooks/useExcelDB';
import { todayKey, useSubscriptions } from '../hooks/useSubscriptions';
import { cx, formatDate } from '../lib/format';
import { toast } from '../lib/toast';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Subscription, WalletBalance } from '../types';

type Bucket = 'due' | 'soon' | 'later';

const BUCKETS: { key: Bucket; title: string; blurb: string; icon: typeof AlarmClock }[] = [
  { key: 'due', title: 'Action required', blurb: 'Due now or overdue', icon: AlarmClock },
  { key: 'soon', title: 'Upcoming', blurb: 'Within 7 days — make sure the funds are there', icon: CalendarClock },
  { key: 'later', title: 'Later', blurb: 'Scheduled further out', icon: CalendarDays },
];

const FREQUENCY_LABEL: Record<Subscription['frequency'], string> = {
  weekly: 'Weekly',
  monthly: 'Monthly',
  yearly: 'Yearly',
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

function relativeLabel(days: number): string {
  if (days === 0) return 'Due today';
  if (days === -1) return 'Overdue by 1 day';
  if (days < 0) return `Overdue by ${Math.abs(days)} days`;
  if (days === 1) return 'Due tomorrow';
  return `In ${days} days`;
}

export function SubscriptionsPage() {
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

  const walletName = (id: string) => wallets.items.find((w) => w.id === id)?.name ?? 'Unknown wallet';

  async function confirmPayment(subscription: Subscription) {
    setPaying((ids) => [...ids, subscription.id]);
    try {
      await subscriptions.pay(subscription);
      toast.success(`${subscription.name} · ${money(Number(subscription.amount) || 0)} recorded`);
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
            label="Refresh subscriptions"
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
            <span className="section-label">Committed each month</span>
            <span className="hero-value">{money(monthlyEquivalent)}</span>
            <div className="hero-meta">
              <Badge tone={grouped.due.length ? 'negative' : 'positive'}>
                {grouped.due.length
                  ? `${grouped.due.length} due · ${money(dueTotal)}`
                  : 'Nothing due'}
              </Badge>
              <span>
                {subscriptions.items.length} subscription{subscriptions.items.length === 1 ? '' : 's'} ·
                weekly and yearly bills normalised to a monthly figure
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
            title="No subscriptions yet"
            description={
              wallets.items.length === 0
                ? 'Create a wallet first — a subscription needs somewhere to deduct from.'
                : 'Add rent, Netflix, insurance — anything on a cycle — and this tracks what is due next.'
            }
            action={
              wallets.items.length > 0 && (
                <Button variant="primary" onClick={() => setFormOpen(true)}>
                  Add the first one
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
                      {bucket.title}
                      <span className="timeline-count">{entries.length}</span>
                    </h2>
                    <p className="timeline-blurb">{bucket.blurb}</p>
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
                              {relativeLabel(days)}
                            </Badge>
                          </div>

                          <div className="sub-meta">
                            <span>
                              <Icon icon={Repeat2} size="sm" />
                              {FREQUENCY_LABEL[subscription.frequency]}
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
