import { ArrowDown, ArrowUp, CheckSquare, ChevronDown } from 'lucide-react';
import { type ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useMediaQuery } from '../../hooks/useMediaQuery';
import { cx, formatCompactAmount, formatDate, todayKey } from '../../lib/format';
import { compareItems, type SortDir, type SortKey } from '../../lib/planning/filters';
import { checklistProgress, dueTag, statusesOf } from '../../lib/planning/model';
import { useMoneyFormatter, useSettings } from '../../state/SettingsContext';
import type { PlanItem, PlanningData, PlanProject, PlanStatus } from '../../types/planning';
import { Icon } from '../Icon';
import { Select } from '../ui';

const PHONE = '(max-width: 639px)';

interface Column {
  key: string;
  sort?: SortKey;
  label: string;
}

/**
 * The table view: every card of the project that passes the filters, sorted
 * by a header (status order, then rank, by default), optionally grouped by
 * status. Phones get a list of cards instead of columns.
 */
export function PlanningTable({
  data,
  project,
  items,
  total,
  onOpen,
}: {
  data: PlanningData;
  project: PlanProject;
  items: PlanItem[];
  total: number;
  onOpen: (id: string) => void;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const phone = useMediaQuery(PHONE);
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: 'default', dir: 'asc' });
  const [grouped, setGrouped] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const statuses = statusesOf(data, project.id);
  const statusOrder = useMemo(() => new Map(statuses.map((s, i) => [s.id, i])), [statuses]);

  const sorted = useMemo(
    () => items.slice().sort(compareItems(sort.key, sort.dir, { statusOrder, locale: settings.locale })),
    [items, sort, statusOrder, settings.locale],
  );

  const columns: Column[] = [
    { key: 'title', sort: 'title', label: t('planning.fieldTitle') },
    { key: 'status', sort: 'status', label: t('planning.fieldStatus') },
    { key: 'priority', sort: 'priority', label: t('planning.fieldPriority') },
    { key: 'labels', label: t('planning.fieldLabels') },
    { key: 'milestone', label: t('planning.fieldMilestone') },
    { key: 'start', sort: 'start', label: t('planning.colStart') },
    { key: 'due', sort: 'due', label: t('planning.colDue') },
    { key: 'checklist', label: t('planning.colChecklist') },
    { key: 'budget', sort: 'spent', label: t('planning.colBudget') },
  ];

  const pick = (key: SortKey) =>
    setSort((s) => (s.key === key ? (s.dir === 'asc' ? { key, dir: 'desc' } : { key: 'default', dir: 'asc' }) : { key, dir: 'asc' }));

  const groups: { status: PlanStatus | null; rows: PlanItem[] }[] = grouped
    ? statuses.map((status) => ({ status, rows: sorted.filter((i) => i.statusId === status.id) }))
    : [{ status: null, rows: sorted }];

  const toggleGroup = (id: string) =>
    setCollapsed((c) => {
      const next = new Set(c);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const sortOptions: { value: string; label: string }[] = [
    { value: 'default:asc', label: t('planning.sortDefault') },
    { value: 'due:asc', label: t('planning.sortDueSoonest') },
    { value: 'due:desc', label: t('planning.sortDueLatest') },
    { value: 'priority:asc', label: t('planning.sortPriority') },
    { value: 'title:asc', label: t('planning.sortTitle') },
    { value: 'start:asc', label: t('planning.sortStart') },
    { value: 'spent:desc', label: t('planning.sortSpent') },
  ];

  const controls = (
    <div className="plan-table-controls">
      <span className="plan-quiet">{t('planning.matchCount', { matched: items.length, total })}</span>
      <span className="plan-grow" />
      {phone && (
        <label className="plan-sort">
          <span className="sr-only">{t('planning.sortBy')}</span>
          <Select
            value={`${sort.key}:${sort.dir}`}
            aria-label={t('planning.sortBy')}
            onChange={(e) => {
              const [key, dir] = e.target.value.split(':') as [SortKey, SortDir];
              setSort({ key, dir });
            }}
          >
            {sortOptions.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </label>
      )}
      <label className="plan-switch plan-switch--sm">
        <input type="checkbox" checked={grouped} onChange={(e) => setGrouped(e.target.checked)} />
        <span>{t('planning.groupByStatus')}</span>
      </label>
    </div>
  );

  if (!items.length) {
    return (
      <div className="plan-table-wrap">
        {controls}
        <p className="plan-quiet plan-table-empty">{total ? t('planning.noMatches') : t('planning.noCards')}</p>
      </div>
    );
  }

  const groupHead = (status: PlanStatus, count: number, body: ReactNode) => (
    <section key={status.id} className="plan-group">
      <h3 className="plan-group-head">
        <button type="button" aria-expanded={!collapsed.has(status.id)} onClick={() => toggleGroup(status.id)}>
          <Icon icon={ChevronDown} size="sm" className={cx('plan-section-caret', collapsed.has(status.id) && 'is-closed')} />
          <span className="plan-dot" style={status.color ? { background: status.color } : undefined} aria-hidden="true" />
          <span className="plan-grow">{status.name}</span>
          <span className="plan-col-count">{count}</span>
        </button>
      </h3>
      {!collapsed.has(status.id) && body}
    </section>
  );

  if (phone) {
    const list = (rows: PlanItem[]) =>
      rows.length ? (
        <ul className="plan-rows">
          {rows.map((item) => (
            <li key={item.id}>
              <RowCard item={item} data={data} onOpen={() => onOpen(item.id)} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="plan-quiet plan-group-empty">{t('planning.columnEmpty')}</p>
      );
    return (
      <div className="plan-table-wrap">
        {controls}
        {groups.map((g) => (g.status ? groupHead(g.status, g.rows.length, list(g.rows)) : <div key="all">{list(g.rows)}</div>))}
      </div>
    );
  }

  const table = (rows: PlanItem[], caption?: string) => (
    <div className="plan-table-scroll" tabIndex={0} role="region" aria-label={caption ?? t('planning.tableLabel', { name: project.name })}>
      <table className="plan-table">
        <thead>
          <tr>
            {columns.map((c) => {
              const active = c.sort && sort.key === c.sort;
              return (
                <th
                  key={c.key}
                  scope="col"
                  className={`plan-th-${c.key}`}
                  aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : undefined}
                >
                  {c.sort ? (
                    <button type="button" className="plan-th-btn" onClick={() => pick(c.sort as SortKey)}>
                      {c.label}
                      {active && <Icon icon={sort.dir === 'asc' ? ArrowUp : ArrowDown} size="sm" />}
                    </button>
                  ) : (
                    c.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => (
            <TableRow key={item.id} item={item} data={data} onOpen={() => onOpen(item.id)} />
          ))}
        </tbody>
      </table>
    </div>
  );

  return (
    <div className="plan-table-wrap">
      {controls}
      {groups.map((g) =>
        g.status ? groupHead(g.status, g.rows.length, g.rows.length ? table(g.rows, g.status.name) : <p className="plan-quiet plan-group-empty">{t('planning.columnEmpty')}</p>) : <div key="all">{table(g.rows)}</div>,
      )}
    </div>
  );
}

function useCells(item: PlanItem, data: PlanningData) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const status = data.statuses.find((s) => s.id === item.statusId);
  const milestone = data.milestones.find((m) => m.id === item.milestoneId);
  const tag = dueTag(item.dueDate, todayKey(), status?.kind === 'done');
  const checklist = checklistProgress(item);
  const over = item.budget !== null && item.spent > item.budget;
  const amount = (v: number) => formatCompactAmount(money.convert(v), settings.locale);
  const budget =
    item.budget !== null
      ? t('planning.spentOfBudget', { spent: amount(item.spent), budget: amount(item.budget) })
      : item.linkedTxIds.length
        ? amount(item.spent)
        : '';
  return {
    status,
    milestone,
    tag,
    checklist,
    over,
    budget,
    date: (d: string) => (d ? formatDate(d, settings.locale) : ''),
    prio: item.priority !== 'none' ? t(`planning.priority_${item.priority}`) : '',
  };
}

function TableRow({ item, data, onOpen }: { item: PlanItem; data: PlanningData; onOpen: () => void }) {
  const c = useCells(item, data);
  return (
    <tr className="plan-tr" onClick={onOpen}>
      <th scope="row" className="plan-td-title">
        <button
          type="button"
          className="plan-row-open"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          {item.title}
        </button>
      </th>
      <td>
        {c.status && (
          <span className="plan-status-pill">
            <span className="plan-dot" style={c.status.color ? { background: c.status.color } : undefined} aria-hidden="true" />
            {c.status.name}
          </span>
        )}
      </td>
      <td>
        {c.prio && (
          <span className="plan-prio-cell">
            <span className={`plan-prio plan-prio--${item.priority}`} aria-hidden="true" />
            {c.prio}
          </span>
        )}
      </td>
      <td>
        {item.labels.length > 0 && (
          <span className="plan-labels">
            {item.labels.map((l) => (
              <span key={l} className="plan-label">
                {l}
              </span>
            ))}
          </span>
        )}
      </td>
      <td>{c.milestone?.title ?? ''}</td>
      <td className="plan-td-num">{c.date(item.startDate)}</td>
      <td className="plan-td-num">{item.dueDate && <span className={cx('plan-tag', c.tag && `plan-tag--${c.tag}`)}>{c.date(item.dueDate)}</span>}</td>
      <td className="plan-td-num">{c.checklist ? `${c.checklist.done}/${c.checklist.total}` : ''}</td>
      <td className={cx('plan-td-num', c.over && 'plan-over')}>{c.budget}</td>
    </tr>
  );
}

function RowCard({ item, data, onOpen }: { item: PlanItem; data: PlanningData; onOpen: () => void }) {
  const c = useCells(item, data);
  return (
    <button type="button" className="plan-row-card" onClick={onOpen}>
      <span className="plan-card-top">
        {item.priority !== 'none' && (
          <span className={`plan-prio plan-prio--${item.priority}`} title={c.prio}>
            <span className="sr-only">{c.prio}</span>
          </span>
        )}
        <span className="plan-card-title">{item.title}</span>
      </span>
      <span className="plan-card-meta">
        {c.status && (
          <span className="plan-status-pill">
            <span className="plan-dot" style={c.status.color ? { background: c.status.color } : undefined} aria-hidden="true" />
            {c.status.name}
          </span>
        )}
        {item.dueDate && <span className={cx('plan-tag', c.tag && `plan-tag--${c.tag}`)}>{c.date(item.dueDate)}</span>}
        {c.checklist && (
          <span className="plan-meta-item">
            <Icon icon={CheckSquare} size="sm" />
            {c.checklist.done}/{c.checklist.total}
          </span>
        )}
        {c.budget && <span className={cx('plan-meta-item', c.over && 'plan-over')}>{c.budget}</span>}
        {c.milestone && <span className="plan-meta-item">{c.milestone.title}</span>}
      </span>
      {item.labels.length > 0 && (
        <span className="plan-labels">
          {item.labels.slice(0, 4).map((l) => (
            <span key={l} className="plan-label">
              {l}
            </span>
          ))}
          {item.labels.length > 4 && <span className="plan-label plan-label--more">+{item.labels.length - 4}</span>}
        </span>
      )}
    </button>
  );
}
