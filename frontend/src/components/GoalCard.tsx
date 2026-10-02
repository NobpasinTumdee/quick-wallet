import { BadgeCheck, Minus, Plus, ShoppingBag } from 'lucide-react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { Button, ProgressBar } from './ui';
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
      {/* Name left, target right — the two things a goal is, on one line that
          survives a 375px screen. The progress ring that used to sit here is
          gone: a ring *and* a bar are two readings of one number, and the bar
          is the one that can carry a label. */}
      <header className="goal-head">
        <span
          className="goal-dot"
          style={{ background: purchased ? 'var(--positive)' : goal.color || 'var(--accent)' }}
          aria-hidden="true"
        />
        <h3 className="goal-title">{goal.title}</h3>
        <span className="goal-target">{money(goal.targetAmount)}</span>
      </header>

      <div className="goal-progress">
        <ProgressBar
          percent={percent}
          tone={goal.complete || purchased ? 'ok' : 'warning'}
          label={`${goal.title} ${Math.round(percent)}%`}
        />
        <div className="goal-progress-legend">
          <span>
            {purchased
              ? t('goals.paidAmount', { amount: money(goal.targetAmount) })
              : t('goals.savedAmount', { amount: money(goal.savedAmount) })}
          </span>
          <strong>{Math.round(percent)}%</strong>
        </div>
      </div>

      {goal.note && <GoalNote note={goal.note} />}

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
        {/* Edit and delete travel as one unit. When the row wraps — a narrow
            card, or a longer translation — a lone ✕ on its own line reads as a
            mistake rather than as the end of a group. */}
        <div className="goal-actions-end">
          <Button size="sm" variant="ghost" onClick={onEdit}>
            {t('common.edit')}
          </Button>
          <Button size="sm" variant="ghost" aria-label={t('common.delete')} onClick={onDelete}>
            ✕
          </Button>
        </div>
      </div>
    </article>
  );
}

/**
 * The goal's note, which is free text and therefore occasionally hostile.
 *
 * ---------------------------------------------------------------------------
 * TWO SEPARATE PROBLEMS
 * ---------------------------------------------------------------------------
 * A *long* note makes the card tall, which is untidy. A long note *without
 * spaces* — a pasted URL, or someone leaning on a key — cannot be broken at
 * all by the normal rules, so it pushes the card wider than the screen and
 * takes the whole page's horizontal scrollbar with it.
 *
 * They need different fixes and both are needed: `overflow-wrap: anywhere` in
 * the stylesheet lets an unbroken run be split mid-word, and the clamp here
 * keeps a long but ordinary note to two lines until it is asked for.
 *
 * The toggle only appears when it would do something. A "Show more" under a
 * one-line note is a control that lies about there being more.
 */
function GoalNote({ note }: { note: string }) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);

  /* Measured rather than guessed: the clamp is two lines, and whether a given
     note exceeds it depends on the card's width and the reader's font. The
     element reports its own overflow. */
  const [overflows, setOverflows] = useState(false);

  return (
    <div className="goal-note-block">
      <p
        className={cx('goal-note', !expanded && 'is-clamped')}
        ref={(element) => {
          if (!element) return;
          /* scrollHeight exceeds clientHeight only while the clamp is actually
             hiding something, so this is asked while collapsed. */
          if (!expanded) setOverflows(element.scrollHeight > element.clientHeight + 1);
        }}
      >
        {note}
      </p>

      {(overflows || expanded) && (
        <button type="button" className="goal-note-toggle" onClick={() => setExpanded((open) => !open)}>
          {t(expanded ? 'goals.showLess' : 'goals.showMore')}
        </button>
      )}
    </div>
  );
}
