/**
 * The i18next instance.
 *
 * Imported for its side effect once, from `main.tsx`, before React mounts —
 * `useTranslation` throws if no instance is initialised, so this has to run
 * ahead of the first render rather than inside a component.
 *
 * ---------------------------------------------------------------------------
 * WHY INITIALISATION IS SYNCHRONOUS
 * ---------------------------------------------------------------------------
 * Dictionaries are plain modules in `src/locales/`, bundled with the app, so
 * `init()` resolves in the same tick and the very first paint is already in the
 * right language. The alternative — `i18next-http-backend` fetching JSON — buys
 * lazy loading at the cost of a flash of untranslated keys and a Suspense
 * boundary around the shell, which is a bad trade while the whole dictionary is
 * a couple of kilobytes. When there are ten languages of real size, switch the
 * `resources` line for a backend; nothing else here changes.
 *
 * ---------------------------------------------------------------------------
 * WHO DECIDES THE LANGUAGE
 * ---------------------------------------------------------------------------
 * Two sources, in order:
 *
 *   1. **The detector**, at boot — localStorage, then the browser's own
 *      language. This is what paints the login screen, before any account
 *      exists to have a preference.
 *   2. **`settings.locale`**, once signed in — the server-persisted value that
 *      also drives every `Intl` call in the app. `useLanguageSync` in
 *      `hooks/useLanguage.ts` pushes it into i18next when it loads or changes.
 *
 * The second wins deliberately: a preference saved to the sheet follows the
 * user to another device, and it keeps the interface language and the number
 * formatting as one decision instead of two that can disagree.
 */

import i18n from 'i18next';
import LanguageDetector from 'i18next-browser-languagedetector';
import { initReactI18next } from 'react-i18next';

import { DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, resources } from '../locales';

/** Where the detector caches the choice. Namespaced like every other key here. */
export const LANGUAGE_STORAGE_KEY = 'quick-wallet.language';

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: DEFAULT_LANGUAGE,
    supportedLngs: SUPPORTED_LANGUAGES,
    /* `en-GB` and `en-US` both resolve to `en`, so a region we have no
       dictionary for still gets the right language instead of the fallback. */
    nonExplicitSupportedLngs: true,
    load: 'languageOnly',

    detection: {
      // localStorage first: an explicit choice outranks the browser's guess.
      order: ['localStorage', 'navigator', 'htmlTag'],
      lookupLocalStorage: LANGUAGE_STORAGE_KEY,
      // The only place it is written. `changeLanguage` then persists for free.
      caches: ['localStorage'],
    },

    interpolation: {
      // React escapes on render; doing it again turns an apostrophe into &#39;.
      escapeValue: false,
    },

    // A missing key should be visible in development and silent in production,
    // where the English fallback is a better answer than a raw key path.
    saveMissing: false,
    returnNull: false,
    debug: false,
  });

/**
 * Keeps `<html lang>` in step.
 *
 * Not cosmetic: it is what a screen reader consults to choose a voice, and what
 * the browser uses for hyphenation and font fallback — which matters for Thai,
 * where the wrong fallback face renders tone marks badly.
 */
i18n.on('languageChanged', (language) => {
  if (typeof document !== 'undefined') document.documentElement.lang = language;
});

if (typeof document !== 'undefined') {
  document.documentElement.lang = i18n.resolvedLanguage ?? DEFAULT_LANGUAGE;
}

export default i18n;
