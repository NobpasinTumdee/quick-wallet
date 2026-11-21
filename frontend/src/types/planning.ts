/**
 * Planning rows as the backend returns them. The contract is
 * docs/planning-api.md; these types mirror its "Row shapes" section.
 */

export type PlanKind = 'todo' | 'doing' | 'done';
export type PlanPriority = 'none' | 'low' | 'medium' | 'high' | 'urgent';
export type PlanProjectState = 'active' | 'archived';

export interface PlanChecklistEntry {
  id: string;
  text: string;
  done: boolean;
}

export interface PlanProject {
  id: string;
  name: string;
  description: string;
  color: string;
  icon: string;
  state: PlanProjectState;
  startDate: string;
  dueDate: string;
  linkedGoalId: string;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
  linkedGoalMissing: boolean;
}

export interface PlanStatus {
  id: string;
  projectId: string;
  name: string;
  color: string;
  order: number;
  kind: PlanKind;
  createdAt: string;
  updatedAt: string;
}

export interface PlanItem {
  id: string;
  projectId: string;
  statusId: string;
  milestoneId: string;
  title: string;
  description: string;
  priority: PlanPriority;
  labels: string[];
  startDate: string;
  dueDate: string;
  completedAt: string;
  rank: number;
  checklist: PlanChecklistEntry[];
  budget: number | null;
  linkedTxIds: string[];
  linkedNoteId: string;
  archivedAt: string;
  createdAt: string;
  updatedAt: string;
  spent: number;
  missingTxIds: string[];
  linkedNoteMissing: boolean;
}

export interface PlanMilestone {
  id: string;
  projectId: string;
  title: string;
  description: string;
  dueDate: string;
  state: 'open' | 'closed';
  order: number;
  createdAt: string;
  updatedAt: string;
}

/** What `planProjects.list` answers, and the shape the cache holds. */
export interface PlanningData {
  projects: PlanProject[];
  statuses: PlanStatus[];
  milestones: PlanMilestone[];
  items: PlanItem[];
}

export type PlanTable = keyof PlanningData;
