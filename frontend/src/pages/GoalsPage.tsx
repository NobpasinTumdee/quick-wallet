import { Minus, PiggyBank, Plus, Target } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { GoalForm, GoalPayload } from '../components/GoalForm';
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
import { allocationSummary, goalPace, ringPercent } from '../lib/goalMath';
import { cx, formatDate, formatPercent } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
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
 */

/** The progress ring. An SVG arc, sized by the dash offset. */
function GoalRing({ percent, color, label }: { percent: number; color: string; label: string }) {
  const RADIUS = 26;
  const circumference = 2 * Math.PI * RADIUS;

  return (
    <svg className="goal-ring" viewBox="0 0 64 64" role="img" aria-label={label}>
      <circle className="goal-ring-track" cx="32" cy="32" r={RADIUS} />
      <circle
        className="goal-ring-fill"
        cx="32"
        cy="32"
        r={RADIUS}
        stroke={color}
        strokeDasharray={circumference}
        /* Offset shrinks as the goal fills. Rotated -90° in CSS so it starts at
           twelve o'clock rather than three. */
        strokeDashoffset={circumference * (1 - percent / 100)}
      />
      <text className="goal-ring-text" x="32" y="32">
        {Math.round(percent)}%
      </text>
    </svg>
  );
}

interface FundTarget {
  goal: Goal;
  /** Adding or taking out — same sheet, opposite sign. */
  direction: 'add' | 'withdraw';
}

export function GoalsPage() {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const locale = settings.locale;

  const goals = useGoals();
  const wallets = useExcelDB<WalletBalance>('wallets');

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | undefined>();
  const [fundTarget, setFundTarget] = useState<FundTarget | null>(null);
  /** Raw string so a half-typed decimal survives; parsed on confirm. */
  const [fundAmount, setFundAmount] = useState('');

  const allocation = allocationSummary(wallets.items, goals.items);

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
            {goals.items.map((goal) => {
              const pace = goalPace(goal);
              const percent = ringPercent(goal);

              return (
                <article key={goal.id} className={cx('goal-card', goal.complete && 'is-complete')}>
                  <header className="goal-head">
                    <GoalRing
                      percent={percent}
                      color={goal.color || 'var(--accent)'}
                      label={`${goal.title} ${Math.round(percent)}%`}
                    />
                    <div className="goal-identity">
                      <h3>{goal.title}</h3>
                      <span className="goal-amounts">
                        {t('goals.saved', {
                          saved: money(goal.savedAmount),
                          target: money(goal.targetAmount),
                        })}
                      </span>
                    </div>
                  </header>

                  {goal.note && <p className="goal-note">{goal.note}</p>}

                  <div className="goal-meta">
                    {goal.complete ? (
                      <span className="goal-chip goal-chip--done">{t('goals.complete')}</span>
                    ) : (
                      <span className="goal-chip">
                        {t('goals.remaining', { amount: money(goal.remaining) })}
                      </span>
                    )}

                    {goal.deadline ? (
                      <span className={cx('goal-chip', pace.overdue && 'goal-chip--late')}>
                        {pace.overdue
                          ? t('goals.overdue')
                          : t('goals.deadline', { date: formatDate(goal.deadline, locale) })}
                      </span>
                    ) : (
                      <span className="goal-chip goal-chip--quiet">{t('goals.noDeadline')}</span>
                    )}

                    {/* Only worth saying while there is still something to save
                        and a date to hit it by. */}
                    {!goal.complete && !pace.open && pace.perMonth > 0 && (
                      <span className="goal-chip goal-chip--quiet">
                        {pace.overdue
                          ? t('goals.perMonthPast')
                          : t('goals.perMonth', { amount: money(pace.perMonth) })}
                      </span>
                    )}
                  </div>

                  <div className="goal-actions">
                    <Button size="sm" variant="primary" onClick={() => openFund(goal, 'add')}>
                      <Icon icon={Plus} size="sm" />
                      {t('goals.fund')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={goal.savedAmount <= 0}
                      onClick={() => openFund(goal, 'withdraw')}
                    >
                      <Icon icon={Minus} size="sm" />
                      {t('goals.withdraw')}
                    </Button>
                    <div className="spacer" />
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => {
                        setEditing(goal);
                        setFormOpen(true);
                      }}
                    >
                      {t('common.edit')}
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={t('common.delete')}
                      onClick={() => void remove(goal)}
                    >
                      ✕
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </Card>

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
