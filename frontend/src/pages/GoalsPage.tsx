import { PiggyBank, Plus, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GoalCard } from '../components/GoalCard';
import { GoalForm, GoalPayload } from '../components/GoalForm';
import { GoalPurchaseModal } from '../components/GoalPurchaseModal';
import { Icon } from '../components/Icon';
import {
  Alert,
  Button,
  Card,
  DecimalInput,
  EmptyState,
  Field,
  Modal,
  RefreshButton,
  Skeleton,
  parseDecimal,
} from '../components/ui';
import { useExcelDB } from '../hooks/useExcelDB';
import { useGoals } from '../hooks/useGoals';
import { allocationSummary } from '../lib/goalMath';
import { cx, formatPercent, todayKey } from '../lib/format';
import { toast } from '../lib/toast';
import { useMoneyFormatter } from '../state/SettingsContext';
import { Goal, WalletBalance } from '../types';

/**
 * Sinking funds — virtual envelopes.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE HEADER IS FOR
 * ---------------------------------------------------------------------------
 * Three figures, and the gap between the first and the third is the entire
 * feature: you hold X, you have promised Y, so you can actually spend Z. Every
 * other screen in this app answers "what do I have"; this is the only one that
 * answers "what is actually free".
 *
 * Funding writes no Transaction and moves no balance — see `lib/goalMath.ts`.
 * Buying does both, once, at the end of a goal's life: see `purchase` in
 * `useGoals`, and the wallet dialog it goes through.
 */

interface FundTarget {
  goal: Goal;
  /** Adding or taking out — same sheet, opposite sign. */
  direction: 'add' | 'withdraw';
}

