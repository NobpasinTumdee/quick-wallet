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
  Building2,
  CloudMoon,
  Coffee,
  Cookie,
  Flame,
  Flower,
  Flower2,
  Gem,
  Ghost,
  Globe,
  House,
  Landmark,
  Leaf,
  Moon,
  MoonStar,
  Mountain,
  Music,
  Palette,
  PiggyBank,
  Play,
  Snowflake,
  Sparkles,
  Sprout,
  Stars,
  Sun,
  SunMedium,
  Sunset,
  ThumbsUp,
  TreePine,
  Trees,
  Users,
  Waves,
  Zap,
  type LucideIcon
} from 'lucide-react';

import { ThemeName } from '../types';
import { TranslationKey } from '../locales';

export interface ThemePreset {
  value: ThemeName;
  /**
   * The name and the one-line description, as dictionary keys.
   *
   * Held as keys rather than English strings because the picker is the one
   * screen where a user is choosing by *feel*, and "Oatmilk — warm beige and
   * espresso" only conveys that feeling in a language they read. Proper nouns
   * still read as proper nouns in Thai; the blurbs are what carry the sense.
   */
  labelKey: TranslationKey;
  blurbKey: TranslationKey;
  scheme: 'light' | 'dark';
  /**
   * Which section of the picker this belongs in.
   *
   * Added when the catalogue passed forty: a single grid of forty-four
   * swatches is not a choice, it is a wall. `classic` is the original set,
   * which is why it is the default rather than something every existing entry
   * had to be annotated with.
   */
  category?: 'classic' | 'thai' | 'tech';
  icon: LucideIcon;
  /** Mirrors --accent for this theme. */
  accent: string;
  /** [page, surface, accent, text] — the mini preview swatches. */
  swatches: readonly [string, string, string, string];
}

