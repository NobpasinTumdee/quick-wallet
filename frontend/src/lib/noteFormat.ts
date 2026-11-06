/**
 * The vocabulary of the note-only Markdown extras, shared by the editor
 * (which writes them), the reading view (which renders them) and the
 * preview stripper (which removes them). Small and dependency-free, so the
 * editor and the list can import it without loading the parser.
 *
 *   ==text==            highlight (yellow)
 *   ==[green]text==     highlight in another colour
 *   [text]{red}         text colour
 *   ++text++            underline
 *   > [!NOTE] …         callout (GitHub alert syntax)
 *   :::toggle Title     collapsible block, closed by a line of `:::`
 *   [label](#/notes?id=…)  link to another note
 *
 * Only the names below are ever turned into a class name; anything else is
 * left as the text it is.
 */

export const NOTE_COLORS = ['red', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'gray'] as const;
export type NoteColor = (typeof NOTE_COLORS)[number];

export function isNoteColor(name: string): name is NoteColor {
  return (NOTE_COLORS as readonly string[]).includes(name);
}

/** `red|orange|…`, for building patterns. */
export const NOTE_COLOR_ALT = NOTE_COLORS.join('|');

export const CALLOUT_TYPES = ['note', 'tip', 'important', 'warning', 'caution'] as const;
export type CalloutType = (typeof CALLOUT_TYPES)[number];

export function calloutTypeOf(marker: string): CalloutType | null {
  const lower = marker.toLowerCase();
  return (CALLOUT_TYPES as readonly string[]).includes(lower) ? (lower as CalloutType) : null;
}

/** `[!NOTE]` at the very start of a quote's first line, and nothing else on it. */
export const CALLOUT_MARKER = /^\[!(note|tip|important|warning|caution)\][ \t]*(?:\n|$)/i;

/**
 * The one internal link a note may hold: another note, by id. Exact, so
 * nothing else that starts with `#` (or tries to) gets through.
 */
const NOTE_LINK = /^#\/notes\?id=([A-Za-z0-9._~-]{1,80})$/;

export function noteLinkId(url: string): string | null {
  const m = NOTE_LINK.exec(url.trim());
  return m ? m[1] : null;
}

export function noteLinkUrl(id: string): string {
  return `#/notes?id=${encodeURIComponent(id)}`;
}

/** `:::toggle Title` (title optional) and the closing `:::`. */
export const TOGGLE_OPEN = /^[ ]{0,3}:::toggle(?:[ \t]+(.*?))?[ \t]*$/;
export const TOGGLE_CLOSE = /^[ ]{0,3}:::[ \t]*$/;
