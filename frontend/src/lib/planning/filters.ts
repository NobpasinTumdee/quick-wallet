import type { PlanItem, PlanPriority, PlanningData } from '../../types/planning';
import { daysUntil } from './model';

/**
 * Board and table filters, search and sorting. Pure, so Node tests cover
 * them. Filters only hide cards: nothing here changes a rank or a status.
 */

export type DueFilter = 'overdue' | 'week' | 'next7' | 'none';

export interface PlanFilters {
  search: string;
  labels: string[];
  priorities: PlanPriority[];
  /** Milestone ids; '' stands for "No milestone". */
  milestones: string[];
  due: DueFilter[];
  hideDone: boolean;
}

export const EMPTY_FILTERS: PlanFilters = { search: '', labels: [], priorities: [], milestones: [], due: [], hideDone: false };

export const PRIORITY_ORDER: PlanPriority[] = ['urgent', 'high', 'medium', 'low', 'none'];

/** How many filters are on (the search counts as one). */
export function activeFilterCount(f: PlanFilters): number {
  return (
    (f.search.trim() ? 1 : 0) +
    f.labels.length +
    f.priorities.length +
    f.milestones.length +
    f.due.length +
    (f.hideDone ? 1 : 0)
  );
}

export function isFiltering(f: PlanFilters): boolean {
  return activeFilterCount(f) > 0;
}

function fold(text: string): string {
  return text.toLocaleLowerCase().normalize('NFKC');
}

/** Every word of the search must appear in the title, description, a label or a checklist entry. */
export function matchesSearch(item: PlanItem, search: string): boolean {
  const words = fold(search).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const hay = fold(
    [item.title, item.description, item.labels.join(' '), item.checklist.map((c) => c.text).join(' ')].join('\n'),
  );
  return words.every((word) => hay.includes(word));
}

/** Monday of the week `today` falls in, and the Sunday after (YYYY-MM-DD). */
export function weekRange(today: string): { from: string; to: string } {
  const [y, m, d] = today.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  const offset = (date.getUTCDay() + 6) % 7;
  const from = new Date(date.getTime() - offset * 86_400_000);
  const to = new Date(from.getTime() + 6 * 86_400_000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function matchesDue(item: PlanItem, due: DueFilter[], done: boolean, today: string): boolean {
  if (!due.length) return true;
  return due.some((rule) => {
    if (rule === 'none') return !item.dueDate;
    if (!item.dueDate) return false;
    const days = daysUntil(item.dueDate, today);
    if (rule === 'overdue') return !done && days < 0;
    if (rule === 'next7') return days >= 0 && days <= 7;
    const week = weekRange(today);
    return item.dueDate >= week.from && item.dueDate <= week.to;
  });
}

export interface FilterContext {
  /** Statuses whose kind is `done`. */
  doneStatusIds: Set<string>;
  today: string;
}

export function filterContext(data: PlanningData, today: string): FilterContext {
  return { doneStatusIds: new Set(data.statuses.filter((s) => s.kind === 'done').map((s) => s.id)), today };
}

/** Within a group the choices are OR; between groups, AND. */
export function matchesFilters(item: PlanItem, f: PlanFilters, ctx: FilterContext): boolean {
  const done = ctx.doneStatusIds.has(item.statusId);
  if (f.hideDone && done) return false;
  if (f.labels.length) {
    const own = new Set(item.labels.map(fold));
    if (!f.labels.some((label) => own.has(fold(label)))) return false;
  }
  if (f.priorities.length && !f.priorities.includes(item.priority)) return false;
  if (f.milestones.length && !f.milestones.includes(item.milestoneId || '')) return false;
  if (!matchesDue(item, f.due, done, ctx.today)) return false;
  return matchesSearch(item, f.search);
}

/** Labels used on this project's cards, most used first (ties by name). */
export function projectLabels(data: PlanningData, projectId: string): string[] {
  const counts = new Map<string, { label: string; n: number }>();
  for (const item of data.items) {
    if (item.projectId !== projectId) continue;
    for (const label of item.labels) {
      const key = fold(label);
      const entry = counts.get(key);
      if (entry) entry.n += 1;
      else counts.set(key, { label, n: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.n - a.n || a.label.localeCompare(b.label)).map((e) => e.label);
}

/* ---- Dropping among visible cards ---- */

/**
 * Where a card dropped at `visibleIndex` among the visible cards of a column
 * lands in the whole column (both lists without the moved card). It goes
 * right after the visible card above it, so any hidden cards between that
 * one and the next visible card stay below it, in their order. At the top of
 * the visible list it goes right before the first visible card. The store
 * then takes the whole column's neighbours at that index, which are always
 * adjacent, as the server requires.
 */
export function fullDropIndex(full: { id: string }[], visible: { id: string }[], visibleIndex: number): number {
  if (!visible.length) return full.length;
  const at = Math.max(0, Math.min(visibleIndex, visible.length));
  if (at === 0) {
    const first = full.findIndex((c) => c.id === visible[0].id);
    return first < 0 ? 0 : first;
  }
  const above = full.findIndex((c) => c.id === visible[at - 1].id);
  return above < 0 ? full.length : above + 1;
}

/* ---- Sorting (the table) ---- */

export type SortKey = 'default' | 'title' | 'status' | 'priority' | 'due' | 'start' | 'budget' | 'spent';
export type SortDir = 'asc' | 'desc';

export interface SortContext {
  /** Status id → its column position. */
  statusOrder: Map<string, number>;
  locale?: string;
}

function byDefault(a: PlanItem, b: PlanItem, ctx: SortContext): number {
  return (ctx.statusOrder.get(a.statusId) ?? 0) - (ctx.statusOrder.get(b.statusId) ?? 0) || a.rank - b.rank;
}

/**
 * A comparator for the table. Empty values (no date, no budget) always sort
 * last, whichever way; ties fall back to status order then rank, so the
 * order is stable and matches the board.
 */
export function compareItems(key: SortKey, dir: SortDir, ctx: SortContext): (a: PlanItem, b: PlanItem) => number {
  const sign = dir === 'asc' ? 1 : -1;
  const value = (item: PlanItem): string | number | null => {
    switch (key) {
      case 'title':
        return item.title;
      case 'status':
        return ctx.statusOrder.get(item.statusId) ?? 0;
      case 'priority':
        return PRIORITY_ORDER.indexOf(item.priority);
      case 'due':
        return item.dueDate || null;
      case 'start':
        return item.startDate || null;
      case 'budget':
        return item.budget;
      case 'spent':
        return item.linkedTxIds.length ? item.spent : null;
      default:
        return null;
    }
  };
  return (a, b) => {
    if (key === 'default') return byDefault(a, b, ctx);
    const va = value(a);
    const vb = value(b);
    if (va === null && vb === null) return byDefault(a, b, ctx);
    if (va === null) return 1;
    if (vb === null) return -1;
    const diff =
      typeof va === 'string' && typeof vb === 'string'
        ? va.localeCompare(vb, ctx.locale, { sensitivity: 'base', numeric: true })
        : (va as number) - (vb as number);
    return diff * sign || byDefault(a, b, ctx);
  };
}