export const THEME_PRESETS = [
  {
    value: 'light',
    labelKey: 'theme.nameLight',
    blurbKey: 'theme.blurbLight',
    scheme: 'light',
    icon: Sun,
    accent: '#3768f5',
    swatches: ['#f7f8fb', '#ffffff', '#3768f5', '#0b1220'],
  },
  {
    value: 'dark',
    labelKey: 'theme.nameDark',
    blurbKey: 'theme.blurbDark',
    scheme: 'dark',
    icon: Moon,
    accent: '#5d8bff',
    swatches: ['#070a12', '#111725', '#5d8bff', '#eef2fb'],
  },
  {
    value: 'ocean',
    labelKey: 'theme.nameOcean',
    blurbKey: 'theme.blurbOcean',
    scheme: 'dark',
    icon: Waves,
    accent: '#38bde0',
    swatches: ['#05141f', '#0c2231', '#38bde0', '#e9f5fb'],
  },
  {
    value: 'forest',
    labelKey: 'theme.nameForest',
    blurbKey: 'theme.blurbForest',
    scheme: 'dark',
    icon: Trees,
    accent: '#55cf85',
    swatches: ['#0a1410', '#10241c', '#55cf85', '#eaf6ee'],
  },
  {
    value: 'sunset',
    labelKey: 'theme.nameSunset',
    blurbKey: 'theme.blurbSunset',
    scheme: 'dark',
    icon: Sunset,
    accent: '#ff9264',
    swatches: ['#1a0e12', '#2a1620', '#ff9264', '#fdeef1'],
  },
  {
    value: 'cyberpunk',
    labelKey: 'theme.nameCyberpunk',
    blurbKey: 'theme.blurbCyberpunk',
    scheme: 'dark',
    icon: Zap,
    accent: '#fa4fdc',
    swatches: ['#070510', '#120c22', '#fa4fdc', '#f3edff'],
  },
  {
    value: 'rosegold',
    labelKey: 'theme.nameRosegold',
    blurbKey: 'theme.blurbRosegold',
    scheme: 'light',
    icon: Gem,
    accent: '#9e5f67',
    swatches: ['#fdf6f3', '#ffffff', '#9e5f67', '#2e1c18'],
  },
  {
    value: 'midnight',
    labelKey: 'theme.nameMidnight',
    blurbKey: 'theme.blurbMidnight',
    scheme: 'dark',
    icon: MoonStar,
    accent: '#7aa2f7',
    swatches: ['#05070d', '#0c1018', '#7aa2f7', '#eaeef7'],
  },
  {
    value: 'dracula',
    labelKey: 'theme.nameDracula',
    blurbKey: 'theme.blurbDracula',
    scheme: 'dark',
    icon: Ghost,
    accent: '#bd93f9',
    swatches: ['#282a36', '#343746', '#bd93f9', '#f8f8f2'],
  },
  {
    value: 'nord',
    labelKey: 'theme.nameNord',
    blurbKey: 'theme.blurbNord',
    scheme: 'dark',
    icon: Snowflake,
    accent: '#88c0d0',
    swatches: ['#2e3440', '#3b4252', '#88c0d0', '#eceff4'],
  },
  {
    value: 'solarized',
    labelKey: 'theme.nameSolarized',
    blurbKey: 'theme.blurbSolarized',
    scheme: 'light',
    icon: Sparkles,
    accent: '#1a72ac',
    swatches: ['#fdf6e3', '#fffbf0', '#1a72ac', '#073642'],
  },
  {
    value: 'amethyst',
    labelKey: 'theme.nameAmethyst',
    blurbKey: 'theme.blurbAmethyst',
    scheme: 'dark',
    icon: Gem,
    accent: '#b06bfa',
    swatches: ['#0e0818', '#1a1029', '#b06bfa', '#f2ebfd'],
  },
  /* ----------------------------------------------------------------
     Minimal & cute — five light, five dark.

     Softer than the rest of the set by design, which is precisely where
     contrast slips: every accent below is the darkest member of its hue
     family that still reads as the soft colour intended, and
     `themecontrast.mjs` holds all of them to the same floors as the
     originals.
     ---------------------------------------------------------------- */
  {
    value: 'matcha',
    labelKey: 'theme.nameMatcha',
    blurbKey: 'theme.blurbMatcha',
    scheme: 'light',
    icon: Leaf,
    accent: '#55773f',
    swatches: ['#f3f6ec', '#fbfcf6', '#55773f', '#252d1b'],
  },
  {
    value: 'oatmilk',
    labelKey: 'theme.nameOatmilk',
    blurbKey: 'theme.blurbOatmilk',
    scheme: 'light',
    icon: Coffee,
    accent: '#7d4f2c',
    swatches: ['#f7f2e9', '#fffdf8', '#7d4f2c', '#2d2118'],
  },
  {
    value: 'sakura',
    labelKey: 'theme.nameSakura',
    blurbKey: 'theme.blurbSakura',
    scheme: 'light',
    icon: Flower2,
    accent: '#a83a55',
    swatches: ['#fdf1f3', '#fffafb', '#a83a55', '#3d121a'],
  },
  {
    value: 'lavender',
    labelKey: 'theme.nameLavender',
    blurbKey: 'theme.blurbLavender',
    scheme: 'light',
    icon: Flower,
    accent: '#64449f',
    swatches: ['#f5f2fc', '#fdfbff', '#64449f', '#281c39'],
  },
  {
    value: 'daylight',
    labelKey: 'theme.nameDaylight',
    blurbKey: 'theme.blurbDaylight',
    scheme: 'light',
    icon: SunMedium,
    accent: '#1f6ca8',
    swatches: ['#f4f9fd', '#ffffff', '#1f6ca8', '#0e2038'],
  },
  {
    value: 'cocoa',
    labelKey: 'theme.nameCocoa',
    blurbKey: 'theme.blurbCocoa',
    scheme: 'dark',
    icon: Cookie,
    accent: '#dda775',
    swatches: ['#1c1512', '#271d19', '#dda775', '#f6ede4'],
  },
  {
    value: 'moonlight',
    labelKey: 'theme.nameMoonlight',
    blurbKey: 'theme.blurbMoonlight',
    scheme: 'dark',
    icon: CloudMoon,
    accent: '#70d0e0',
    swatches: ['#101827', '#1a2434', '#70d0e0', '#eef4fb'],
  },
  {
    value: 'pine',
    labelKey: 'theme.namePine',
    blurbKey: 'theme.blurbPine',
    scheme: 'dark',
    icon: TreePine,
    accent: '#7cdeb2',
    swatches: ['#111a17', '#1a2622', '#7cdeb2', '#edf5f0'],
  },
  {
    value: 'slate',
    labelKey: 'theme.nameSlate',
    blurbKey: 'theme.blurbSlate',
    scheme: 'dark',
    icon: Mountain,
    accent: '#a6bbd2',
    swatches: ['#171b21', '#21262e', '#a6bbd2', '#f3f6fa'],
  },
  {
    value: 'twilight',
    labelKey: 'theme.nameTwilight',
    blurbKey: 'theme.blurbTwilight',
    scheme: 'dark',
    icon: Stars,
    accent: '#b9a1ec',
    swatches: ['#1a1726', '#251f35', '#b9a1ec', '#f4effa'],
  },
  {
    value: 'custom',
    labelKey: 'theme.nameCustom',
    blurbKey: 'theme.blurbCustom',
    scheme: 'dark',
    icon: Palette,
    accent: '#3fd0aa',
    swatches: ['#071413', '#0f2523', '#3fd0aa', '#e8f6f2'],
  },
  {
    value: 'bangkok-bank',
    labelKey: 'theme.nameBangkokBank',
    blurbKey: 'theme.blurbBangkokBank',
    scheme: 'light',
    category: 'thai',
    icon: Landmark,
    accent: '#0064ff',
    swatches: ['#f3f7ff', '#ffffff', '#0064ff', '#13233f'],
  },
  {
    value: 'kasikornbank',
    labelKey: 'theme.nameKasikornbank',
    blurbKey: 'theme.blurbKasikornbank',
    scheme: 'light',
    category: 'thai',
    icon: Leaf,
    accent: '#008740',
    swatches: ['#f1faf5', '#ffffff', '#008740', '#163126'],
  },
  {
    value: 'krungthai',
    labelKey: 'theme.nameKrungthai',
    blurbKey: 'theme.blurbKrungthai',
    scheme: 'light',
    category: 'thai',
    icon: Landmark,
    accent: '#005bac',
    swatches: ['#f2f7fc', '#ffffff', '#005bac', '#102a43'],
  },
  {
    value: 'scb',
    labelKey: 'theme.nameScb',
    blurbKey: 'theme.blurbScb',
    scheme: 'light',
    category: 'thai',
    icon: Gem,
    accent: '#4e2a84',
    swatches: ['#f7f3fb', '#ffffff', '#4e2a84', '#2b1b3c'],
  },
  {
    value: 'krungsri',
    labelKey: 'theme.nameKrungsri',
    blurbKey: 'theme.blurbKrungsri',
    scheme: 'light',
    category: 'thai',
    icon: Sun,
    accent: '#916f08',
    swatches: ['#fffbef', '#ffffff', '#916f08', '#302b1d'],
  },
  {
    value: 'ttb',
    labelKey: 'theme.nameTtb',
    blurbKey: 'theme.blurbTtb',
    scheme: 'light',
    category: 'thai',
    icon: Waves,
    accent: '#0072bc',
    swatches: ['#f2f8fc', '#ffffff', '#0072bc', '#123047'],
  },
  {
    value: 'uob',
    labelKey: 'theme.nameUob',
    blurbKey: 'theme.blurbUob',
    scheme: 'light',
    category: 'thai',
    icon: Gem,
    accent: '#003da5',
    swatches: ['#f2f6ff', '#ffffff', '#003da5', '#14274a'],
  },
  {
    value: 'cimb-thai',
    labelKey: 'theme.nameCimbThai',
    blurbKey: 'theme.blurbCimbThai',
    scheme: 'light',
    category: 'thai',
    icon: Flame,
    accent: '#e61b23',
    swatches: ['#fff5f5', '#ffffff', '#e61b23', '#351b20'],
  },
  {
    value: 'gsb',
    labelKey: 'theme.nameGsb',
    blurbKey: 'theme.blurbGsb',
    scheme: 'light',
    category: 'thai',
    icon: PiggyBank,
    accent: '#e01d5f',
    swatches: ['#fff5fa', '#ffffff', '#e01d5f', '#381d2b'],
  },
  {
    value: 'baac',
    labelKey: 'theme.nameBaac',
    blurbKey: 'theme.blurbBaac',
    scheme: 'light',
    category: 'thai',
    icon: Sprout,
    accent: '#198754',
    swatches: ['#f2f9f3', '#ffffff', '#198754', '#173520'],
  },
  {
    value: 'kkp',
    labelKey: 'theme.nameKkp',
    blurbKey: 'theme.blurbKkp',
    scheme: 'light',
    category: 'thai',
    icon: Gem,
    accent: '#5b3f8c',
    swatches: ['#f6f4fa', '#ffffff', '#5b3f8c', '#271f35'],
  },
  {
    value: 'tisco',
    labelKey: 'theme.nameTisco',
    blurbKey: 'theme.blurbTisco',
    scheme: 'light',
    category: 'thai',
    icon: Building2,
    accent: '#005a9c',
    swatches: ['#f3f7fb', '#ffffff', '#005a9c', '#172a3b'],
  },
  {
    value: 'ghb',
    labelKey: 'theme.nameGhb',
    blurbKey: 'theme.blurbGhb',
    scheme: 'light',
    category: 'thai',
    icon: House,
    accent: '#0072b1',
    swatches: ['#f2f8fc', '#ffffff', '#0072b1', '#183047'],
  },
  {
    value: 'lh-bank',
    labelKey: 'theme.nameLhBank',
    blurbKey: 'theme.blurbLhBank',
    scheme: 'light',
    category: 'thai',
    icon: House,
    accent: '#6a3d91',
    swatches: ['#f8f4fb', '#ffffff', '#6a3d91', '#2f1d3c'],
  },
  {
    value: 'standard-chartered',
    labelKey: 'theme.nameStandardChartered',
    blurbKey: 'theme.blurbStandardChartered',
    scheme: 'light',
    category: 'thai',
    icon: Globe,
    accent: '#0072ce',
    swatches: ['#f3f8fc', '#ffffff', '#0072ce', '#173046'],
  },
  {
    value: 'icbc',
    labelKey: 'theme.nameIcbc',
    blurbKey: 'theme.blurbIcbc',
    scheme: 'light',
    category: 'thai',
    icon: Landmark,
    accent: '#c41230',
    swatches: ['#fff5f5', '#ffffff', '#c41230', '#35191d'],
  },
  {
    value: 'thai-credit',
    labelKey: 'theme.nameThaiCredit',
    blurbKey: 'theme.blurbThaiCredit',
    scheme: 'light',
    category: 'thai',
    icon: Flame,
    accent: '#c74e22',
    swatches: ['#fff7f3', '#ffffff', '#c74e22', '#38251d'],
  },
  {
    value: 'spotify',
    labelKey: 'theme.nameSpotify',
    blurbKey: 'theme.blurbSpotify',
    scheme: 'light',
    category: 'tech',
    icon: Music,
    accent: '#15873d',
    swatches: ['#f2f8f3', '#ffffff', '#15873d', '#17231b'],
  },
  {
    value: 'youtube',
    labelKey: 'theme.nameYoutube',
    blurbKey: 'theme.blurbYoutube',
    scheme: 'light',
    category: 'tech',
    icon: Play,
    accent: '#eb0000',
    swatches: ['#fff5f5', '#ffffff', '#eb0000', '#1f1717'],
  },
  {
    value: 'facebook',
    labelKey: 'theme.nameFacebook',
    blurbKey: 'theme.blurbFacebook',
    scheme: 'light',
    category: 'tech',
    icon: ThumbsUp,
    accent: '#1771e6',
    swatches: ['#f2f6fc', '#ffffff', '#1771e6', '#1c1e21'],
  },
  {
    value: 'microsoft-teams',
    labelKey: 'theme.nameMicrosoftTeams',
    blurbKey: 'theme.blurbMicrosoftTeams',
    scheme: 'light',
    category: 'tech',
    icon: Users,
    accent: '#6264a7',
    swatches: ['#f7f7f8', '#ffffff', '#6264a7', '#252423'],
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

/**
 * The picker's sections, in the order they are shown.
 *
 * Each group is cut the way its own members actually differ. For the original
 * themes that is light versus dark — with those, the scheme *is* the decision,
 * and a dark theme appearing in a list of pale ones is a nasty surprise. The
 * brand palettes are all light, so splitting them that way would produce one
 * full section and one empty one; what distinguishes them is whose brand it
 * is, so they are grouped by that instead.
 */
/* Widened to the interface once: `as const satisfies` keeps the literal types
   on THEME_PRESETS, which is what makes `ThemeName` exhaustive — but it also
   means an entry without `category` has no such property to read. */
const ALL_PRESETS: readonly ThemePreset[] = THEME_PRESETS;

export const THEME_GROUPS = [
  {
    id: 'classic-light',
    titleKey: 'theme.schemeLight' as TranslationKey,
    presets: ALL_PRESETS.filter((p) => (p.category ?? 'classic') === 'classic' && p.scheme === 'light'),
  },
  {
    id: 'classic-dark',
    titleKey: 'theme.schemeDark' as TranslationKey,
    presets: ALL_PRESETS.filter((p) => (p.category ?? 'classic') === 'classic' && p.scheme === 'dark'),
  },
  {
    id: 'thai',
    titleKey: 'theme.groupThai' as TranslationKey,
    presets: ALL_PRESETS.filter((p) => p.category === 'thai'),
  },
  {
    id: 'tech',
    titleKey: 'theme.groupTech' as TranslationKey,
    presets: ALL_PRESETS.filter((p) => p.category === 'tech'),
  },
/* Built once at module load: the catalogue is static, and recomputing four
   filters on every render of the Settings page buys nothing. */
].filter((group) => group.presets.length > 0);

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
