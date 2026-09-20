/**
 * Category list arithmetic.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS MIRRORS THE SERVER RULE FOR RULE
 * ---------------------------------------------------------------------------
 * `normalizeCategories_` in Code.gs trims, drops blanks, de-duplicates
 * case-insensitively keeping the first spelling, caps the list, and falls back
 * to the defaults if nothing survives. Whatever the client sends goes through
 * it.
 *
 * So a UI that lets someone type "dining" next to an existing "Dining" is not
 * merely untidy: they press save, the server silently drops one of them, and
 * the chip they just added disappears on the next load with no explanation.
 * The same rules are therefore applied here *before* the write, where they can
 * be explained in place. The two must stay in step — if the server rule
 * changes, this file changes with it.
 *
 * ---------------------------------------------------------------------------
 * READING WHATEVER IS STORED
 * ---------------------------------------------------------------------------
 * The typed settings say `string[]`, but the sheet cell is a `list` column
 * split on commas *or* pipes, and older data (or a hand-edited cell) may
 * arrive as one string. `parseCategories` accepts either and is the only way
 * this feature reads the value, so no shape reaches the UI unnormalised.
 */

/** The server's own ceiling. */
export const MAX_CATEGORIES = 100;

/** A chip has to stay a chip. Long enough for "Entertainment & nights out". */
export const MAX_CATEGORY_LENGTH = 40;

/**
 * What the list falls back to rather than being emptied.
 *
 * Deleting the last category would leave every transaction form with an empty
 * dropdown, so the UI refuses; this exists for the paths that cannot refuse —
 * a stored value that parses to nothing.
 */
export const FALLBACK_CATEGORY = 'General';

/** Splits on both separators the sheet's `list` coercion accepts. */
const SEPARATORS = /[|,]/;

/**
 * Anything the store might hold → a clean, ordered, de-duplicated list.
 *
 * Order is preserved and the *first* spelling of a duplicate wins, matching
 * the server: someone who has used "Dining" for a year should not find it
 * renamed to "dining" because a later duplicate sorted differently.
 */
export function parseCategories(value: unknown): string[] {
  const raw: unknown[] = Array.isArray(value)
    ? value
    : typeof value === 'string'
      ? value.split(SEPARATORS)
      : [];

  const seen = new Set<string>();
  const out: string[] = [];

  for (const entry of raw) {
    const name = String(entry ?? '').trim();
    if (!name) continue;
    const key = name.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(name);
  }

  return out;
}

/**
 * Back to the comma-separated form the sheet cell holds.
 *
 * The API takes the array as well — `normalizeCategories_` accepts either — so
 * this is not on the write path. It is how two lists are compared for
 * equality, which is the same question ("is this the same set, in the same
 * order, spelled the same way") asked in one line instead of a loop.
 */
export function serializeCategories(categories: string[]): string {
  return categories.join(',');
}

export function sameCategories(a: string[], b: string[]): boolean {
  return serializeCategories(a) === serializeCategories(b);
}

export type CategoryProblem = 'empty' | 'duplicate' | 'tooLong' | 'tooMany';

/**
 * Why this name cannot be used, or null.
 *
 * `ignoreIndex` is the row being renamed: a category must not collide with
 * every *other* one, but re-saving "Dining" as "Dining" — or fixing its case
 * to "dining" — is not a duplicate of itself.
 */
export function validateCategory(
  name: string,
  categories: string[],
  ignoreIndex: number | null = null,
): CategoryProblem | null {
  const trimmed = name.trim();
  if (!trimmed) return 'empty';
  if (trimmed.length > MAX_CATEGORY_LENGTH) return 'tooLong';

  const key = trimmed.toLowerCase();
  const clash = categories.some((entry, index) => index !== ignoreIndex && entry.trim().toLowerCase() === key);
  if (clash) return 'duplicate';

  if (ignoreIndex === null && categories.length >= MAX_CATEGORIES) return 'tooMany';
  return null;
}

/** Appends, if the name is usable. Returns the list unchanged if it is not. */
export function addCategory(categories: string[], name: string): string[] {
  if (validateCategory(name, categories)) return categories;
  return [...categories, name.trim()];
}

/** Renames in place, keeping the category's position in the list. */
export function renameCategory(categories: string[], index: number, name: string): string[] {
  if (index < 0 || index >= categories.length) return categories;
  if (validateCategory(name, categories, index)) return categories;
  const next = [...categories];
  next[index] = name.trim();
  return next;
}

/**
 * Removes one — unless it is the last.
 *
 * An empty list is not a valid state: every transaction form reads it, and the
 * server would quietly refill it with sixteen defaults the user had already
 * deleted. Refused here so the UI can say why.
 */
export function removeCategory(categories: string[], index: number): string[] {
  if (!canRemove(categories)) return categories;
  return categories.filter((_, i) => i !== index);
}

export function canRemove(categories: string[]): boolean {
  return categories.length > 1;
}

/** Never empty: what the UI shows when the stored value parses to nothing. */
export function withFallback(categories: string[]): string[] {
  return categories.length > 0 ? categories : [FALLBACK_CATEGORY];
}
