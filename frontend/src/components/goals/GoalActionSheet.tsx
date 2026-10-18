import { LucideIcon, Minus, Pencil, Plus, ShoppingBag, Star, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../Icon';
import { Modal } from '../ui';
import { cx } from '../../lib/format';
import { readyToBuy } from '../../lib/goalMath';
import { goalReview } from '../../lib/goalReview';
import { Goal } from '../../types';

export interface GoalActionHandlers {
  onFund: (goal: Goal) => void;
  onWithdraw: (goal: Goal) => void;
  onBuy: (goal: Goal) => void;
  onReview: (goal: Goal) => void;
  onEdit: (goal: Goal) => void;
  onDelete: (goal: Goal) => void;
}

interface SheetAction {
  key: string;
  icon: LucideIcon;
  label: string;
  run: () => void;
  danger?: boolean;
  disabled?: boolean;
}

/**
 * The phone's "⋯" menu for one goal.
 *
 * A list of full-width rows rather than swipe actions: a swipe is invisible
 * until discovered, collides with the horizontal chip row and the gesture
 * navigation, and has no keyboard or screen-reader equivalent. A sheet is one
 * tap away and every action in it is labelled.
 *
 * Only the actions that make sense for the goal's state are listed — the same
 * rule the card follows, so a bought goal never offers "Add money".
 */
export function GoalActionSheet({
  goal,
  onClose,
  handlers,
}: {
  goal: Goal | null;
  onClose: () => void;
  handlers: GoalActionHandlers;
}) {
  const { t } = useTranslation();
  if (!goal) return null;

  /* Close first, then act: the next dialog opens on a clean stack instead of
     on top of this one. */
  const run = (fn: (g: Goal) => void) => () => {
    onClose();
    fn(goal);
  };

  const actions: SheetAction[] = [];
  if (goal.purchased) {
    actions.push({
      key: 'review',
      icon: Star,
      label: t(goalReview(goal).reviewed ? 'goals.editReview' : 'goals.reviewPurchase'),
      run: run(handlers.onReview),
    });
  } else {
    if (readyToBuy(goal)) {
      actions.push({ key: 'buy', icon: ShoppingBag, label: t('goals.buyNow'), run: run(handlers.onBuy) });
    }
    actions.push({ key: 'fund', icon: Plus, label: t('goals.fund'), run: run(handlers.onFund) });
    actions.push({
      key: 'withdraw',
      icon: Minus,
      label: t('goals.withdraw'),
      run: run(handlers.onWithdraw),
      disabled: goal.savedAmount <= 0,
    });
  }
  actions.push({ key: 'edit', icon: Pencil, label: t('common.edit'), run: run(handlers.onEdit) });
  actions.push({ key: 'delete', icon: Trash2, label: t('common.delete'), run: run(handlers.onDelete), danger: true });

  return (
    <Modal open onClose={onClose} title={goal.title} width={420}>
      <ul className="goal-sheet">
        {actions.map((action) => (
          <li key={action.key}>
            <button
              type="button"
              className={cx('goal-sheet-item', action.danger && 'is-danger')}
              onClick={action.run}
              disabled={action.disabled}
            >
              <Icon icon={action.icon} size="md" />
              <span>{action.label}</span>
            </button>
          </li>
        ))}
      </ul>
    </Modal>
  );
}
