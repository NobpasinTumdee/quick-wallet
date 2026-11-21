import { AlertTriangle, Check, Search, Target } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useExcelDB } from '../../hooks/useExcelDB';
import { cx, formatCompactAmount } from '../../lib/format';
import { ringPercent } from '../../lib/goalMath';
import { projectBudget } from '../../lib/planning/milestones';
import { useMoneyFormatter, useSettings } from '../../state/SettingsContext';
import type { Goal } from '../../types';
import type { PlanningData, PlanProject } from '../../types/planning';
import { Icon } from '../Icon';
import { Button, Modal } from '../ui';

/**
 * A project's goal link and money: the "Linked goal" field and its picker
 * (project sheet), the goal chip and the budget totals (board header and
 * project tiles). Goals come from the same request-cache key as Home and the
 * Goals page, and are only asked for when a project has a goal linked.
 */

/** Same number the Goals page shows (its ring, rounded). */
function goalPercent(goal: Goal): number {
  return Math.round(ringPercent(goal));
}

function openGoal(goal: Goal) {
  /* There is no goal-by-id route: the Goals page's search finds it (as Notes does). */
  window.location.hash = `#/goals?q=${encodeURIComponent(goal.title.slice(0, 80))}`;
}

export function GoalPicker({
  open,
  value,
  onPick,
  onClose,
}: {
  open: boolean;
  value: string;
  onPick: (id: string) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const goals = useExcelDB<Goal>('goals', undefined, { enabled: open });
  const [search, setSearch] = useState('');
  const rows = useMemo(() => {
    const q = search.trim().toLocaleLowerCase();
    return goals.items.filter((g) => !q || g.title.toLocaleLowerCase().includes(q));
  }, [goals.items, search]);
  return (
    <Modal open={open} title={t('planning.linkGoal')} onClose={onClose} width={520} className="plan-picker">
      <div className="plan-picker-tools">
        <label className="plan-search">
          <Icon icon={Search} size="sm" />
          <input
            type="search"
            value={search}
            placeholder={t('planning.searchGoals')}
            aria-label={t('planning.searchGoals')}
            enterKeyHint="search"
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
      </div>
      {goals.initialLoading ? (
        <ul className="plan-tx-list" aria-busy="true">
          {[0, 1, 2].map((i) => (
            <li key={i} className="plan-tx-sk" />
          ))}
        </ul>
      ) : rows.length ? (
        <ul className="plan-tx-list">
          {rows.map((goal) => (
            <li key={goal.id}>
              <button
                type="button"
                className={cx('plan-tx', goal.id === value && 'is-linked')}
                aria-pressed={goal.id === value}
                onClick={() => {
                  onPick(goal.id);
                  onClose();
                }}
              >
                <span className="plan-tx-check plan-tx-check--icon" aria-hidden="true">
                  <Icon icon={goal.id === value ? Check : Target} size="sm" />
                </span>
                <span className="plan-tx-body">
                  <span className="plan-tx-title">{goal.title}</span>
                  <GoalMeta goal={goal} />
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="plan-quiet plan-picker-empty">{goals.items.length ? t('planning.noGoalsFound') : t('planning.noGoalsYet')}</p>
      )}
    </Modal>
  );
}

function GoalMeta({ goal }: { goal: Goal }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  return (
    <span className="plan-tx-meta">
      {goalPercent(goal)}% ·{' '}
      {t('planning.goalSavedOf', {
        saved: formatCompactAmount(money.convert(Number(goal.savedAmount) || 0), settings.locale),
        target: formatCompactAmount(money.convert(Number(goal.targetAmount) || 0), settings.locale),
      })}
    </span>
  );
}

/** The project sheet's "Linked goal" field: the goal, Change / Unlink, or Link a goal. */
export function LinkedGoalField({ value, missing, onChange }: { value: string; missing: boolean; onChange: (id: string) => void }) {
  const { t } = useTranslation();
  const goals = useExcelDB<Goal>('goals', undefined, { enabled: Boolean(value) });
  const [picking, setPicking] = useState(false);
  const goal = value ? goals.items.find((g) => g.id === value) : undefined;
  const gone = Boolean(value) && (missing || (!goals.initialLoading && !goal));
  return (
    <div className="plan-goal-field">
      {goal && (
        <span className="plan-goal-current">
          <Icon icon={Target} size="sm" />
          <span className="plan-goal-current-body">
            <span className="plan-goal-current-title">{goal.title}</span>
            <GoalMeta goal={goal} />
          </span>
        </span>
      )}
      {gone && (
        <p className="plan-hint plan-hint--error" role="status">
          <Icon icon={AlertTriangle} size="sm" />
          {t('planning.goalMissing')}
        </p>
      )}
      {!value && <p className="plan-hint">{t('planning.goalHint')}</p>}
      <div className="plan-goal-actions">
        <Button size="sm" variant="secondary" onClick={() => setPicking(true)}>
          {value ? t('planning.changeGoal') : t('planning.linkGoal')}
        </Button>
        {value && (
          <Button size="sm" variant="ghost" onClick={() => onChange('')}>
            {t('planning.unlinkGoal')}
          </Button>
        )}
      </div>
      <GoalPicker open={picking} value={value} onPick={onChange} onClose={() => setPicking(false)} />
    </div>
  );
}

/** The board header's goal: its name and progress; tapping it opens the goal. */
export function ProjectGoalChip({ project }: { project: PlanProject }) {
  const { t } = useTranslation();
  const goals = useExcelDB<Goal>('goals', undefined, { enabled: Boolean(project.linkedGoalId) && !project.linkedGoalMissing });
  if (!project.linkedGoalId) return null;
  const goal = goals.items.find((g) => g.id === project.linkedGoalId);
  if (project.linkedGoalMissing || (!goals.initialLoading && !goal)) {
    return (
      <span className="plan-goal-chip plan-goal-chip--gone">
        <Icon icon={AlertTriangle} size="sm" />
        {t('planning.goalMissing')}
      </span>
    );
  }
  if (!goal) return <span className="plan-goal-chip plan-goal-chip--loading" aria-hidden="true" />;
  const percent = goalPercent(goal);
  return (
    <button type="button" className="plan-goal-chip" onClick={() => openGoal(goal)} aria-label={t('planning.goalChip', { title: goal.title, percent })}>
      <Icon icon={Target} size="sm" />
      <span className="plan-goal-chip-title">{goal.title}</span>
      <span className="plan-goal-chip-bar" aria-hidden="true">
        <span style={{ width: `${percent}%` }} />
      </span>
      <span className="plan-goal-chip-pct">{percent}%</span>
    </button>
  );
}

/** Budget · Spent · Left (or Over), compact; nothing at all when no card has a budget. */
export function BudgetSummary({ data, projectId, className }: { data: PlanningData; projectId: string; className?: string }) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const totals = projectBudget(data, projectId);
  if (!totals.has) return null;
  const fmt = (value: number) => formatCompactAmount(money.convert(value), settings.locale);
  return (
    /* Spans, not a <dl>: the project tile is a button. */
    <span className={cx('plan-money', className)} role="group" aria-label={t('planning.budgetSummaryLabel')}>
      <span className="plan-money-part">
        <span className="plan-money-label">{t('planning.sumBudget')}</span> <span className="plan-money-value">{fmt(totals.budget)}</span>
      </span>
      <span className="plan-money-part">
        <span className="plan-money-label">{t('planning.sumSpent')}</span> <span className="plan-money-value">{fmt(totals.spent)}</span>
      </span>
      <span className={cx('plan-money-part', totals.over && 'is-over')}>
        <span className="plan-money-label">{totals.over ? t('planning.sumOver') : t('planning.sumLeft')}</span>{' '}
        <span className="plan-money-value">{fmt(Math.abs(totals.remaining))}</span>
      </span>
    </span>
  );
}
