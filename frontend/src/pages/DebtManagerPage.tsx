import { AlertTriangle, Banknote, CalendarClock, Landmark, Pencil, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DebtForm, DebtPayload } from '../components/DebtForm';
import { DebtPaymentModal } from '../components/DebtPaymentModal';
import { Icon } from '../components/Icon';
import { ListSkeleton } from '../components/Skeletons';
import { Alert, Badge, Button, Card, EmptyState, ProgressBar, RefreshButton } from '../components/ui';
import { useDebtManager } from '../hooks/useDebtManager';
import { payoffEstimate } from '../lib/debtMath';
import { cx } from '../lib/format';
import { toast } from '../lib/toast';
import { useMoneyFormatter } from '../state/SettingsContext';
import { Debt } from '../types';

/**
 * Debt management.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS LOOKS DIFFERENT FROM GOALS
 * ---------------------------------------------------------------------------
 * The two screens are structurally twins — a list of amounts with progress bars
 * — and that is exactly the problem. Funding a goal is optional and cheerful;
 * paying a debt is obligatory and comes out of a wallet. If they look the same,
 * they read the same, and the difference that matters gets lost.
 *
 * So this one runs on a deep violet ramp rather than the accent, and the
 * ordering is by cost rather than by hope: the highest APR first, because that
 * is the money bleeding fastest. The glassmorphism is unchanged — this is a
 * different register of the same design language, not a different app.
 *
 * ---------------------------------------------------------------------------
 * THE ONE ALARMING THING ON THE SCREEN
 * ---------------------------------------------------------------------------
 * A debt whose minimum payment does not cover its own monthly interest grows
 * forever, and nothing else on this page is worth shouting about by comparison.
 * It gets the only red, at the top, before the list.
 */
export function DebtManagerPage() {
  const { t } = useTranslation();
  const money = useMoneyFormatter();
  const debts = useDebtManager();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Debt | undefined>(undefined);
  const [paying, setPaying] = useState<Debt | null>(null);
  const [payError, setPayError] = useState<string | null>(null);
  const [payBusy, setPayBusy] = useState(false);

  const { summary } = debts;

  function save(payload: DebtPayload, id?: string) {
    setFormOpen(false);
    setEditing(undefined);
    const pending = id ? debts.update(id, payload) : debts.create(payload);
    pending.catch(() => undefined);
  }

  async function remove(debt: Debt) {
    if (!window.confirm(t('debt.deleteConfirm', { title: debt.title }))) return;
    await debts.remove(debt.id).catch(() => undefined);
  }

  async function pay(input: { amount: number; walletId: string; date: string; note: string }) {
    if (!paying) return;
    setPayBusy(true);
    setPayError(null);
    try {
      await debts.pay({ debt: paying, ...input });
      setPaying(null);
      toast.success(t('debt.paid'));
    } catch (error) {
      setPayError(error instanceof Error ? error.message : String(error));
    } finally {
      setPayBusy(false);
    }
  }

  return (
    <>
      <div className="page-head">
        <div className="stack" style={{ gap: 4 }}>
          <span className="section-label">{t('debt.title')}</span>
          <h1 className="page-title">{t('debt.heading')}</h1>
          <p className="page-lede">{t('debt.lede')}</p>
        </div>
        <div className="cluster">
          <RefreshButton
            onRefresh={debts.refresh}
            busy={debts.isValidating}
            label={t('debt.refresh')}
          />
          <Button size="sm" variant="primary" onClick={() => { setEditing(undefined); setFormOpen(true); }}>
            {t('debt.addDebt')}
          </Button>
        </div>
      </div>

      {debts.mutationError && (
        <Alert tone="error" onDismiss={debts.clearMutationError}>
          {debts.mutationError}
        </Alert>
      )}

      {/* The only thing on this page worth an alarm. */}
      {summary.neverAmortising.length > 0 && (
        <Alert tone="error" title={t('debt.neverAmortises')}>
          {t('debt.neverAmortisesCount', { count: summary.neverAmortising.length })}
        </Alert>
      )}

      {/* ---- Portfolio ---- */}
      {debts.debts.length > 0 && (
        <section className="hero hero--compact debt-hero">
          <div className="hero-primary">
            <span className="section-label">{t('debt.totalOutstanding')}</span>
            <span className="hero-value">{money(summary.totalOutstanding)}</span>
            <div className="hero-meta">
              <Badge tone={summary.activeCount ? 'negative' : 'positive'}>
                {summary.activeCount
                  ? t('debt.totalCommitmentHint', { count: summary.activeCount })
                  : t('debt.settled')}
              </Badge>
            </div>
          </div>

          <div className="debt-hero-stats">
            <div>
              <span className="section-label">{t('debt.totalCommitment')}</span>
              <strong>{money(summary.monthlyCommitment)}</strong>
            </div>
            <div>
              <span className="section-label">{t('debt.portfolioInterest')}</span>
              <strong>{money(summary.monthlyInterest)}</strong>
            </div>
            <div>
              <span className="section-label">{t('debt.paidOff')}</span>
              <strong>
                {t('debt.portfolioProgress', {
                  paid: money(summary.totalPaid),
                  principal: money(summary.totalPrincipal),
                })}
              </strong>
            </div>
          </div>
        </section>
      )}

      {/* ---- The list ---- */}
      {debts.initialLoading ? (
        <Card padded>
          <ListSkeleton rows={3} />
        </Card>
      ) : debts.error && !debts.debts.length ? (
        <Card padded>
          <Alert tone="error">{debts.error}</Alert>
        </Card>
      ) : debts.debts.length === 0 ? (
        <Card padded>
          <EmptyState
            icon={<Icon icon={Landmark} size="xl" />}
            title={t('debt.emptyTitle')}
            description={
              debts.payableFrom.length === 0 ? t('debt.createWalletFirst') : t('debt.emptyHint')
            }
            action={
              <Button variant="primary" onClick={() => setFormOpen(true)}>
                {t('debt.addDebt')}
              </Button>
            }
          />
        </Card>
      ) : (
        <div className="debt-list">
          {debts.debts.map((debt) => (
            <DebtCard
              key={debt.id}
              debt={debt}
              money={money}
              onPay={() => { setPayError(null); setPaying(debt); }}
              onEdit={() => { setEditing(debt); setFormOpen(true); }}
              onDelete={() => remove(debt)}
            />
          ))}
        </div>
      )}

      {debts.debts.length > 0 && <p className="debt-disclaimer">{t('debt.estimateNote')}</p>}

      <DebtForm
        open={formOpen}
        debt={editing}
        busy={debts.mutating}
        error={debts.mutationError}
        onClose={() => { setFormOpen(false); setEditing(undefined); }}
        onSubmit={save}
      />

      <DebtPaymentModal
        debt={paying}
        wallets={debts.payableFrom}
        busy={payBusy}
        error={payError}
        onClose={() => { setPaying(null); setPayError(null); }}
        onSubmit={pay}
      />
    </>
  );
}

