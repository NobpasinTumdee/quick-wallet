/**
 * Cards — every credit wallet, what it owes, and when.
 *
 * ---------------------------------------------------------------------------
 * WHY A TAB OF ITS OWN RATHER THAN A SECTION OF WALLETS
 * ---------------------------------------------------------------------------
 * The Wallets page answers "how much do I have". A card answers a different set
 * of questions — what closed, what has not, what is due and when — and none of
 * them fit the shape of a wallet card, which is a name and a balance. Grouping
 * them there would have meant either a third group whose tiles carry six
 * figures each, or hiding the billing detail behind a click.
 *
 * Cards still appear on the Wallets page as ordinary wallets, because that is
 * what they are; this page is the billing view of the same rows.
 */

import { CreditCard, Plus } from 'lucide-react';
import { useState } from 'react';

import { Icon } from '../components/Icon';
import { InstallmentForm, InstallmentPayload } from '../components/InstallmentForm';
import { PayBillForm, PayBillPayload } from '../components/PayBillForm';
import { VirtualCard } from '../components/VirtualCard';
import { WalletForm, WalletPayload } from '../components/WalletForm';
import { WalletGridSkeleton } from '../components/Skeletons';
import { Alert, Badge, Button, Card, EmptyState, RefreshButton } from '../components/ui';
import { CardState, utilizationTone } from '../lib/creditMath';
import { cx, formatDate, formatPercent } from '../lib/format';
import { useCreditCards } from '../hooks/useCreditCards';
import { toast } from '../lib/toast';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { WalletBalance } from '../types';

