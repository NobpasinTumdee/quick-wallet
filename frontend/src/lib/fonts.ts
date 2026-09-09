/**
 * The typeface catalogue a theme can choose from.
 *
 * ---------------------------------------------------------------------------
 * WHY AN ID AND NOT A FONT STACK
 * ---------------------------------------------------------------------------
 * A theme stores `fontFamily: 'sarabun'`, never `"Sarabun", system-ui, …`. Two
 * reasons, and both matter:
 *
 *   - A real stack is a CSS *value* that ends up inside a custom property on
 *     <html>. Accepting arbitrary text there is an injection surface, and
 *     `sanitizeCustomVars_` in Code.gs caps CSS values at 40 characters —
 *     shorter than any of the stacks below. An id is validated against this
 *     list on both sides and cannot be anything else.
 *   - The stack, the Google Fonts URL and the label can then be changed here in
 *     one place without a migration, because what users saved is a name.
 *
 * ---------------------------------------------------------------------------
 * WHICH TOKENS THIS DRIVES
 * ---------------------------------------------------------------------------
 * Selecting a font rewrites `--font-sans` *and* `--font-display` — the body
 * face and the heading face — because a theme's typeface should be the whole
 * UI's typeface. `--font-mono` is deliberately untouched: it carries figures,
 * tickers and code, where a proportional face would misalign columns.
 */

/**
 * The stock stack, and the tail of every other one.
 *
 * Kept byte-identical to `--font-sans` in `styles/theme.css`, which is what the
 * app falls back to when no font is chosen. It also serves as the fallback for
 * the Latin faces below, which carry no Thai glyphs — a Thai user who picks
 * Inter still gets readable Thai from the OS rather than tofu.
 */
const SYSTEM_STACK =
  "'Segoe UI Variable Text', 'Segoe UI', -apple-system, BlinkMacSystemFont, Inter, system-ui, 'Helvetica Neue', Arial, sans-serif";

export interface FontOption {
  /** What a theme stores. Must match FONTS in Code.gs. */
  id: string;
  label: string;
  /** Short line under the name in the picker. */
  blurb: string;
  /** The CSS value written to `--font-sans` / `--font-display`. */
  stack: string;
  /** Google Fonts stylesheet, or '' for a face already on the machine. */
  href: string;
  /** Carries Thai glyphs of its own, rather than falling back to the OS. */
  thai: boolean;
}

/* The weights the UI actually uses — see --weight-normal…--weight-bold in
   theme.css. Requesting the full 100–900 range would triple the download for
   faces nothing renders. 680 (--weight-bold) resolves to the 700 cut. */
const WEIGHTS = 'wght@400;500;600;700';

function googleFont(family: string): string {
  return `https://fonts.googleapis.com/css2?family=${family}:${WEIGHTS}&display=swap`;
}

export const FONTS: readonly FontOption[] = [
  {
    id: 'system',
    label: 'System',
    blurb: "Your OS's own UI face — nothing to download",
    stack: SYSTEM_STACK,
    href: '',
    thai: true,
  },
  {
    id: 'inter',
    label: 'Inter',
    blurb: 'Neutral, dense, built for screens',
    stack: `'Inter', ${SYSTEM_STACK}`,
    href: googleFont('Inter'),
    thai: false,
  },
  {
    id: 'prompt',
    label: 'Prompt',
    blurb: 'Geometric. Thai and Latin in one family',
    stack: `'Prompt', ${SYSTEM_STACK}`,
    href: googleFont('Prompt'),
    thai: true,
  },
  {
    id: 'sarabun',
    label: 'Sarabun',
    blurb: 'The Thai civil-service face. Long-read friendly',
    stack: `'Sarabun', ${SYSTEM_STACK}`,
    href: googleFont('Sarabun'),
    thai: true,
  },
  {
    id: 'noto-sans-thai',
    label: 'Noto Sans Thai',
    blurb: 'Widest Thai coverage, matches Noto everywhere else',
    stack: `'Noto Sans Thai', ${SYSTEM_STACK}`,
    href: googleFont('Noto+Sans+Thai'),
    thai: true,
  },
  {
    id: 'sans-serif',
    label: 'Plain sans-serif',
    blurb: "Whatever the browser calls sans-serif. No opinion",
    stack: 'sans-serif',
    href: '',
    thai: true,
  },
] as const;

export const DEFAULT_FONT_ID = 'system';

/**
 * An id from anywhere — a saved theme, localStorage, a settings row written by
 * an older build — resolved to something renderable. Never throws, because the
 * alternative is a blank app over a typo.
 */
export function fontOption(id: string | undefined | null): FontOption {
  return FONTS.find((font) => font.id === id) ?? FONTS[0];
}

/* ------------------------------------------------------------------ */
/* Loading                                                             */
/* ------------------------------------------------------------------ */

/** Marks the <link> elements this module owns, so it can find them again. */
const LINK_ID_PREFIX = 'qw-font-';

/**
 * Adds the stylesheet for a font, once.
 *
 * Idempotent by element id rather than by a module-level Set: the anti-FOUC
 * snippet in index.html injects the active font's link before this module has
 * even been parsed, and re-adding it here would fetch the same stylesheet
 * twice. Checking the DOM is what lets the two agree.
 *
 * System stacks have no href and are a no-op.
 */
export function ensureFontLoaded(font: FontOption): void {
  if (!font.href || typeof document === 'undefined') return;

  const id = LINK_ID_PREFIX + font.id;
  if (document.getElementById(id)) return;

  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = font.href;
  document.head.appendChild(link);
}

/**
 * Loads every catalogue font.
 *
 * Called when the theme creator opens, so each option in the picker renders in
 * its own face. Doing it any earlier would download five families for a user
 * who never opens Settings; doing it lazily per card would show the picker
 * lying about what it is offering until each one arrived.
 */
export function preloadFontCatalogue(): void {
  FONTS.forEach(ensureFontLoaded);
}
