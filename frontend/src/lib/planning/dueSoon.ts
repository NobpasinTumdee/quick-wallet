/**
 * Home's "Due soon" list: cards not done and not archived, in active
 * projects, overdue or due within the next `days` days of `today` (the
 * user's local date, todayKey()). Pure, so the tests load it directly.
 */

import type { PlanItem, PlanningData, PlanProject } from '../../types/planning';
import { daysUntil } from './model';

export const DUE_SOON_WINDOW = 7;

export interface DueSoonRow {
  item: PlanItem;
  project: PlanProject;
  /** Whole days until due; negative = overdue. */
  days: number;
}

export function dueSoonItems(data: PlanningData, today: string, days = DUE_SOON_WINDOW): DueSoonRow[] {
  const kinds = new Map(data.statuses.map((s) => [s.id, s.kind] as const));
  const projects = new Map(data.projects.filter((p) => (p.state || 'active') === 'active').map((p) => [p.id, p] as const));
  const rows: DueSoonRow[] = [];
  for (const item of data.items) {
    if (!item.dueDate || item.archivedAt) continue;
    const project = projects.get(item.projectId);
    if (!project || kinds.get(item.statusId) === 'done') continue;
    const left = daysUntil(item.dueDate, today);
    if (left > days) continue;
    rows.push({ item, project, days: left });
  }
  /* Overdue first (earliest first), then by due date; ties by project, then board order. */
  return rows.sort(
    (a, b) =>
      a.item.dueDate.localeCompare(b.item.dueDate) ||
      a.project.sortOrder - b.project.sortOrder ||
      a.project.createdAt.localeCompare(b.project.createdAt) ||
      a.item.rank - b.item.rank ||
      a.item.id.localeCompare(b.item.id),
  );
}