export function CreditCardsPage() {
  const money = useMoneyFormatter();
  const { settings } = useSettings();
  const credit = useCreditCards();

  const [payingCard, setPayingCard] = useState<CardState | null>(null);
  const [planningCard, setPlanningCard] = useState<CardState | null>(null);
  const [editing, setEditing] = useState<WalletBalance | undefined>();
  const [formOpen, setFormOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const { cards, summary, payableFrom } = credit;

  function openNewCard() {
    setEditing(undefined);
    credit.wallets.clearMutationError();
    setFormOpen(true);
  }

  /** Same optimistic pattern as WalletsPage: the row is already in the cache. */
  function saveCard(payload: WalletPayload) {
    const pending = editing
      ? credit.wallets.update(editing.id, payload)
      : credit.wallets.create(payload);
    setFormOpen(false);
    setEditing(undefined);
    pending.catch(() => undefined);
    return Promise.resolve();
  }

  async function payBill(payload: PayBillPayload) {
    if (!payingCard) return;
    setBusy(true);
    setActionError(null);
    try {
      await credit.payBill({ card: payingCard, ...payload });
      toast.success(
        `${money(payload.amount)} paid to ${payingCard.wallet.name}.`,
        'Bill paid',
      );
      setPayingCard(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Payment failed');
      throw err;
    } finally {
      setBusy(false);
    }
  }

  async function createPlan(payload: InstallmentPayload) {
    if (!planningCard) return;
    setBusy(true);
    setActionError(null);
    try {
      const plan = await credit.createInstallment({
        walletId: planningCard.wallet.id,
        ...payload,
      });
      toast.success(
        `${plan.months} monthly charges of about ${money(plan.monthly)} on ${planningCard.wallet.name}.`,
        'Installment plan created',
      );
      setPlanningCard(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : 'Could not create the plan');
      throw err;
    } finally {
      setBusy(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /* One card: the face, then the figures the face has no room for     */
  /* ---------------------------------------------------------------- */

  const cardPanel = (card: CardState) => {
    const { wallet } = card;
    const noCycle = wallet.statementDate < 1 || wallet.dueDate < 1;

    return (
      <article key={wallet.id} className="credit-panel">
        <VirtualCard card={card} />

        <div className="credit-detail">
          <div className="credit-figures">
            <div
              className={cx(
                'metric',
                card.overdue ? 'metric--negative' : card.dueSoon ? 'metric--accent' : undefined,
              )}
            >
              <span className="section-label">Statement balance</span>
              <span className="metric-value">{money(card.statementBalance)}</span>
              <span className="metric-hint">
                {card.paymentDueDate ? (
                  <>
                    Due {formatDate(card.paymentDueDate, settings.locale)}
                    {card.daysUntilDue !== null && (
                      <>
                        {' · '}
                        {card.daysUntilDue < 0
                          ? `${Math.abs(card.daysUntilDue)} day${Math.abs(card.daysUntilDue) === 1 ? '' : 's'} late`
                          : card.daysUntilDue === 0
                            ? 'today'
                            : `in ${card.daysUntilDue} day${card.daysUntilDue === 1 ? '' : 's'}`}
                      </>
                    )}
                  </>
                ) : (
                  'Set a billing cycle to track this'
                )}
              </span>
            </div>

            <div className="metric">
              <span className="section-label">Unbilled</span>
              <span className="metric-value">{money(card.unbilledBalance)}</span>
              <span className="metric-hint">
                {card.nextStatementDate
                  ? `Bills ${formatDate(card.nextStatementDate, settings.locale)}`
                  : 'Since the account opened'}
              </span>
            </div>

            <div className={cx('metric', card.availableCredit < 0 && 'metric--negative')}>
              <span className="section-label">Available credit</span>
              <span
                className={cx('metric-value', card.availableCredit < 0 && 'text-negative')}
              >
                {card.hasLimit ? money(card.availableCredit) : '—'}
              </span>
              <span className="metric-hint">
                {card.hasLimit
                  ? `${formatPercent(card.utilization, 0)} of ${money(wallet.creditLimit, { compact: true })} used`
                  : 'No limit set'}
              </span>
            </div>

            {card.scheduledBalance > 0 && (
              <div className="metric metric--accent">
                <span className="section-label">Scheduled</span>
                <span className="metric-value">{money(card.scheduledBalance)}</span>
                <span className="metric-hint">Installment chunks still to be billed</span>
              </div>
            )}
          </div>

          {noCycle && (
            <Alert tone="info">
              No billing cycle on this card yet. Add the statement and due days and it can tell you
              what has been billed and when it falls due.
            </Alert>
          )}

          <footer className="credit-actions">
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setActionError(null);
                setPayingCard(card);
              }}
              disabled={card.currentBalance <= 0}
              title={card.currentBalance <= 0 ? 'Nothing owed on this card' : undefined}
            >
              Pay bill
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setActionError(null);
                setPlanningCard(card);
              }}
            >
              New installment
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                setEditing(wallet);
                credit.wallets.clearMutationError();
                setFormOpen(true);
              }}
            >
              Edit
            </Button>
          </footer>
        </div>
      </article>
    );
  };

  /* ---------------------------------------------------------------- */

  const tone = utilizationTone(summary.utilization);

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="section-label">Debt</span>
          <h1 className="page-title">Cards</h1>
          <p className="page-lede">
            Charges add to what you owe; paying a bill is a transfer from a cash wallet, so it never
            counts as spending twice.
          </p>
        </div>
        <div className="cluster">
          <RefreshButton onRefresh={credit.refresh} busy={credit.isValidating} label="Refresh cards" />
          <Button size="sm" variant="primary" onClick={openNewCard}>
            <Icon icon={Plus} size="sm" />
            New card
          </Button>
        </div>
      </div>

      {credit.wallets.mutationError && (
        <Alert tone="error" onDismiss={credit.wallets.clearMutationError}>
          {credit.wallets.mutationError}
        </Alert>
      )}
      {actionError && (
        <Alert tone="error" onDismiss={() => setActionError(null)}>
          {actionError}
        </Alert>
      )}

      {summary.overdue.length > 0 && (
        <Alert tone="error" title="Payment overdue">
          {summary.overdue.map((card) => card.wallet.name).join(', ')} — due date has passed with a
          balance outstanding.
        </Alert>
      )}
      {summary.dueSoon.length > 0 && (
        <Alert tone="warning" title="Due within three days">
          {summary.dueSoon
            .map(
              (card) =>
                `${card.wallet.name} · ${money(card.statementBalance)} on ${formatDate(card.paymentDueDate ?? '', settings.locale)}`,
            )
            .join(' · ')}
        </Alert>
      )}

      {credit.initialLoading ? (
        <WalletGridSkeleton cards={2} />
      ) : credit.error && !cards.length ? (
        <Card>
          <Alert tone="error">{credit.error}</Alert>
        </Card>
      ) : cards.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Icon icon={CreditCard} size="xl" />}
            title="No credit cards yet"
            description="Add one to track what you owe, when the statement closes, and what is still unbilled. Existing wallets are unaffected — they stay cash."
            action={
              <Button variant="primary" onClick={openNewCard}>
                Add a card
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* ---- Roll-up across every card ---- */}
          <section className={cx('debt-hero', `debt-hero--${tone}`)}>
            <div className="debt-hero-primary">
              <span className="section-label">Total owed</span>
              <span className="hero-value">{money(summary.totalDebt)}</span>
              <div className="hero-meta">
                <Badge tone={summary.totalStatementBalance > 0 ? 'warning' : 'positive'}>
                  {money(summary.totalStatementBalance)} billed
                </Badge>
                <span>
                  across {cards.length} card{cards.length === 1 ? '' : 's'}
                  {summary.totalScheduled > 0 &&
                    ` · ${money(summary.totalScheduled, { compact: true })} scheduled`}
                </span>
              </div>
            </div>

            <div className="hero-metrics">
              <div className="metric">
                <span className="section-label">Available credit</span>
                <span className="metric-value">
                  {summary.totalLimit > 0 ? money(summary.totalAvailable, { compact: true }) : '—'}
                </span>
                <span className="metric-hint">
                  {summary.totalLimit > 0
                    ? `of ${money(summary.totalLimit, { compact: true })}`
                    : 'No limits set'}
                </span>
              </div>
              <div
                className={cx(
                  'metric',
                  tone === 'ok' ? 'metric--positive' : tone === 'warning' ? 'metric--accent' : 'metric--negative',
                )}
              >
                <span className="section-label">Utilisation</span>
                <span className="metric-value">
                  {summary.totalLimit > 0 ? formatPercent(summary.utilization, 0) : '—'}
                </span>
                <span className="metric-hint">
                  {/* 30% is the figure credit scoring actually uses, so it is
                      worth naming rather than leaving the bar to imply it. */}
                  {tone === 'ok' ? 'Under 30% — healthy' : tone === 'warning' ? 'Over 30%' : 'Over the limit'}
                </span>
              </div>
            </div>
          </section>

          <div className="credit-grid">{cards.map(cardPanel)}</div>
        </>
      )}

      <PayBillForm
        open={Boolean(payingCard)}
        card={payingCard}
        wallets={payableFrom}
        busy={busy}
        error={actionError}
        onClose={() => {
          setPayingCard(null);
          setActionError(null);
        }}
        onSubmit={payBill}
      />

      <InstallmentForm
        open={Boolean(planningCard)}
        card={planningCard}
        busy={busy}
        error={actionError}
        onClose={() => {
          setPlanningCard(null);
          setActionError(null);
        }}
        onSubmit={createPlan}
      />

      <WalletForm
        open={formOpen}
        wallet={editing}
        defaultKind="credit"
        busy={credit.wallets.mutating}
        error={credit.wallets.mutationError}
        onClose={() => {
          setFormOpen(false);
          setEditing(undefined);
          credit.wallets.clearMutationError();
        }}
        onSubmit={saveCard}
      />
    </>
  );
}
