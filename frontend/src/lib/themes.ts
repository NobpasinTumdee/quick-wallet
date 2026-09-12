/**
 * The theme catalogue the Settings picker renders.
 *
 * Each entry mirrors one `:root[data-theme='…']` block in `styles/theme.css`.
 * Three values are duplicated here — the accent and the preview swatches —
 * because the picker paints a preview *before* a theme is applied, and the
 * custom properties of an inactive block are not readable from JS.
 *
 * `accent` matters for more than the swatch. SettingsContext writes
 * `settings.accent` inline on <html> as `--accent`, which would otherwise
 * override every palette's own accent and leave all thirteen themes the same
 * shade of blue. Selecting a theme therefore saves its accent alongside it;
 * the accent picker still overrides it afterwards.
 *
 * `themes.test` checks these values against theme.css so the two cannot drift.
 */

import {
  Gem,
  Ghost,
  Moon,
  MoonStar,
  Palette,
  Snowflake,
  Sparkles,
  Sun,
  Sunset,
  Trees,
  Waves,
  Zap,
  type LucideIcon,
} from 'lucide-react';

import { ThemeName } from '../types';

export interface ThemePreset {
  value: ThemeName;
  label: string;
  /** Short line shown under the name in the picker. */
  blurb: string;
  scheme: 'light' | 'dark';
  icon: LucideIcon;
  /** Mirrors --accent for this theme. */
  accent: string;
  /** [page, surface, accent, text] — the mini preview swatches. */
  swatches: readonly [string, string, string, string];
}

export const THEME_PRESETS = [
  {
    value: 'light',
    label: 'Light',
    blurb: 'The default paper palette',
    scheme: 'light',
    icon: Sun,
    accent: '#3b6fff',
    swatches: ['#f7f8fb', '#ffffff', '#3b6fff', '#0b1220'],
  },
  {
    value: 'dark',
    label: 'Dark',
    blurb: 'Cool graphite and blue',
    scheme: 'dark',
    icon: Moon,
    accent: '#5d8bff',
    swatches: ['#070a12', '#111725', '#5d8bff', '#eef2fb'],
  },
  {
    value: 'ocean',
    label: 'Ocean',
    blurb: 'Deep water, cold cyan',
    scheme: 'dark',
    icon: Waves,
    accent: '#38bde0',
    swatches: ['#05141f', '#0c2231', '#38bde0', '#e9f5fb'],
  },
  {
    value: 'forest',
    label: 'Forest',
    blurb: 'Pine and moss',
    scheme: 'dark',
    icon: Trees,
    accent: '#55cf85',
    swatches: ['#0a1410', '#10241c', '#55cf85', '#eaf6ee'],
  },
  {
    value: 'sunset',
    label: 'Sunset',
    blurb: 'Dusk over warm plum',
    scheme: 'dark',
    icon: Sunset,
    accent: '#ff9264',
    swatches: ['#1a0e12', '#2a1620', '#ff9264', '#fdeef1'],
  },
  {
    value: 'cyberpunk',
    label: 'Cyberpunk',
    blurb: 'Neon magenta on near-black',
    scheme: 'dark',
    icon: Zap,
    accent: '#fa4fdc',
    swatches: ['#070510', '#120c22', '#fa4fdc', '#f3edff'],
  },
  {
    value: 'rosegold',
    label: 'Rose Gold',
    blurb: 'Light, warm blush and copper',
    scheme: 'light',
    icon: Gem,
    accent: '#9e5f67',
    swatches: ['#fdf6f3', '#ffffff', '#9e5f67', '#2e1c18'],
  },
  {
    value: 'midnight',
    label: 'Midnight',
    blurb: 'The quietest dark in the set',
    scheme: 'dark',
    icon: MoonStar,
    accent: '#7aa2f7',
    swatches: ['#05070d', '#0c1018', '#7aa2f7', '#eaeef7'],
  },
  {
    value: 'dracula',
    label: 'Dracula',
    blurb: 'The classic developer palette',
    scheme: 'dark',
    icon: Ghost,
    accent: '#bd93f9',
    swatches: ['#282a36', '#343746', '#bd93f9', '#f8f8f2'],
  },
  {
    value: 'nord',
    label: 'Nord',
    blurb: 'Polar night and frost',
    scheme: 'dark',
    icon: Snowflake,
    accent: '#88c0d0',
    swatches: ['#2e3440', '#3b4252', '#88c0d0', '#eceff4'],
  },
  {
    value: 'solarized',
    label: 'Solarized',
    blurb: 'Light, on warm paper',
    scheme: 'light',
    icon: Sparkles,
    accent: '#1a72ac',
    swatches: ['#fdf6e3', '#fffbf0', '#1a72ac', '#073642'],
  },
  {
    value: 'amethyst',
    label: 'Amethyst',
    blurb: 'Violet, the richest dark here',
    scheme: 'dark',
    icon: Gem,
    accent: '#b06bfa',
    swatches: ['#0e0818', '#1a1029', '#b06bfa', '#f2ebfd'],
  },
  {
    value: 'custom',
    label: 'Custom base',
    blurb: 'Midnight teal — the blank canvas',
    scheme: 'dark',
    icon: Palette,
    accent: '#3fd0aa',
    swatches: ['#071413', '#0f2523', '#3fd0aa', '#e8f6f2'],
  },
] as const satisfies readonly ThemePreset[];

