import { ensureFontLoaded, fontOption } from './fonts';
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
  /** The catalogue id, so the picker can show the right card on the next boot. */
  fontId: string;
  /**
   * The *resolved* stack and stylesheet URL for that id.
   *
   * Denormalised on purpose. The boot script in index.html has to apply the font
   * before any module is parsed, and it cannot import `lib/fonts.ts` to turn an
   * id into a stack. Caching the two values it needs means the catalogue lives
   * in exactly one place instead of being copied into the HTML, where it would
   * drift the first time a font was added.
   */
  fontStack: string;
  fontHref: string;
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
      fontId: typeof parsed.fontId === 'string' ? parsed.fontId : undefined,
      fontStack: typeof parsed.fontStack === 'string' ? parsed.fontStack : undefined,
      fontHref: typeof parsed.fontHref === 'string' ? parsed.fontHref : undefined,
    };
  } catch {
    return null;
  }
}

type Painted = Pick<Settings, 'theme' | 'accent' | 'customVars' | 'fontFamily'>;

export function writeCachedTheme(settings: Painted): void {
  try {
    const font = fontOption(settings.fontFamily);
    localStorage.setItem(
      THEME_STORAGE_KEY,
      JSON.stringify({
        theme: settings.theme,
        accent: settings.accent,
        // Only meaningful for the custom palette, and storing a stale map under
        // a built-in theme would resurrect it if the user ever switched back.
        customVars: settings.theme === 'custom' ? (settings.customVars ?? {}) : {},
        /* The font is *not* gated on the custom palette the way customVars is:
           it is a single scalar that stands on its own, and a preset simply
           stores the system face. */
        fontId: font.id,
        fontStack: font.stack,
        fontHref: font.href,
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

/* ---------------------------------------------------------------------------
 * The preview lock
 * ---------------------------------------------------------------------------
 * While the theme creator is open, the colour pickers own <html> directly: a
 * drag writes custom properties on the element and never touches React state or
 * the network. SettingsProvider still calls `applyTheme` on every settings
 * change, and its effect runs *after* any provider nested below it, so without
 * this flag an unrelated settings refresh landing mid-drag would wipe the
 * preview back to the saved palette.
 *
 * A module-level flag rather than a prop or context value because the thing
 * being guarded is a single shared DOM node, not a React subtree, and because
 * `applyTheme` has to be able to check it without becoming a hook.
 */
let previewing = false;

/**
 * Writes a draft palette straight onto `<html>` and takes the lock.
 *
 * Called from the colour pickers' change handlers on every tick, so it does the
 * minimum possible work: `setProperty` on already-resolved values. The browser
 * recalculates style for the subtree and repaints; React does not re-render, so
 * dragging stays at frame rate no matter how large the page below is.
 */
export function applyPreview(colors: Record<string, string>, fontId: string): void {
  const root = document.documentElement;
  previewing = true;

  root.dataset.theme = 'custom';
  for (const [key, value] of Object.entries(colors)) {
    if (key.startsWith('--') && value) root.style.setProperty(key, value);
  }

  const font = fontOption(fontId);
  ensureFontLoaded(font);
  writeFont(root, font.stack);
}

/**
 * Swaps the typeface in a live preview.
 *
 * Unlike a colour this is a click rather than a drag, so it costs a React
 * render too — but it still never reaches the network. The stylesheet is
 * requested the first time a face is chosen and reused after that; until it
 * arrives the stack falls through to the system face, which is what
 * `display=swap` on the Google Fonts URL is for.
 */
export function applyPreviewFont(fontId: string): void {
  if (!previewing) return;
  const font = fontOption(fontId);
  ensureFontLoaded(font);
  writeFont(document.documentElement, font.stack);
}

/**
 * Updates one variable in a preview already on screen. The hot path.
 *
 * Deliberately does *not* take the lock — `applyPreview` is the only thing that
 * does. A stray call here with no draft open would otherwise freeze theme
 * application across the whole app with nothing on screen to explain why.
 */
export function applyPreviewVar(key: string, value: string): void {
  if (!previewing || !key.startsWith('--') || !value) return;
  document.documentElement.style.setProperty(key, value);
}

/**
 * Releases the lock and repaints from `settings`, discarding the draft.
 *
 * Always pass the settings that should be on screen afterwards rather than
 * relying on a later effect: between the release and the next render the page
 * would otherwise sit in whatever half-state the draft left behind.
 */
export function endPreview(settings: Painted): void {
  previewing = false;
  applyTheme(settings);
}

export function isPreviewing(): boolean {
  return previewing;
}

/**
 * Writes a palette onto `<html>`.
 *
 * `cssText = ''` clears whatever the boot snippet or a previous theme left
 * behind, so switching from a custom palette back to a built-in one does not
 * leave orphaned custom properties overriding it.
 *
 * A no-op while a preview holds the lock — see above. `endPreview` is the only
 * caller that can repaint out of that state.
 */
export function applyTheme(settings: Painted): void {
  if (previewing) return;

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

  /* After cssText is cleared, so switching palette cannot drop the typeface —
     the font is independent of the palette and outlives it. */
  const font = fontOption(settings.fontFamily);
  ensureFontLoaded(font);
  writeFont(root, font.stack);
}

/**
 * The body face and the heading face move together.
 *
 * `--font-mono` is left alone deliberately: it sets figures, tickers and code,
 * where a proportional face would break column alignment.
 */
function writeFont(root: HTMLElement, stack: string): void {
  root.style.setProperty('--font-sans', stack);
  root.style.setProperty('--font-display', stack);
}
