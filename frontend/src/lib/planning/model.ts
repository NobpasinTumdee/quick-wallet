/**
 * Planning's pure rules: progress, due tags, column order, and the
 * optimistic edits the store replays on top of the server's snapshot.
 *
 * Everything here takes a PlanningData and returns a new one (or a value);
 * nothing mutates its input, which is what lets the store rebuild the screen
 * as "server snapshot + every pending write" after each change.
 */

import type { PlanItem, PlanKind, PlanningData, PlanProject, PlanStatus, PlanTable } from '../../types/planning';

export const RANK_STEP = 1024;
/** How many days ahead a due date counts as "soon" (inclusive). */
export const DUE_SOON_DAYS = 3;
/** Temporary ids for rows created on this device and not yet saved. */
export const TEMP_PREFIX = 'tmp-';

export const EMPTY_PLANNING: PlanningData = { projects: [], statuses: [], milestones: [], items: [] };

export function isTempId(id: string): boolean {
  return id.startsWith(TEMP_PREFIX);
}

/* ---- Reading ---- */

export function statusesOf(data: PlanningData, projectId: string): PlanStatus[] {
  return data.statuses
    .filter((s) => s.projectId === projectId)
    .sort((a, b) => a.order - b.order || a.createdAt.localeCompare(b.createdAt));
}

function byRank(a: PlanItem, b: PlanItem): number {
  return a.rank - b.rank || a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id);
}

/** A column's cards on the board (archived cards are not on it), top first. */
export function columnItems(data: PlanningData, statusId: string): PlanItem[] {
  return data.items.filter((i) => i.statusId === statusId && !i.archivedAt).sort(byRank);
}

export function boardItems(data: PlanningData, projectId: string): PlanItem[] {
  return data.items.filter((i) => i.projectId === projectId && !i.archivedAt);
}

export interface Progress {
  done: number;
  total: number;
  /** null when the project has no cards: "no cards yet", not 0%. */
  percent: number | null;
}

/** Cards in a `done` status ÷ every card on the board. */
export function projectProgress(data: PlanningData, projectId: string): Progress {
  const kinds = new Map(data.statuses.map((s) => [s.id, s.kind] as const));
  const items = boardItems(data, projectId);
  const done = items.filter((i) => kinds.get(i.statusId) === 'done').length;
  return { done, total: items.length, percent: items.length ? Math.round((done / items.length) * 100) : null };
}

/** Whole days from `today` to `date` (both YYYY-MM-DD); negative = past. */
export function daysUntil(date: string, today: string): number {
  const at = (key: string) => Date.UTC(+key.slice(0, 4), +key.slice(5, 7) - 1, +key.slice(8, 10));
  return Math.round((at(date) - at(today)) / 86_400_000);
}

export type DueTag = 'overdue' | 'soon' | null;

/** Overdue (red), due within DUE_SOON_DAYS (amber), or nothing. Done work never warns. */
export function dueTag(dueDate: string, today: string, done = false): DueTag {
  if (!dueDate || done) return null;
  const days = daysUntil(dueDate, today);
  if (days < 0) return 'overdue';
  return days <= DUE_SOON_DAYS ? 'soon' : null;
}

/** Board cards past their due date that are not done. */
export function overdueCount(data: PlanningData, projectId: string, today: string): number {
  const kinds = new Map(data.statuses.map((s) => [s.id, s.kind] as const));
  return boardItems(data, projectId).filter((i) => dueTag(i.dueDate, today, kinds.get(i.statusId) === 'done') === 'overdue').length;
}

export function checklistProgress(item: PlanItem): { done: number; total: number } | null {
  if (!item.checklist.length) return null;
  return { done: item.checklist.filter((c) => c.done).length, total: item.checklist.length };
}

/** Projects for the list: active or archived, in the server's order. */
export function projectsIn(data: PlanningData, state: PlanProject['state']): PlanProject[] {
  return data.projects
    .filter((p) => (p.state || 'active') === state)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.createdAt.localeCompare(b.createdAt));
}

/**
 * The neighbours a card dropped at `index` of a column will have. `column`
 * is the column without the moved card. These are what planItems.move takes
 * (afterId = the card above, beforeId = the card below), never a rank.
 */