export function GoalsPage() {
  const { t } = useTranslation();
  const money = useMoneyFormatter();

  const goals = useGoals();
  const wallets = useExcelDB<WalletBalance>('wallets');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | undefined>();
  const [fundTarget, setFundTarget] = useState<FundTarget | null>(null);
  /** Raw string so a half-typed decimal survives; parsed on confirm. */
  const [fundAmount, setFundAmount] = useState('');

  /* The purchase flow: which goal is being bought, and out of what. */
  const [buying, setBuying] = useState<Goal | null>(null);
  const [payWalletId, setPayWalletId] = useState('');
  const [payDate, setPayDate] = useState(todayKey);
  const [buyError, setBuyError] = useState<string | null>(null);
  const [buyBusy, setBuyBusy] = useState(false);

  const allocation = allocationSummary(wallets.items, goals.items);

  /* A goal is bought with real cash, so a brokerage account is not an option —
     the server refuses `mode: 'investment'` outright, and offering it here
     would only let the user pick something that comes back as an error. */
  const payableFrom = useMemo(
    () => wallets.items.filter((w) => !w.archived && w.mode === 'expense'),
    [wallets.items],
  );

  function openBuy(goal: Goal) {
    setBuying(goal);
    setBuyError(null);
    /* Defaulted to the fullest wallet: the one most likely to cover it, and
       the choice is one tap away in the dropdown either way. */
    const richest = [...payableFrom].sort((a, b) => b.balance - a.balance)[0];
    setPayWalletId(richest?.id ?? '');
    setPayDate(todayKey());
  }

  async function confirmBuy() {
    if (!buying || !payWalletId) return;
    setBuyBusy(true);
    setBuyError(null);
    try {
      const result = await goals.purchase(buying.id, payWalletId, { date: payDate });
      setBuying(null);
      toast.success(
        t('goals.purchaseDone', { title: result.goal.title, amount: money(result.transaction.amount) }),
        t('goals.purchased'),
      );
    } catch (error) {
      /* Kept in the dialog rather than toasted away: the wallet choice is
         still on screen and is the thing most likely to need changing. */
      setBuyError(error instanceof Error ? error.message : String(error));
    } finally {
      setBuyBusy(false);
    }
  }

  function closeForm() {
    setFormOpen(false);
    setEditing(undefined);
    goals.clearMutationError();
  }

  async function save(payload: GoalPayload) {
    if (editing) await goals.update(editing.id, payload);
    else await goals.create(payload);
    closeForm();
  }

  async function remove(goal: Goal) {
    if (!window.confirm(t('goals.deleteConfirm', { title: goal.title }))) return;
    await goals.remove(goal.id);
  }

  function openFund(goal: Goal, direction: FundTarget['direction']) {
    setFundTarget({ goal, direction });
    // Prefilling the shortfall makes the common case one tap; withdrawing has
    // no equivalent obvious figure, so it starts blank.
    setFundAmount(direction === 'add' ? String(Math.max(0, goal.remaining) || '') : '');
  }

  const fundValue = parseDecimal(fundAmount);

  async function confirmFund() {
    if (!fundTarget || fundValue <= 0) return;
    const { goal, direction } = fundTarget;

    try {
      await goals.fund(goal, direction === 'add' ? fundValue : -fundValue);
      setFundTarget(null);
    } catch {
      /* useExcelDB toasted it; leave the sheet open so the amount survives. */
    }
  }

  if (goals.initialLoading || wallets.initialLoading) {
    return (
      <Card title={t('goals.title')}>
        <Skeleton rows={4} />
      </Card>
    );
  }

  return (
    <>
      {/* ---- Cash vs locked vs available ---- */}
      <section className="alloc">
        <div className="alloc-figures">
          <div className="alloc-figure">
            <span className="section-label">{t('goals.totalCash')}</span>
            <strong>{money(allocation.totalCash)}</strong>
            <span className="alloc-hint">{t('goals.totalCashHint')}</span>
          </div>
          <div className="alloc-figure alloc-figure--locked">
            <span className="section-label">{t('goals.lockedInGoals')}</span>
            <strong>{money(allocation.locked)}</strong>
            <span className="alloc-hint">{t('goals.lockedInGoalsHint')}</span>
          </div>
          <div
            className={cx('alloc-figure', 'alloc-figure--available', allocation.overCommitted && 'is-over')}
          >
            <span className="section-label">{t('goals.availableToSpend')}</span>
            <strong>{money(allocation.available)}</strong>
            <span className="alloc-hint">{t('goals.availableToSpendHint')}</span>
          </div>
        </div>

        {/* One bar, two parts: promised and free. The whole is your cash. */}
        <div
          className="alloc-bar"
          style={{ '--locked': `${allocation.lockedPercent}%` } as React.CSSProperties}
          role="img"
          aria-label={`${formatPercent(allocation.lockedPercent, 0)} ${t('goals.lockedInGoals')}`}
        >
          <span className="alloc-bar-locked" />
        </div>
      </section>

      {allocation.overCommitted && (
        <Alert tone="warning" title={t('goals.overCommitted')}>
          {t('goals.overCommittedHint')}
        </Alert>
      )}

      <Card
        title={t('goals.title')}
        subtitle={t('goals.subtitle')}
        actions={
          <>
            <RefreshButton
              onRefresh={() => Promise.all([goals.refresh(), wallets.refresh()])}
              busy={goals.isValidating || wallets.isValidating}
              label={t('common.refresh')}
            />
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                setEditing(undefined);
                setFormOpen(true);
              }}
            >
              <Icon icon={Plus} size="sm" />
              {t('goals.addGoal')}
            </Button>
          </>
        }
        padded={false}
      >
        {goals.mutationError && (
          <div style={{ padding: 'var(--space-4) var(--space-4) 0' }}>
            <Alert tone="error" onDismiss={goals.clearMutationError}>
              {goals.mutationError}
            </Alert>
          </div>
        )}

        {goals.items.length === 0 ? (
          <EmptyState
            icon={<Icon icon={PiggyBank} size="xl" />}
            title={t('goals.empty')}
            description={t('goals.emptyHint')}
            action={
              <Button variant="primary" onClick={() => setFormOpen(true)}>
                {t('goals.addGoal')}
              </Button>
            }
          />
        ) : (
          <div className="goal-grid">
            {goals.items.map((goal) => (
              <GoalCard
                key={goal.id}
                goal={goal}
                onFund={() => openFund(goal, 'add')}
                onWithdraw={() => openFund(goal, 'withdraw')}
                onBuy={() => openBuy(goal)}
                onEdit={() => {
                  setEditing(goal);
                  setFormOpen(true);
                }}
                onDelete={() => void remove(goal)}
              />
            ))}
          </div>
        )}
      </Card>

      <GoalPurchaseModal
        goal={buying}
        wallets={payableFrom}
        walletId={payWalletId}
        onWalletId={setPayWalletId}
        date={payDate}
        onDate={setPayDate}
        busy={buyBusy}
        error={buyError}
        onClose={() => setBuying(null)}
        onConfirm={() => void confirmBuy()}
      />

      <GoalForm
        open={formOpen}
        goal={editing}
        busy={goals.mutating}
        error={goals.mutationError}
        onClose={closeForm}
        onSubmit={save}
      />

      {/* ---- Fund / withdraw ---- */}
      <Modal
        open={Boolean(fundTarget)}
        title={
          fundTarget?.direction === 'withdraw'
            ? t('goals.withdrawTitle', { title: fundTarget?.goal.title ?? '' })
            : t('goals.fundTitle', { title: fundTarget?.goal.title ?? '' })
        }
        onClose={() => setFundTarget(null)}
        width={400}
        footer={
          <>
            <Button onClick={() => setFundTarget(null)}>{t('common.cancel')}</Button>
            <Button
              variant="primary"
              loading={goals.mutating}
              disabled={fundValue <= 0}
              onClick={() => void confirmFund()}
            >
              {fundTarget?.direction === 'withdraw'
                ? t('goals.withdrawConfirm')
                : t('goals.fundConfirm')}
            </Button>
          </>
        }
      >
        {fundTarget && (
          <>
            <Field
              label={
                fundTarget.direction === 'withdraw'
                  ? t('goals.withdrawAmount')
                  : t('goals.fundAmount')
              }
              hint={
                fundTarget.direction === 'withdraw' ? t('goals.withdrawHint') : t('goals.fundHint')
              }
            >
              <DecimalInput
                value={fundAmount}
                onChange={setFundAmount}
                placeholder="0.00"
                autoFocus
              />
            </Field>

            {fundTarget.direction === 'withdraw' && fundTarget.goal.savedAmount > 0 && (
              <Button
                size="sm"
                variant="ghost"
                onClick={() => setFundAmount(String(fundTarget.goal.savedAmount))}
              >
                {t('goals.withdrawAll')}
              </Button>
            )}

            <p className="field-hint" style={{ marginTop: 10 }}>
              <Icon icon={Target} size="sm" />{' '}
              {t('goals.saved', {
                saved: money(
                  Math.max(
                    0,
                    fundTarget.goal.savedAmount +
                      (fundTarget.direction === 'add' ? fundValue : -fundValue),
                  ),
                ),
                target: money(fundTarget.goal.targetAmount),
              })}
            </p>
          </>
        )}
      </Modal>
    </>
  );
}