/**
 * Compile-time guard: adding a ThemeName without a preset makes this line fail,
 * rather than shipping a theme that saves fine but never appears in the picker.
 */
type AssertNever<T extends never> = T;
export type __EveryThemeHasAPreset = AssertNever<
  Exclude<ThemeName, (typeof THEME_PRESETS)[number]['value']>
>;

export function themePreset(value: ThemeName): ThemePreset {
  return THEME_PRESETS.find((preset) => preset.value === value) ?? THEME_PRESETS[0];
}

/* ------------------------------------------------------------------ */
/* The custom-theme editor's palette                                   */
/* ------------------------------------------------------------------ */

export interface ThemeVar {
  key: string;
  label: string;
  /** Short line under the swatch. */
  hint: string;
  /** The `:root[data-theme='custom']` value, i.e. where a fresh theme starts. */
  fallback: string;
}

/**
 * The CSS custom properties the theme creator exposes, in the order they are
 * shown.
 *
 * Deliberately a small set of *primitives*. Every other token in theme.css —
 * glass, tints, elevation, hover states, ambient washes — is derived from these
 * with `color-mix`, so eleven pickers recolour the entire app rather than a few
 * boxes. Adding a key here also requires adding it to ALLOWED_CUSTOM_VARS in
 * Code.gs, which drops anything it does not recognise.
 *
 * The fallbacks mirror the `:root[data-theme='custom']` block in theme.css;
 * that block is what shows through for any variable the user has not set.
 */
export const THEME_VARS: readonly ThemeVar[] = [
  { key: '--bg', label: 'Page', hint: 'Behind everything', fallback: '#071413' },
  { key: '--surface', label: 'Surface', hint: 'Cards and panels', fallback: '#0f2523' },
  { key: '--surface-2', label: 'Raised', hint: 'Inputs and wells', fallback: '#143230' },
  { key: '--border', label: 'Border', hint: 'Hairlines and dividers', fallback: '#1d403d' },
  { key: '--text', label: 'Text', hint: 'Headings and figures', fallback: '#e8f6f2' },
  { key: '--text-muted', label: 'Muted text', hint: 'Labels and hints', fallback: '#86a8a2' },
  { key: '--accent', label: 'Accent', hint: 'Buttons, links, focus', fallback: '#3fd0aa' },
  { key: '--accent-contrast', label: 'On accent', hint: 'Text over the accent', fallback: '#032019' },
  { key: '--positive', label: 'Positive', hint: 'Income and gains', fallback: '#4fd6a8' },
  { key: '--negative', label: 'Negative', hint: 'Spending and losses', fallback: '#ff7a8a' },
  { key: '--warning', label: 'Warning', hint: 'Overdue and over budget', fallback: '#efb45c' },
] as const;

/** A fresh palette: every editable variable at its `custom` theme default. */
export function defaultThemeColors(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const variable of THEME_VARS) out[variable.key] = variable.fallback;
  return out;
}

/**
 * A stored palette filled out to a complete one.
 *
 * A theme saved by an older build, or one the server sanitised, can be missing
 * keys; the pickers are `<input type="color">` and would fall back to black
 * rather than to the theme's own default if handed `undefined`.
 */
export function completeThemeColors(colors: Record<string, string> | undefined): Record<string, string> {
  const out = defaultThemeColors();
  for (const variable of THEME_VARS) {
    const value = colors?.[variable.key];
    if (value) out[variable.key] = value;
  }
  return out;
}

/** The four swatches a theme card paints, in `ThemePreset.swatches` order. */
export function customSwatches(
  colors: Record<string, string>,
): readonly [string, string, string, string] {
  const full = completeThemeColors(colors);
  return [full['--bg'], full['--surface'], full['--accent'], full['--text']];
}