export function neighbours(column: { id: string }[], index: number): { afterId?: string; beforeId?: string } {
  const at = Math.max(0, Math.min(index, column.length));
  const out: { afterId?: string; beforeId?: string } = {};
  if (at > 0) out.afterId = column[at - 1].id;
  if (at < column.length) out.beforeId = column[at].id;
  return out;
}

/** The rank a card gets locally when dropped at `index` (the server decides the real one). */
export function localRank(column: { rank: number }[], index: number): number {
  const at = Math.max(0, Math.min(index, column.length));
  const lo = at > 0 ? column[at - 1].rank : null;
  const hi = at < column.length ? column[at].rank : null;
  if (lo === null && hi === null) return RANK_STEP;
  if (lo === null) return (hi as number) - RANK_STEP;
  if (hi === null) return lo + RANK_STEP;
  return (lo + hi) / 2;
}

/* ---- Writing (optimistic) ---- */

type Rows = Partial<{ [K in PlanTable]: PlanningData[K] }>;

/** Puts rows in by id (replacing) or appends them. */
export function upsertRows(data: PlanningData, rows: Rows): PlanningData {
  const next = { ...data };
  (Object.keys(rows) as PlanTable[]).forEach((table) => {
    const incoming = rows[table] as { id: string }[] | undefined;
    if (!incoming?.length) return;
    const byId = new Map(incoming.map((r) => [r.id, r]));
    const current = data[table] as { id: string }[];
    const merged = current.map((r) => byId.get(r.id) ?? r);
    const seen = new Set(current.map((r) => r.id));
    incoming.forEach((r) => {
      if (!seen.has(r.id)) merged.push(r);
    });
    (next as Record<PlanTable, unknown>)[table] = merged;
  });
  return next;
}

/** Changes some fields of one row, if it is there. */
export function patchRow<K extends PlanTable>(
  data: PlanningData,
  table: K,
  id: string,
  patch: Partial<PlanningData[K][number]>,
): PlanningData {
  const rows = data[table] as { id: string }[];
  if (!rows.some((r) => r.id === id)) return data;
  return { ...data, [table]: rows.map((r) => (r.id === id ? { ...r, ...patch } : r)) };
}

export function removeRows(data: PlanningData, table: PlanTable, ids: string[]): PlanningData {
  if (!ids.length) return data;
  const drop = new Set(ids);
  return { ...data, [table]: (data[table] as { id: string }[]).filter((r) => !drop.has(r.id)) };
}

/** `renumbered` from planItems.move: rank only, updatedAt untouched. */
export function applyRenumbered(data: PlanningData, renumbered: { id: string; rank: number }[]): PlanningData {
  if (!renumbered.length) return data;
  const ranks = new Map(renumbered.map((r) => [r.id, r.rank]));
  return { ...data, items: data.items.map((i) => (ranks.has(i.id) ? { ...i, rank: ranks.get(i.id) as number } : i)) };
}

function completedFor(item: PlanItem, kind: PlanKind | undefined, now: string): string {
  return kind === 'done' ? item.completedAt || now : '';
}

/** A card dropped in `statusId` at `index` (counted without the card itself). */
export function moveItemLocal(data: PlanningData, itemId: string, statusId: string, index: number, now: string): PlanningData {
  const item = data.items.find((i) => i.id === itemId);
  const status = data.statuses.find((s) => s.id === statusId);
  if (!item || !status) return data;
  const column = columnItems(data, statusId).filter((i) => i.id !== itemId);
  return patchRow(data, 'items', itemId, {
    statusId,
    rank: localRank(column, index),
    completedAt: completedFor(item, status.kind, now),
  });
}

/** Statuses in the given order: order = 0, 1, 2… */
export function reorderStatusesLocal(data: PlanningData, projectId: string, ids: string[]): PlanningData {
  const position = new Map(ids.map((id, i) => [id, i]));
  return {
    ...data,
    statuses: data.statuses.map((s) =>
      s.projectId === projectId && position.has(s.id) ? { ...s, order: position.get(s.id) as number } : s,
    ),
  };
}

/** A status's Kind changed: its cards' completedAt follows. */
export function setStatusKindLocal(data: PlanningData, statusId: string, kind: PlanKind, now: string): PlanningData {
  const next = patchRow(data, 'statuses', statusId, { kind });
  return {
    ...next,
    items: next.items.map((i) => (i.statusId === statusId ? { ...i, completedAt: completedFor(i, kind, now) } : i)),
  };
}

