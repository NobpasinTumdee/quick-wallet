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
import { useTranslation } from 'react-i18next';

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
  const { t } = useTranslation();
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
        t('cards.billPaidBody', { amount: money(payload.amount), name: payingCard.wallet.name }),
        t('cards.billPaid'),
      );
      setPayingCard(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('cards.paymentFailed'));
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
        t('cards.planCreatedBody', {
          count: plan.months,
          amount: money(plan.monthly),
          name: planningCard.wallet.name,
        }),
        t('cards.planCreated'),
      );
      setPlanningCard(null);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : t('cards.planFailed'));
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
              <span className="section-label">{t('cards.statementBalance')}</span>
              <span className="metric-value">{money(card.statementBalance)}</span>
              <span className="metric-hint">
                {card.paymentDueDate ? (
                  <>
                    {t('cards.dueOn', { date: formatDate(card.paymentDueDate, settings.locale) })}
                    {card.daysUntilDue !== null && (
                      <>
                        {' · '}
                        {card.daysUntilDue < 0
                          ? t('cards.daysLate', { count: Math.abs(card.daysUntilDue) })
                          : card.daysUntilDue === 0
                            ? t('cards.dueToday')
                            : t('cards.dueInDays', { count: card.daysUntilDue })}
                      </>
                    )}
                  </>
                ) : (
                  t('cards.setCycleHint')
                )}
              </span>
            </div>

            <div className="metric">
              <span className="section-label">{t('cards.unbilled')}</span>
              <span className="metric-value">{money(card.unbilledBalance)}</span>
              <span className="metric-hint">
                {card.nextStatementDate
                  ? t('cards.billsOn', { date: formatDate(card.nextStatementDate, settings.locale) })
                  : t('cards.sinceOpened')}
              </span>
            </div>

            <div className={cx('metric', card.availableCredit < 0 && 'metric--negative')}>
              <span className="section-label">{t('cards.availableCredit')}</span>
              <span
                className={cx('metric-value', card.availableCredit < 0 && 'text-negative')}
              >
                {card.hasLimit ? money(card.availableCredit) : '—'}
              </span>
              <span className="metric-hint">
                {card.hasLimit
                  ? t('cards.percentOfUsed', {
                      percent: formatPercent(card.utilization, 0),
                      amount: money(wallet.creditLimit, { compact: true }),
                    })
                  : t('cards.noLimitSet')}
              </span>
            </div>

            {card.scheduledBalance > 0 && (
              <div className="metric metric--accent">
                <span className="section-label">{t('cards.scheduled')}</span>
                <span className="metric-value">{money(card.scheduledBalance)}</span>
                <span className="metric-hint">{t('cards.scheduledHint')}</span>
              </div>
            )}
          </div>

          {noCycle && (
            <Alert tone="info">
              {t('cards.noCycleWarning')}
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
              title={card.currentBalance <= 0 ? t('cards.nothingOwed') : undefined}
            >
              {t('cards.payBill')}
            </Button>
            <Button
              size="sm"
              onClick={() => {
                setActionError(null);
                setPlanningCard(card);
              }}
            >
              {t('cards.newInstallment')}
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
              {t('common.edit')}
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
          <span className="section-label">{t('cards.debt')}</span>
          <h1 className="page-title">{t('cards.title')}</h1>
          <p className="page-lede">
            {t('cards.lede')}
          </p>
        </div>
        <div className="cluster">
          <RefreshButton onRefresh={credit.refresh} busy={credit.isValidating} label={t('cards.refresh')} />
          <Button size="sm" variant="primary" onClick={openNewCard}>
            <Icon icon={Plus} size="sm" />
            {t('cards.newCard')}
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
        <Alert tone="error" title={t('cards.overdueTitle')}>
          {t('cards.overdueBody', {
            names: summary.overdue.map((card) => card.wallet.name).join(', '),
          })}
        </Alert>
      )}
      {summary.dueSoon.length > 0 && (
        <Alert tone="warning" title={t('cards.dueSoonTitle')}>
          {summary.dueSoon
            .map((card) =>
              t('cards.dueSoonEntry', {
                name: card.wallet.name,
                amount: money(card.statementBalance),
                date: formatDate(card.paymentDueDate ?? '', settings.locale),
              }),
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
            title={t('cards.emptyTitle')}
            description={t('cards.emptyBody')}
            action={
              <Button variant="primary" onClick={openNewCard}>
                {t('cards.addCard')}
              </Button>
            }
          />
        </Card>
      ) : (
        <>
          {/* ---- Roll-up across every card ---- */}
          <section className={cx('debt-hero', `debt-hero--${tone}`)}>
            <div className="debt-hero-primary">
              <span className="section-label">{t('cards.totalOwed')}</span>
              <span className="hero-value">{money(summary.totalDebt)}</span>
              <div className="hero-meta">
                <Badge tone={summary.totalStatementBalance > 0 ? 'warning' : 'positive'}>
                  {t('cards.billed', { amount: money(summary.totalStatementBalance) })}
                </Badge>
                <span>
                  {t('cards.acrossCards', { count: cards.length })}
                  {summary.totalScheduled > 0 &&
                    t('cards.scheduledSuffix', {
                      amount: money(summary.totalScheduled, { compact: true }),
                    })}
                </span>
              </div>
            </div>

            <div className="hero-metrics">
              <div className="metric">
                <span className="section-label">{t('cards.availableCredit')}</span>
                <span className="metric-value">
                  {summary.totalLimit > 0 ? money(summary.totalAvailable, { compact: true }) : '—'}
                </span>
                <span className="metric-hint">
                  {summary.totalLimit > 0
                    ? t('cards.ofLimit', { amount: money(summary.totalLimit, { compact: true }) })
                    : t('cards.noLimits')}
                </span>
              </div>
              <div
                className={cx(
                  'metric',
                  tone === 'ok' ? 'metric--positive' : tone === 'warning' ? 'metric--accent' : 'metric--negative',
                )}
              >
                <span className="section-label">{t('cards.utilisation')}</span>
                <span className="metric-value">
                  {summary.totalLimit > 0 ? formatPercent(summary.utilization, 0) : '—'}
                </span>
                <span className="metric-hint">
                  {/* 30% is the figure credit scoring actually uses, so it is
                      worth naming rather than leaving the bar to imply it. */}
                  {t(
                    tone === 'ok'
                      ? 'cards.utilisationHealthy'
                      : tone === 'warning'
                        ? 'cards.utilisationHigh'
                        : 'cards.utilisationOver',
                  )}
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
