/**
 * Teaches `t()` the key space.
 *
 * With this in place `t('nav.dashboard')` autocompletes, `t('nav.dashbaord')`
 * is a compile error, and renaming a key in `en.ts` breaks every call site that
 * used the old name — which is the entire reason the dictionaries are
 * TypeScript rather than JSON.
 *
 * Ambient declaration: it has no imports at the top level, so it must not be
 * turned into a module by adding one. The `import` below is inside the
 * `declare module` block on purpose.
 */

declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation';
    resources: {
      /* Safe to spend's strings load with its card (locales/safeSpend.ts). */
      /* The month review's page strings load with the page (locales/review.ts). */
      translation: typeof import('../locales/en').en & {
        safeSpend: typeof import('../locales/safeSpend').safeSpendEn;
        review: typeof import('../locales/review').reviewEn;
      };
    };
    /** Values are read as plain strings, never as `null`. */
    returnNull: false;
  }
}

export {};
