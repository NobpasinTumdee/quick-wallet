/**
 * Milestones and money, read from a PlanningData: progress per milestone,
 * the order of the Milestones list, the `order` a moved milestone is sent
 * with, and a project's budget totals. Pure, so the tests load it directly.
 */

import type { PlanMilestone, PlanningData } from '../../types/planning';

export interface MilestoneProgress {
  /** Cards on the board (not archived) in a `done` status. */
  done: number;
  /** Cards on the board (not archived) with this milestone. */
  total: number;
  /** null when no card has the milestone yet. */
  percent: number | null;
}

export function milestoneProgress(data: PlanningData, milestoneId: string): MilestoneProgress {
  const kinds = new Map(data.statuses.map((s) => [s.id, s.kind] as const));
  const items = data.items.filter((i) => i.milestoneId === milestoneId && !i.archivedAt);
  const done = items.filter((i) => kinds.get(i.statusId) === 'done').length;
  return { done, total: items.length, percent: items.length ? Math.round((done / items.length) * 100) : null };
}

/** Every card of an open milestone is done (and there is at least one): worth offering to close it. */
export function milestoneAllDone(data: PlanningData, milestone: PlanMilestone): boolean {
  if (milestone.state === 'closed') return false;
  const progress = milestoneProgress(data, milestone.id);
  return progress.total > 0 && progress.done === progress.total;
}

function byOrder(a: PlanMilestone, b: PlanMilestone): number {
  return a.order - b.order || (a.dueDate || '9999').localeCompare(b.dueDate || '9999') || a.createdAt.localeCompare(b.createdAt);
}

/** A project's milestones for the list: open ones by order, closed ones by order. */
export function milestonesOf(data: PlanningData, projectId: string): { open: PlanMilestone[]; closed: PlanMilestone[] } {
  const all = data.milestones.filter((m) => m.projectId === projectId).sort(byOrder);
  return { open: all.filter((m) => m.state !== 'closed'), closed: all.filter((m) => m.state === 'closed') };
}

/**
 * The `order` for a milestone moved to `to` in `list` (the section as shown,
 * the milestone still in it): halfway between its new neighbours, one past
 * the last, or one before the first. One write per move. Null when it would
 * not move.
 */
export function reorderValue(list: Pick<PlanMilestone, 'id' | 'order'>[], id: string, to: number): number | null {
  const from = list.findIndex((m) => m.id === id);
  if (from < 0) return null;
  const rest = list.filter((m) => m.id !== id);
  const at = Math.max(0, Math.min(to, rest.length));
  if (at === from) return null;
  const before = rest[at - 1];
  const after = rest[at];
  if (before && after) {
    const mid = (before.order + after.order) / 2;
    /* Equal neighbours (old data): nudge past the one above. */
    return mid === before.order ? before.order + 1e-6 : mid;
  }
  if (before) return before.order + 1;
  if (after) return after.order - 1;
  return null;
}

export interface BudgetTotals {
  /** False when no card on the board has a budget: show nothing at all. */
  has: boolean;
  budget: number;
  spent: number;
  /** budget − spent; negative when over. */
  remaining: number;
  over: boolean;
}

/**
 * A project's money: the budgets of its cards on the board (a budget of 0
 * counts), and what is spent on those same cards. Archived cards never count,
 * even after the Archived list has loaded them.
 */
export function projectBudget(data: PlanningData, projectId: string): BudgetTotals {
  let has = false;
  let budget = 0;
  let spent = 0;
  for (const item of data.items) {
    if (item.projectId !== projectId || item.archivedAt || item.budget === null || item.budget === undefined) continue;
    has = true;
    budget += Number(item.budget) || 0;
    spent += Number(item.spent) || 0;
  }
  budget = Math.round(budget * 100) / 100;
  spent = Math.round(spent * 100) / 100;
  const remaining = Math.round((budget - spent) * 100) / 100;
  return { has, budget, spent, remaining, over: remaining < 0 };
}