function DebtCard({
  debt,
  money,
  onPay,
  onEdit,
  onDelete,
}: {
  debt: Debt;
  money: (value: number) => string;
  onPay: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const payoff = payoffEstimate(debt);

  return (
    <article className={cx('debt-card', debt.settled && 'is-settled', payoff.neverAmortises && 'is-alarming')}>
      <header className="debt-card-head">
        <div className="debt-card-identity">
          <span className="debt-card-mark" aria-hidden="true">
            <Icon icon={debt.settled ? Banknote : Landmark} />
          </span>
          <div>
            <h2 className="debt-card-title">{debt.title}</h2>
            <p className="debt-card-terms">
              {t('debt.aprValue', { rate: debt.interestRateApr })}
              {debt.dueDate > 0 && (
                <>
                  {' · '}
                  <Icon icon={CalendarClock} size="sm" />
                  {t('debt.dueDayValue', { day: debt.dueDate })}
                </>
              )}
            </p>
          </div>
        </div>

        {debt.settled ? (
          <Badge tone="positive">{t('debt.settled')}</Badge>
        ) : (
          <span className="debt-card-balance">
            <span className="section-label">{t('debt.outstanding')}</span>
            <strong>{money(debt.currentBalance)}</strong>
          </span>
        )}
      </header>

      {/* Principal vs paid. Labelled with both figures rather than a bare
          percentage — "34%" of an unstated number is not information. */}
      <div className="debt-card-progress">
        <ProgressBar
          percent={debt.percentPaid}
          tone="ok"
          label={t('debt.portfolioProgress', {
            paid: money(debt.paidAmount),
            principal: money(debt.principalAmount),
          })}
        />
        <p>
          {t('debt.portfolioProgress', {
            paid: money(debt.paidAmount),
            principal: money(debt.principalAmount),
          })}
        </p>
      </div>

      <dl className="debt-card-figures">
        <div>
          <dt>{t('debt.minimumPayment')}</dt>
          <dd>{debt.minimumPayment > 0 ? money(debt.minimumPayment) : t('common.notSet')}</dd>
        </div>
        <div>
          <dt>{t('debt.monthlyInterest')}</dt>
          <dd>{money(debt.projectedMonthlyInterest)}</dd>
        </div>
      </dl>

      {!debt.settled && (
        <p className={cx('debt-card-payoff', payoff.neverAmortises && 'is-alarming')}>
          {payoff.neverAmortises ? (
            <>
              <Icon icon={AlertTriangle} size="sm" />
              {t('debt.neverAmortisesHint', { amount: money(debt.projectedMonthlyInterest) })}
            </>
          ) : payoff.unknown ? (
            t('debt.payoffUnknown')
          ) : (
            <>
              {t('debt.payoffIn', { count: payoff.months ?? 0 })}
              {payoff.totalInterest !== null && payoff.totalInterest > 0 && (
                <> · {t('debt.payoffInterest', { amount: money(payoff.totalInterest) })}</>
              )}
            </>
          )}
        </p>
      )}

      <footer className="debt-card-actions">
        {!debt.settled && (
          <Button size="sm" variant="primary" onClick={onPay}>
            {t('debt.payDebt')}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onEdit} aria-label={t('debt.editDebt')}>
          <Icon icon={Pencil} size="sm" />
        </Button>
        <Button size="sm" variant="ghost" onClick={onDelete} aria-label={t('common.delete')}>
          <Icon icon={Trash2} size="sm" />
        </Button>
      </footer>
    </article>
  );
}
