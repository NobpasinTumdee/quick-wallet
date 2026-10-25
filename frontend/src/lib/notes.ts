import { Route } from './router';
import { Note, NoteRef, NoteRefType } from '../types';

/**
 * Pure helpers for Notes. The limits mirror NOTE_TITLE_MAX, NOTE_BODY_MAX and
 * NOTE_REFS_MAX in Code.gs, which enforces them again — these exist so the
 * editor can stop at the limit and say so, rather than letting a save fail.
 *
 * Lengths are JavaScript string lengths (UTF-16 units), the same unit both
 * `maxLength` and the server's `.length` count in, so the three agree. An
 * emoji counts as two, which only ever errs on the safe side of the 50,000
 * characters a Sheets cell holds.
 */
export const NOTE_TITLE_MAX = 200;
export const NOTE_BODY_MAX = 40000;
export const NOTE_REFS_MAX = 20;

/** Counters appear once this close to the limit — not before, to keep the
 *  page quiet while there is nothing to warn about. */
export const NOTE_TITLE_WARN = 160;
export const NOTE_BODY_WARN = 36000;

/** In the order the picker shows its tabs, which is the sidebar's order. */
export const NOTE_REF_TYPES: readonly NoteRefType[] = [
  'transaction',
  'wallet',
  'goal',
  'subscription',
  'split',
];

/** The screen that lists each kind of record. */
export const NOTE_REF_ROUTE: Record<NoteRefType, Route> = {
  transaction: 'transactions',
  wallet: 'wallets',
  goal: 'goals',
  subscription: 'subscriptions',
  split: 'splits',
};

export function sameRef(a: NoteRef, b: NoteRef): boolean {
  return a.type === b.type && a.id === b.id;
}

/* ---- Search and sorting ---- */

/** Case- and accent-insensitive enough for Thai and English alike. */
function normalise(text: string): string {
  return text.normalize('NFC').toLocaleLowerCase();
}

/** Every word must appear somewhere in the title or body. */
export function matchesNoteSearch(note: Note, search: string): boolean {
  const words = normalise(search).split(/\s+/).filter(Boolean);
  if (words.length === 0) return true;
  const haystack = normalise(`${note.title}\n${note.body}`);
  return words.every((word) => haystack.includes(word));
}

/** Pinned first, then most recently edited. */
export function compareNotes(a: Note, b: Note): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  return String(b.updatedAt).localeCompare(String(a.updatedAt));
}

/** The first non-empty line of the body, for a one-line preview. */
export function notePreview(body: string): string {
  const line = body.split('\n').find((part) => part.trim()) ?? '';
  return line.trim().slice(0, 240);
}

/** References grouped by kind, for the small chips on a list row. */
export function countRefsByType(refs: NoteRef[]): { type: NoteRefType; count: number }[] {
  return NOTE_REF_TYPES.map((type) => ({
    type,
    count: refs.filter((ref) => ref.type === type).length,
  })).filter((entry) => entry.count > 0);
}

/* ---- Time ---- */

const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ['year', 365 * 24 * 3600],
  ['month', 30 * 24 * 3600],
  ['week', 7 * 24 * 3600],
  ['day', 24 * 3600],
  ['hour', 3600],
  ['minute', 60],
];

/**
 * "5 minutes ago" / "5 นาทีที่แล้ว" from the browser's own formatter, so both
 * languages are correct without a string table. Under a minute reads as
 * "now"; older than a week shows the date itself, which is easier to place.
 */
export function formatEditedAt(iso: string, locale: string): string {
  const time = new Date(iso).getTime();
  if (!iso || Number.isNaN(time)) return '';
  const seconds = Math.round((time - Date.now()) / 1000);
  const format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' });
  if (Math.abs(seconds) < 60) return format.format(0, 'second');
  if (Math.abs(seconds) >= 7 * 24 * 3600) {
    return new Date(time).toLocaleDateString(locale, { day: 'numeric', month: 'short', year: 'numeric' });
  }
  for (const [unit, size] of UNITS) {
    if (Math.abs(seconds) >= size) return format.format(Math.round(seconds / size), unit);
  }
  return format.format(0, 'second');
}

/* ---- Address ----
   The router only reads the part of the hash before `?`, so `#/notes?id=…`
   is still the Notes route and the id rides along — the same trick Goals uses
   for its filters. `new` is the editor for a note that has not been saved. */

export const NEW_NOTE_ID = 'new';

export function noteIdFromHash(hash: string = window.location.hash): string | null {
  const query = hash.split('?')[1] ?? '';
  const id = new URLSearchParams(query).get('id');
  return id ? id.slice(0, 80) : null;
}

export function noteHash(id: string | null): string {
  return id ? `#/notes?id=${encodeURIComponent(id)}` : '#/notes';
}
