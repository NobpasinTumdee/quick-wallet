/**
 * Series colours for the Deep Analytics explorer.
 *
 * ---------------------------------------------------------------------------
 * WHY A FIXED PALETTE HERE, WHEN THE REST OF THE APP DERIVES FROM THE ACCENT
 * ---------------------------------------------------------------------------
 * Everywhere else, colour encodes magnitude on one hue, which a theme token can
 * carry safely. Group-by is different: colour *is* the identity channel, so it
 * needs hues that stay distinguishable under colour-vision deficiency. That is
 * a computable property of a specific set of hex values against a specific
 * surface — and it is not computable for "whatever the user's accent happens to
 * be" at all. So these are fixed, and they were validated rather than chosen.
 *
 * ---------------------------------------------------------------------------
 * THE EVIDENCE (scripts/validate_palette.js from the dataviz skill)
 * ---------------------------------------------------------------------------
 * Run against the `--surface` of every built-in theme:
 *
 *   light set, 8 adjacent pairs    — PASS on #ffffff, #fffbf0 (light, rosegold, solarized)
 *   light set, first 3, all pairs  — PASS on both
 *   dark set,  8 adjacent pairs    — PASS on all ten dark surfaces
 *   dark set,  first 3, all pairs  — PASS on all ten
 *
 * Contrast below 3:1 on some slots — light (aqua, yellow, magenta), dracula
 * (magenta, green) and nord (five slots; its surface is unusually light for a
 * dark theme). The validator's relief rule applies and is not optional: every
 * chart ships with a legend and a table view, so no value depends on seeing a
 * low-contrast mark. The `custom` theme cannot be validated in advance — its
 * surface is user-defined — so it gets whichever set its surface's luminance
 * selects, the same as every other theme does at runtime.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CAP DEPENDS ON THE CHART
 * ---------------------------------------------------------------------------
 * Adjacent-pair charts (bars, lines) only put neighbouring slots side by side,
 * and all eight pass that. A scatter plot puts every pair on screen at once,
 * and no ordering of eight hues survives all 28 pairs — only the first three
 * do. So a scatter folds everything past its third group into "Other", while a
 * bar chart keeps eight. That is `seriesCap`.
 */

export const LIGHT_SERIES = [
  '#2a78d6', // blue
  '#eb6834', // orange
  '#1baf7a', // aqua
  '#eda100', // yellow
  '#e87ba4', // magenta
  '#008300', // green
  '#4a3aa7', // violet
  '#e34948', // red
] as const;

export const DARK_SERIES = [
  '#3987e5',
  '#d95926',
  '#199e70',
  '#c98500',
  '#d55181',
  '#008300',
  '#9085e9',
  '#e66767',
] as const;

/**
 * "Other" is a bucket, not a category, so it wears no hue — a neutral that
 * reads as the absence of identity rather than a ninth series.
 */
export const OTHER_LIGHT = '#a3a19b';
export const OTHER_DARK = '#6b6a66';

/** The single-series colour: slot 1, never a ramp across nominal categories. */
export function singleSeriesColor(dark: boolean): string {
  return dark ? DARK_SERIES[0] : LIGHT_SERIES[0];
}

export type PairScope = 'adjacent' | 'all';

/** How many distinct hues a chart may use before folding into "Other". */
export function seriesCap(scope: PairScope): number {
  return scope === 'all' ? 3 : 8;
}

/**
 * Colour for series `slot`, where `slot` is the entity's rank in a stable
 * ordering — never its position after filtering, or a filter would repaint the
 * survivors. `null` means the "Other" bucket.
 */
export function seriesColor(slot: number | null, dark: boolean): string {
  /* Past the eighth slot there is no colour, only Other. The old `% length`
     here recycled slot 1's blue for series nine — the one colour guaranteed to
     be confused with an existing series, which is why the rule forbids it. */
  if (slot === null || slot < 0 || slot >= PALETTE_SIZE) return dark ? OTHER_DARK : OTHER_LIGHT;
  return (dark ? DARK_SERIES : LIGHT_SERIES)[slot];
}

/** How many validated hues there are. Nothing past this gets a generated one. */
export const PALETTE_SIZE = 8;

/**
 * WCAG contrast ratio between two colours.
 *
 * Used for one warning: a user-picked series colour that falls under 3:1
 * against the chart surface. It is still allowed — it is their chart — but the
 * legend says so, and points at the table where the values stay readable.
 */
export function contrastRatio(a: string, b: string): number | null {
  const ca = parseColor(a);
  const cb = parseColor(b);
  if (!ca || !cb) return null;
  const lum = ([r, g, bl]: [number, number, number]) => {
    const [lr, lg, lb] = [r, g, bl].map((channel) => {
      const c = channel / 255;
      return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * lr + 0.7152 * lg + 0.0722 * lb;
  };
  const [hi, lo] = [lum(ca), lum(cb)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Whether a surface colour is dark, by relative luminance.
 *
 * Accepts `#rgb`, `#rrggbb`, and `rgb()`/`rgba()`, because what comes back from
 * `getComputedStyle` depends on how the theme declared the token. Anything
 * unparseable falls back to dark, which is this app's default theme.
 */
export function isDarkSurface(color: string): boolean {
  const rgb = parseColor(color);
  if (!rgb) return true;
  const [r, g, b] = rgb.map((channel) => {
    const c = channel / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  const luminance = 0.2126 * r + 0.7152 * g + 0.0722 * b;
  // The midpoint of the WCAG luminance scale in perceptual terms.
  return luminance < 0.18;
}

export function parseColor(color: string): [number, number, number] | null {
  const value = String(color ?? '').trim().toLowerCase();

  const hex = /^#([0-9a-f]{3}|[0-9a-f]{6})$/.exec(value);
  if (hex) {
    const digits =
      hex[1].length === 3
        ? hex[1]
            .split('')
            .map((d) => d + d)
            .join('')
        : hex[1];
    return [0, 2, 4].map((i) => parseInt(digits.slice(i, i + 2), 16)) as [number, number, number];
  }

  const rgb = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/.exec(value);
  if (rgb) return [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])];

  return null;
}
