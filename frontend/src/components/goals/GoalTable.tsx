import { ArrowDown, ArrowUp, Minus, Pencil, Plus, ShoppingBag, Star, Trash2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Icon } from '../Icon';
import { Button, ProgressBar } from '../ui';
import { GoalActionHandlers } from './GoalActionSheet';
import { cx, formatDate } from '../../lib/format';
import { GoalFilters, GoalRow, GoalSortKey } from '../../lib/goalFilters';
import { TranslationKey } from '../../locales';
import { useMoneyFormatter, useSettings } from '../../state/SettingsContext';

interface Column {
  key: string;
  labelKey: TranslationKey;
  /** The sort this header toggles, if any. */
  sort?: Exclude<GoalSortKey, 'auto'>;
  numeric?: boolean;
}

const COLUMNS: Column[] = [
  { key: 'goal', labelKey: 'goals.colGoal', sort: 'name' },
  { key: 'status', labelKey: 'goals.colStatus' },
  { key: 'progress', labelKey: 'goals.colProgress', sort: 'progress' },
  { key: 'target', labelKey: 'goals.colTarget', sort: 'target', numeric: true },
  { key: 'saved', labelKey: 'goals.colSaved', numeric: true },
  { key: 'spent', labelKey: 'goals.colSpent', sort: 'spent', numeric: true },
  { key: 'deadline', labelKey: 'goals.colDeadline', sort: 'deadline' },
  { key: 'completed', labelKey: 'goals.colCompleted', sort: 'completed' },
];

/**
 * The desktop table view.
 *
 * Desktop only — the page never renders it below the desktop breakpoint,
 * where eight columns cannot fit and the cards are the right shape. Headers
 * sort: the first click sorts ascending, the second flips it, exactly like
 * the Sort control in the side panel, which shows the same state.
 *
 * Actions are always visible rather than revealed on hover: a hover-only
 * control does not exist for a keyboard or a touchscreen laptop.
 */
export function GoalTable({
  rows,
  filters,
  onSort,
  handlers,
}: {
  rows: GoalRow[];
  filters: GoalFilters;
  onSort: (patch: Pick<GoalFilters, 'sort' | 'dir'>) => void;
  handlers: GoalActionHandlers;
}) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();
  const { settings } = useSettings();
  const locale = settings.locale;

  return (
    <div className="goal-table-wrap">
      <table className="goal-table">
        <caption className="sr-only">{t('goals.title')}</caption>
        <thead>
          <tr>
            {COLUMNS.map((column) => {
              const active = column.sort !== undefined && filters.sort === column.sort;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={cx(column.numeric && 'is-num')}
                  aria-sort={active ? (filters.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {column.sort ? (
                    <button
                      type="button"
                      className={cx('goal-table-sort', active && 'is-active')}
                      onClick={() =>
                        onSort({
                          sort: column.sort as GoalSortKey,
                          dir: active && filters.dir === 'asc' ? 'desc' : 'asc',
                        })
                      }
                    >
                      {t(column.labelKey)}
                      {active && <Icon icon={filters.dir === 'asc' ? ArrowUp : ArrowDown} size="sm" />}
                    </button>
                  ) : (
                    t(column.labelKey)
                  )}
                </th>
              );
            })}
            <th scope="col" className="is-actions">
              <span className="sr-only">{t('goals.colActions')}</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => {
            const { goal, spend } = row;
            const status = goal.purchased
              ? t('goals.statusPurchased')
              : row.ready
                ? t('goals.statusReady')
                : row.overdue
                  ? t('goals.statusOverdue')
                  : t('goals.statusSaving');
            return (
              <tr key={goal.id} className={cx(goal.purchased && 'is-purchased')}>
                <td>
                  <span className="goal-table-name">
                    <span
                      className="goal-dot"
                      style={{ background: goal.purchased ? 'var(--positive)' : goal.color || 'var(--accent)' }}
                      aria-hidden="true"
                    />
                    <span className="goal-table-title" title={goal.title}>
                      {goal.title}
                    </span>
                  </span>
                </td>
                <td>
                  <span
                    className={cx(
                      'goal-chip',
                      goal.purchased && 'goal-chip--purchased',
                      row.ready && 'goal-chip--done',
                      row.overdue && 'goal-chip--late',
                    )}
                  >
                    {status}
                  </span>
                </td>
                <td>
                  <span className="goal-table-progress">
                    <ProgressBar
                      percent={row.progress}
                      tone={row.progress >= 100 ? 'ok' : 'warning'}
                      label={`${goal.title} ${Math.round(row.progress)}%`}
                    />
                    <span>{Math.round(row.progress)}%</span>
                  </span>
                </td>
                <td className="is-num">{money(goal.targetAmount)}</td>
                <td className="is-num">{money(goal.savedAmount)}</td>
                <td className="is-num">
                  {spend ? (
                    <span title={spend.estimated ? t('goals.spendEstimatedTip') : undefined}>
                      {spend.estimated ? '≈ ' : ''}
                      {money(spend.amount)}
                    </span>
                  ) : (
                    <span className="goal-table-empty">—</span>
                  )}
                </td>
                <td>{goal.deadline ? formatDate(goal.deadline, locale) : <span className="goal-table-empty">—</span>}</td>
                <td>
                  {goal.purchased && goal.purchasedAt ? (
                    formatDate(goal.purchasedAt, locale)
                  ) : (
                    <span className="goal-table-empty">—</span>
                  )}
                </td>
                <td className="is-actions">
                  <span className="goal-table-actions">
                    {goal.purchased ? (
                      <Button size="sm" variant="ghost" onClick={() => handlers.onReview(goal)} title={t('goals.reviewPurchase')} aria-label={t('goals.reviewPurchase')}>
                        <Icon icon={Star} size="sm" />
                      </Button>
                    ) : row.ready ? (
                      <Button size="sm" variant="primary" onClick={() => handlers.onBuy(goal)}>
                        <Icon icon={ShoppingBag} size="sm" />
                        {t('goals.buyNow')}
                      </Button>
                    ) : (
                      <>
                        <Button size="sm" variant="ghost" onClick={() => handlers.onFund(goal)} title={t('goals.fund')} aria-label={t('goals.fund')}>
                          <Icon icon={Plus} size="sm" />
                        </Button>
                        <Button
                          size="sm"
                          variant="ghost"
                          disabled={goal.savedAmount <= 0}
                          onClick={() => handlers.onWithdraw(goal)}
                          title={t('goals.withdraw')}
                          aria-label={t('goals.withdraw')}
                        >
                          <Icon icon={Minus} size="sm" />
                        </Button>
                      </>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => handlers.onEdit(goal)} title={t('common.edit')} aria-label={t('common.edit')}>
                      <Icon icon={Pencil} size="sm" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => handlers.onDelete(goal)} title={t('common.delete')} aria-label={t('common.delete')}>
                      <Icon icon={Trash2} size="sm" />
                    </Button>
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