/** Deletes a status, moving its cards (archived too) to the end of `moveTo`, in order. */
export function removeStatusLocal(data: PlanningData, statusId: string, moveTo: string | null, now: string): PlanningData {
  const target = moveTo ? data.statuses.find((s) => s.id === moveTo) : undefined;
  let next = data;
  if (target) {
    const end = data.items.filter((i) => i.statusId === target.id).reduce((m, i) => Math.max(m, i.rank), 0);
    const moving = data.items.filter((i) => i.statusId === statusId).sort(byRank);
    const ranks = new Map(moving.map((i, n) => [i.id, end + RANK_STEP * (n + 1)]));
    next = {
      ...data,
      items: data.items.map((i) =>
        ranks.has(i.id) ? { ...i, statusId: target.id, rank: ranks.get(i.id) as number, completedAt: completedFor(i, target.kind, now) } : i,
      ),
    };
  }
  return removeRows(next, 'statuses', [statusId]);
}

/** Deletes a milestone; its cards (archived too) stay, with no milestone. */
export function removeMilestoneLocal(data: PlanningData, milestoneId: string, now: string): PlanningData {
  const next = removeRows(data, 'milestones', [milestoneId]);
  return {
    ...next,
    items: next.items.map((i) => (i.milestoneId === milestoneId ? { ...i, milestoneId: '', updatedAt: now } : i)),
  };
}

/** A project and everything in it. */
export function removeProjectLocal(data: PlanningData, projectId: string): PlanningData {
  return {
    projects: data.projects.filter((p) => p.id !== projectId),
    statuses: data.statuses.filter((s) => s.projectId !== projectId),
    milestones: data.milestones.filter((m) => m.projectId !== projectId),
    items: data.items.filter((i) => i.projectId !== projectId),
  };
}

/** The end of a column, for a card added there. */
export function columnEnd(data: PlanningData, statusId: string): number {
  return data.items.filter((i) => i.statusId === statusId).reduce((m, i) => Math.max(m, i.rank), 0) + RANK_STEP;
}

/* ---- Moving with the keyboard ---- */

export interface BoardSpot {
  statusId: string;
  index: number;
}

/**
 * One arrow press on a picked-up card. `columns` are the board's status ids
 * in order; `sizes` how many cards each column has without the moved card.
 */
export function stepSpot(
  spot: BoardSpot,
  key: 'ArrowLeft' | 'ArrowRight' | 'ArrowUp' | 'ArrowDown',
  columns: string[],
  sizes: Record<string, number>,
): BoardSpot {
  const col = columns.indexOf(spot.statusId);
  if (key === 'ArrowUp') return { ...spot, index: Math.max(0, spot.index - 1) };
  if (key === 'ArrowDown') return { ...spot, index: Math.min(sizes[spot.statusId] ?? 0, spot.index + 1) };
  const nextCol = Math.max(0, Math.min(columns.length - 1, col + (key === 'ArrowLeft' ? -1 : 1)));
  const statusId = columns[nextCol];
  return { statusId, index: Math.min(spot.index, sizes[statusId] ?? 0) };
}

/** Moves one id in a list by `delta` places (columns, with the keyboard or ⋯ menu). */
export function shiftId(ids: string[], id: string, delta: number): string[] {
  const from = ids.indexOf(id);
  if (from === -1) return ids;
  const to = Math.max(0, Math.min(ids.length - 1, from + delta));
  const next = ids.filter((x) => x !== id);
  next.splice(to, 0, id);
  return next;
}

/* ---- Temporary ids ---- */

/** Swaps a temporary id for the real one everywhere it can appear. */
export function replaceId(data: PlanningData, tempId: string, realId: string): PlanningData {
  const swap = (v: string) => (v === tempId ? realId : v);
  return {
    projects: data.projects.map((p) => (p.id === tempId ? { ...p, id: realId } : p)),
    statuses: data.statuses.map((s) => (s.id === tempId || s.projectId === tempId ? { ...s, id: swap(s.id), projectId: swap(s.projectId) } : s)),
    milestones: data.milestones.map((m) => (m.projectId === tempId ? { ...m, projectId: realId } : m)),
    items: data.items.map((i) =>
      i.id === tempId || i.projectId === tempId || i.statusId === tempId
        ? { ...i, id: swap(i.id), projectId: swap(i.projectId), statusId: swap(i.statusId) }
        : i,
    ),
  };
}
