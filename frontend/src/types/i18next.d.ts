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
      translation: typeof import('../locales/en').en;
    };
    /** Values are read as plain strings, never as `null`. */
    returnNull: false;
  }
}

export {};
