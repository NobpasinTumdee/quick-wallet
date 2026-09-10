/**
 * The single place the app's language is read and changed.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS RATHER THAN CALLING i18n.changeLanguage DIRECTLY
 * ---------------------------------------------------------------------------
 * Language in this app is two values that must not disagree:
 *
 *   `i18n.language`      'th'      — which dictionary `t()` reads
 *   `settings.locale`    'th-TH'   — what every Intl call formats against
 *
 * `settings.locale` was already here before i18n was, and it drives money,
 * dates and numbers across every screen. Left as two independent controls, the
 * obvious outcome is an interface in Thai quoting `September 2026` and
 * `$1,234.56` — each half individually correct and the pair obviously broken.
 *
 * So `setLanguage` writes both: i18next immediately, for an instant re-render
 * with no reload, and the settings row for durability. Nothing else in the app
 * should call `changeLanguage`.
 */

import { useCallback, useEffect } from 'react';
import { useTranslation } from 'react-i18next';

import {
  DEFAULT_LANGUAGE,
  LANGUAGES,
  Language,
  languageFromLocale,
  localeForLanguage,
} from '../locales';
import { useSettings } from '../state/SettingsContext';

export interface LanguageState {
  /** The language in effect right now. Always one of `LANGUAGES`. */
  language: Language;
  /** The registry, for rendering a switcher. */
  languages: typeof LANGUAGES;
  /** Switches instantly, and persists. Safe to await; the UI updates first. */
  setLanguage: (code: Language) => Promise<void>;
  /** True while the settings write is in flight. */
  saving: boolean;
}

export function useLanguage(): LanguageState {
  const { i18n } = useTranslation();
  const { settings, save, loading } = useSettings();

  const language = (i18n.resolvedLanguage ?? DEFAULT_LANGUAGE) as Language;

  const setLanguage = useCallback(
    async (code: Language) => {
      /* i18next first, and not awaited for the UI's benefit: resources are
         already bundled, so this resolves synchronously and every subscribed
         component re-renders in the same tick. The user sees the new language
         before the network is even touched. */
      await i18n.changeLanguage(code);

      /* Then the durable half. The locale is only overwritten when it does not
         already match the new language — someone who deliberately set `en-GB`
         while running the English UI should keep their DD/MM dates rather than
         be silently moved to `en-US` for touching an unrelated control. */
      const nextLocale =
        languageFromLocale(settings.locale) === code ? settings.locale : localeForLanguage(code);

      if (settings.locale !== nextLocale) await save({ locale: nextLocale });
    },
    [i18n, save, settings.locale],
  );

  return { language, languages: LANGUAGES, setLanguage, saving: loading };
}

/**
 * Pulls the stored locale into i18next once settings arrive.
 *
 * Mounted once, high in the tree. The detector has already picked a language
 * from localStorage or the browser by the time this runs; this is what lets the
 * account's own preference take over on a device that has never seen it —
 * signing in on a friend's laptop should not leave the UI in their language.
 *
 * A no-op when the two already agree, which is the common case, so it does not
 * fight a switch the user just made.
 */
export function useLanguageSync(): void {
  const { i18n } = useTranslation();
  const { settings } = useSettings();

  const desired = languageFromLocale(settings.locale);

  useEffect(() => {
    /* In an effect, not during render. `changeLanguage` synchronously notifies
       every `useTranslation` subscriber, so calling it while this component
       renders would be setting state on other components mid-render — the
       "Cannot update a component while rendering a different component"
       error. The cost is one frame in the previous language after settings
       land, which is invisible next to the round trip that fetched them. */
    if (i18n.resolvedLanguage !== desired) void i18n.changeLanguage(desired);
  }, [i18n, desired]);
}
