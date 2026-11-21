import type { PlanChecklistEntry } from '../../types/planning';

/**
 * A card's editable fields and their limits, the same as the server's
 * (docs/planning-api.md, Limits). Pure, so Node tests cover them.
 */

export const TITLE_MAX = 200;
export const DESCRIPTION_MAX = 40_000;
export const DESCRIPTION_WARN = 36_000;
export const LABELS_MAX = 20;
export const LABEL_LEN = 30;
export const CHECKLIST_MAX = 100;
export const CHECK_LEN = 300;
export const LINKS_MAX = 50;
export const BUDGET_MAX = 1_000_000_000_000;

export type LabelError = 'empty' | 'tooLong' | 'tooMany' | 'duplicate';

/** A label as stored: trimmed, commas (the server's separator) taken out, spaces collapsed. */
export function normalizeLabel(raw: string): string {
  return raw.replace(/,/g, ' ').replace(/\s+/g, ' ').trim();
}

function same(a: string, b: string): boolean {
  return a.toLocaleLowerCase() === b.toLocaleLowerCase();
}

export function addLabel(labels: string[], raw: string): { labels: string[]; error?: LabelError } {
  const label = normalizeLabel(raw);
  if (!label) return { labels, error: 'empty' };
  if (label.length > LABEL_LEN) return { labels, error: 'tooLong' };
  if (labels.some((l) => same(l, label))) return { labels, error: 'duplicate' };
  if (labels.length >= LABELS_MAX) return { labels, error: 'tooMany' };
  return { labels: [...labels, label] };
}

export function removeLabel(labels: string[], label: string): string[] {
  return labels.filter((l) => !same(l, label));
}

/** Labels to offer while typing: from this project, not already on the card, matching what is typed. */
export function labelSuggestions(known: string[], own: string[], typed: string, limit = 8): string[] {
  const q = normalizeLabel(typed).toLocaleLowerCase();
  return known
    .filter((l) => !own.some((o) => same(o, l)) && (!q || l.toLocaleLowerCase().includes(q)))
    .slice(0, limit);
}

/* ---- Checklist ---- */

let idCounter = 0;
/** An id the server accepts (1–40 of A-Z a-z 0-9 _ -). */
export function newChecklistId(): string {
  idCounter = (idCounter + 1) % 1_000_000;
  return `c${Date.now().toString(36)}${idCounter.toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

export function checklistAdd(list: PlanChecklistEntry[], text: string, id = newChecklistId()): PlanChecklistEntry[] | null {
  const clean = text.replace(/[\r\n]+/g, ' ').trim().slice(0, CHECK_LEN);
  if (!clean || list.length >= CHECKLIST_MAX) return null;
  return [...list, { id, text: clean, done: false }];
}

export function checklistEdit(list: PlanChecklistEntry[], id: string, text: string): PlanChecklistEntry[] {
  const clean = text.replace(/[\r\n]+/g, ' ').slice(0, CHECK_LEN);
  return list.map((c) => (c.id === id ? { ...c, text: clean } : c));
}

export function checklistToggle(list: PlanChecklistEntry[], id: string): PlanChecklistEntry[] {
  return list.map((c) => (c.id === id ? { ...c, done: !c.done } : c));
}

export function checklistRemove(list: PlanChecklistEntry[], id: string): PlanChecklistEntry[] {
  return list.filter((c) => c.id !== id);
}

/** The entry `id` moved by `delta` places (clamped); the same list when it can't move. */
export function checklistMove(list: PlanChecklistEntry[], id: string, delta: number): PlanChecklistEntry[] {
  const from = list.findIndex((c) => c.id === id);
  if (from < 0) return list;
  const to = Math.max(0, Math.min(list.length - 1, from + delta));
  if (to === from) return list;
  const next = list.slice();
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}

/** The entry `id` put at `index` (a drop). */
export function checklistMoveTo(list: PlanChecklistEntry[], id: string, index: number): PlanChecklistEntry[] {
  const from = list.findIndex((c) => c.id === id);
  if (from < 0) return list;
  return checklistMove(list, id, Math.max(0, Math.min(list.length - 1, index)) - from);
}

/* ---- Budget ---- */

/** The DecimalInput's text as a budget: '' is "no budget" (null), 0 is a budget of 0. */
export function budgetFromInput(raw: string): { value: number | null; error?: 'invalid' | 'negative' | 'tooBig' } {
  const text = raw.trim();
  if (!text) return { value: null };
  const value = Number(text);
  if (!Number.isFinite(value)) return { value: null, error: 'invalid' };
  if (value < 0) return { value: null, error: 'negative' };
  if (value > BUDGET_MAX) return { value: null, error: 'tooBig' };
  return { value: Math.round(value * 100) / 100 };
}

/** Budget − spent, or null without a budget. */
export function budgetLeft(budget: number | null, spent: number): { remaining: number; over: boolean; percent: number } | null {
  if (budget === null) return null;
  const remaining = Math.round((budget - spent) * 100) / 100;
  const percent = budget > 0 ? Math.round((spent / budget) * 100) : spent > 0 ? 100 : 0;
  return { remaining, over: remaining < 0, percent };
}

/** Due must not be before start (both optional). */
export function datesInOrder(startDate: string, dueDate: string): boolean {
  return !startDate || !dueDate || dueDate >= startDate;
}
