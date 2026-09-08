import { Settings, ThemeName } from '../types';

/**
 * The theme cache that kills the flash.
 *
 * ---------------------------------------------------------------------------
 * THE PROBLEM
 * ---------------------------------------------------------------------------
 * The palette lives in the user's Settings row, which is behind an Apps Script
 * round trip. So the old sequence was: paint the hard-coded dark default, wait
 * one to three seconds, then repaint in whatever the user actually chose. A
 * light-theme user opened a dark app every single time.
 *
 * ---------------------------------------------------------------------------
 * THE FIX, IN THREE PLACES
 * ---------------------------------------------------------------------------
 *   1. index.html runs a tiny blocking script in <head> that reads this key
 *      and stamps `data-theme` before the browser paints anything at all. A
 *      module script cannot do this — `type="module"` is deferred, so it runs
 *      after the document has already been painted once.
 *   2. SettingsProvider seeds its initial state from the same cache, so
 *      React's first render agrees with what the boot script already put on
 *      the page instead of correcting it.
 *   3. Every settings write updates the cache, so the next load is right.
 *
 * The snippet in index.html is a deliberate, and unavoidable, duplicate of
 * `applyTheme` below: nothing importable can run before first paint. Keep the
 * two in step — the shared contract is this key and the shape it holds.
 */

export const THEME_STORAGE_KEY = 'quick-wallet.theme';

/** Only the parts of Settings that affect how the app *looks*. */
export interface CachedTheme {
  theme: ThemeName;
  accent: string;
  customVars: Record<string, string>;
}

/**
 * Reads the cache, or null when there is nothing usable.
 *
 * Every access is guarded: `localStorage` throws outright in some privacy
 * modes, and the stored value is whatever was there last — a different version
 * of the app, or something a user pasted in. A bad cache must fall back to the
 * default palette, never break the boot.
 */
export function readCachedTheme(): Partial<CachedTheme> | null {
  try {
    const raw = localStorage.getItem(THEME_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Partial<CachedTheme>;
    if (!parsed || typeof parsed !== 'object') return null;

    return {
      theme: typeof parsed.theme === 'string' ? (parsed.theme as ThemeName) : undefined,
      accent: typeof parsed.accent === 'string' ? parsed.accent : undefined,
      customVars:
        parsed.customVars && typeof parsed.customVars === 'object'
          ? (parsed.customVars as Record<string, string>)
          : undefined,
    };
  } catch {
    return null;
  }
}

export function writeCachedTheme(settings: Pick<Settings, 'theme' | 'accent' | 'customVars'>): void {
  try {
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        theme: settings.theme,
        accent: settings.accent,
        // Only meaningful for the custom palette, and storing a stale map under
        // a built-in theme would resurrect it if the user ever switched back.
        customVars: settings.theme === 'custom' ? (settings.customVars ?? {}) : {},
      }),
    );
  } catch {
    // Quota or a private window. The app still works; the next load just
    // flashes, which is exactly where it was before this file existed.
  }
}

export function clearCachedTheme(): void {
  try {
    localStorage.removeItem(THEME_STORAGE_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * Writes a palette onto `<html>`.
 *
 * `cssText = ''` clears whatever the boot snippet or a previous theme left
 * behind, so switching from a custom palette back to a built-in one does not
 * leave orphaned custom properties overriding it.
 */
export function applyTheme(settings: Pick<Settings, 'theme' | 'accent' | 'customVars'>): void {
  const root = document.documentElement;
  root.dataset.theme = settings.theme;

  root.style.cssText = '';
  // Custom vars first, then accent, so an explicit accent always wins.
  if (settings.theme === 'custom') {
    for (const [key, value] of Object.entries(settings.customVars ?? {})) {
      if (key.startsWith('--')) root.style.setProperty(key, value);
    }
  }
  if (settings.accent) root.style.setProperty('--accent', settings.accent);
}
