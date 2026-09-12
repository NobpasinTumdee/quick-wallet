/**
 * The language registry — the one file you edit to add a language.
 *
 * ---------------------------------------------------------------------------
 * ADDING JAPANESE, SAY
 * ---------------------------------------------------------------------------
 *   1. copy `en.ts` to `ja.ts`, translate the values, type it `TranslationSchema`
 *   2. import it below and add one entry to `LANGUAGES`
 *
 * That is the whole job. The switcher renders from `LANGUAGES`, i18next's
 * resources are built from it, `Language` widens automatically, and TypeScript
 * lists every key you have not translated yet.
 *
 * ---------------------------------------------------------------------------
 * WHY EACH LANGUAGE CARRIES A LOCALE
 * ---------------------------------------------------------------------------
 * This app formats money, dates and numbers through `Intl`, driven by
 * `settings.locale` — a full BCP 47 tag like `th-TH`. i18next works in language
 * codes like `th`. Those are two different things and keeping them as two
 * independent user choices is how you end up with a Thai interface printing
 * `September 2026` and `$1,234.56`.
 *
 * So the mapping lives here, once. Picking a language sets both.
 */

import { en } from './en';
import { th } from './th';

export type { TranslationSchema, TranslationKey } from './en';

export interface LanguageDefinition {
  /** i18next language code — the `lng`, and what lands in localStorage. */
  code: string;
  /** Endonym: the language's name in itself, which is what a switcher shows.
   *  Someone who cannot read the current UI language still finds their own. */
  label: string;
  /** Two or three characters for the compact toggle. */
  short: string;
  /** Default BCP 47 tag for `Intl`. The user can still override it in Settings. */
  locale: string;
  dictionary: Record<string, Record<string, string>>;
}

export const LANGUAGES = [
  { code: 'en', label: 'English', short: 'EN', locale: 'en-US', dictionary: en },
  { code: 'th', label: 'ไทย', short: 'TH', locale: 'th-TH', dictionary: th },
] as const satisfies readonly LanguageDefinition[];

export type Language = (typeof LANGUAGES)[number]['code'];

export const DEFAULT_LANGUAGE: Language = 'en';

/** i18next's `resources`, built from the registry so the two cannot diverge. */
export const resources = Object.fromEntries(
  LANGUAGES.map((language) => [language.code, { translation: language.dictionary }]),
);

export const SUPPORTED_LANGUAGES: readonly string[] = LANGUAGES.map((l) => l.code);

export function languageDefinition(code: string): LanguageDefinition {
  return (
    LANGUAGES.find((language) => language.code === code) ??
    LANGUAGES.find((language) => language.code === DEFAULT_LANGUAGE)!
  );
}

/**
 * `'th-TH'` -> `'th'`.
 *
 * The stored locale is the richer value, so the language is derived from it
 * rather than the other way round. An unsupported region still resolves — a
 * user on `en-GB` gets English — and anything unrecognised falls back.
 */
export function languageFromLocale(locale: string | undefined): Language {
  const base = String(locale ?? '').split('-')[0].toLowerCase();
  return (SUPPORTED_LANGUAGES.includes(base) ? base : DEFAULT_LANGUAGE) as Language;
}

/** `'th'` -> `'th-TH'`. The default region for a language. */
export function localeForLanguage(code: string): string {
  return languageDefinition(code).locale;
}
