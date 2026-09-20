import { BadgeCheck, Minus, Plus, ShoppingBag } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { Button } from './ui';
import { goalPace, readyToBuy, ringPercent } from '../lib/goalMath';
import { cx, formatDate } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Goal } from '../types';

/**
 * One sinking fund, as a card.
 *
 * ---------------------------------------------------------------------------
 * THE THREE STATES, AND WHY THEY LOOK DIFFERENT
 * ---------------------------------------------------------------------------
 *   Saving     the ordinary state: fund, withdraw, edit.
 *   Ready      fully funded and not yet bought. This is the only state that
 *              gets a glowing button, because it is the only one where the app
 *              is asking for a decision rather than reporting a number.
 *   Purchased  done. The card desaturates and the money buttons disappear —
 *              funding a thing you already own is not an action worth
 *              offering, and leaving the button there invites a second expense
 *              for the same purchase.
 *
 * Only one call to action is ever shown at a time. A card with Buy *and* Fund
 * competing at equal weight makes the reader choose between two things that
 * are not alternatives.
 */
export function GoalCard({
  goal,
  onFund,
  onWithdraw,
  onBuy,
  onEdit,
  onDelete,
}: {
  goal: Goal;
  onFund: () => void;
  onWithdraw: () => void;
  onBuy: () => void;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const locale = settings.locale;

  const pace = goalPace(goal);
  const percent = ringPercent(goal);
  const ready = readyToBuy(goal);
  const purchased = goal.purchased;

  return (
    <article
      className={cx(
        'goal-card',
        goal.complete && !purchased && 'is-complete',
        ready && 'is-ready',
        purchased && 'is-purchased',
      )}
    >
      <header className="goal-head">
        <GoalRing
          percent={percent}
          color={purchased ? 'var(--positive)' : goal.color || 'var(--accent)'}
          label={`${goal.title} ${Math.round(percent)}%`}
        />
        <div className="goal-identity">
          <h3>{goal.title}</h3>
          <span className="goal-amounts">
            {purchased
              ? t('goals.paidAmount', { amount: money(goal.targetAmount) })
              : t('goals.saved', {
                  saved: money(goal.savedAmount),
                  target: money(goal.targetAmount),
                })}
          </span>
        </div>
      </header>

      {goal.note && <p className="goal-note">{goal.note}</p>}

      <div className="goal-meta">
        {purchased ? (
          /* The badge carries an icon and a word, never colour alone. */
          <span className="goal-chip goal-chip--purchased">
            <Icon icon={BadgeCheck} size="sm" />
            {goal.purchasedAt
              ? t('goals.purchasedOn', { date: formatDate(goal.purchasedAt, locale) })
              : t('goals.purchased')}
          </span>
        ) : goal.complete ? (
          <span className="goal-chip goal-chip--done">{t('goals.complete')}</span>
        ) : (
          <span className="goal-chip">{t('goals.remaining', { amount: money(goal.remaining) })}</span>
        )}

        {/* A deadline on a bought goal is history, not a schedule. */}
        {!purchased &&
          (goal.deadline ? (
            <span className={cx('goal-chip', pace.overdue && 'goal-chip--late')}>
              {pace.overdue
                ? t('goals.overdue')
                : t('goals.deadline', { date: formatDate(goal.deadline, locale) })}
            </span>
          ) : (
            <span className="goal-chip goal-chip--quiet">{t('goals.noDeadline')}</span>
          ))}

        {/* Only worth saying while there is still something to save and a date
            to hit it by. */}
        {!purchased && !goal.complete && !pace.open && pace.perMonth > 0 && (
          <span className="goal-chip goal-chip--quiet">
            {pace.overdue ? t('goals.perMonthPast') : t('goals.perMonth', { amount: money(pace.perMonth) })}
          </span>
        )}
      </div>

      <div className="goal-actions">
        {purchased ? (
          /* Nothing to fund and nothing to buy. Edit and delete stay: the card
             is still a record the user may want to rename or clear out. */
          <span className="goal-done-note">{t('goals.purchasedHint')}</span>
        ) : ready ? (
          <Button size="sm" variant="primary" className="goal-buy" onClick={onBuy}>
            <Icon icon={ShoppingBag} size="sm" />
            {t('goals.buyNow')}
          </Button>
        ) : (
          <>
            <Button size="sm" variant="primary" onClick={onFund}>
              <Icon icon={Plus} size="sm" />
              {t('goals.fund')}
            </Button>
            <Button size="sm" variant="ghost" disabled={goal.savedAmount <= 0} onClick={onWithdraw}>
              <Icon icon={Minus} size="sm" />
              {t('goals.withdraw')}
            </Button>
          </>
        )}

        {/* Still reachable while a funded goal offers Buy: the money is saved,
            but taking some back out is a thing people do. */}
        {ready && (
          <Button size="sm" variant="ghost" onClick={onWithdraw}>
            <Icon icon={Minus} size="sm" />
            {t('goals.withdraw')}
          </Button>
        )}

        <div className="spacer" />
        <Button size="sm" variant="ghost" onClick={onEdit}>
          {t('common.edit')}
        </Button>
        <Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={onDelete}>
          ✕
        </Button>
      </div>
    </article>
  );
}

/** The progress ring. An SVG arc, sized by the dash offset. */
export function GoalRing({
  percent,
  color,
  label,
}: {
  percent: number;
  color: string;
  label: string;
}) {
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
