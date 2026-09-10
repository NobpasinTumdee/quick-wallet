/**
 * English — the source of truth for every translation key.
 *
 * ---------------------------------------------------------------------------
 * WHY TYPESCRIPT AND NOT JSON
 * ---------------------------------------------------------------------------
 * The shape of this object *is* the schema. `TranslationSchema` is derived from
 * it, every other language is typed against that, and `i18next.d.ts` feeds it
 * back into `t()` — so a typo in a key is a compile error at the call site, and
 * a key missing from Thai is a compile error in `th.ts`. JSON would give up all
 * three: the app would build clean and show `nav.dashbaord` to a user.
 *
 * ---------------------------------------------------------------------------
 * HOW TO ADD A LANGUAGE
 * ---------------------------------------------------------------------------
 * Copy this file to `<code>.ts`, translate the values, and add one line to
 * `index.ts`. TypeScript then lists every key you have not translated yet.
 *
 * Keys are grouped by area, not by screen: a string used in three places
 * belongs under `common`, not duplicated under each. Interpolation uses
 * i18next's `{{name}}` syntax.
 */

export const en = {
  nav: {
    dashboard: 'Overview',
    wallets: 'Wallets',
    cards: 'Cards',
    transactions: 'Activity',
    investments: 'Invest',
    budgets: 'Budgets',
    subscriptions: 'Recurring',
    settings: 'Settings',
    /** The gesture button's accessible name — never rendered as text. */
    more: 'More pages',
    moreCurrent: 'More pages — {{label}} is open',
    signOut: 'Sign out',
    signedInAs: 'Signed in as',
    mainNavigation: 'Main navigation',
    collapseSidebar: 'Collapse sidebar',
    expandSidebar: 'Expand sidebar',
    collapse: 'Collapse',
  },

  common: {
    save: 'Save',
    saveChanges: 'Save changes',
    cancel: 'Cancel',
    confirm: 'Confirm',
    close: 'Close',
    delete: 'Delete',
    edit: 'Edit',
    add: 'Add',
    create: 'Create',
    archive: 'Archive',
    restore: 'Restore',
    dismiss: 'Dismiss',
    refresh: 'Refresh',
    refreshPage: 'Refresh this page',
    tryAgain: 'Try again',
    saved: 'Saved',
    loading: 'Loading…',
    optional: 'Optional',
    none: 'None',
    notSet: 'Not set',
    today: 'Today',
    previousMonth: 'Previous month',
    nextMonth: 'Next month',
    all: 'All',
    search: 'Search',
    total: 'Total',
    date: 'Date',
    amount: 'Amount',
    category: 'Category',
    note: 'Note',
    name: 'Name',
    type: 'Type',
    balance: 'Balance',
    somethingWentWrong: 'Something went wrong',
  },

  settings: {
    title: 'Settings',
    preferences: 'Preferences',
    language: 'Language',
    languageHint: 'Changes the interface language, and the locale used to format dates and amounts.',
    currency: 'Currency',
    currencyHint: 'What amounts are stored in. ISO code, e.g. USD, THB, EUR.',
    locale: 'Locale',
    localeHint: 'Controls number and date formatting.',
    monthlyIncome: 'Monthly income',
    categories: 'Categories',
    savePreferences: 'Save preferences',
    account: 'Account',
  },
} as const;

/**
 * The contract every other language has to meet.
 *
 * `typeof en` rather than a hand-written interface, so the schema can never
 * drift from the strings actually shipped. Values widen to `string` because a
 * translation is not the same literal as the English it replaces.
 */
export type TranslationSchema = {
  [Section in keyof typeof en]: { [Key in keyof (typeof en)[Section]]: string };
};

/**
 * Every valid key, as the dotted string `t()` takes — `'nav.wallets'`,
 * `'common.save'`, and so on.
 *
 * Derived from the dictionary rather than written out, so it cannot fall behind
 * it. Use it whenever a key has to be *stored* rather than called immediately:
 * a config table, a column definition, a nav list. Those are exactly the places
 * a plain `string` would let a typo through to the screen.
 */
export type TranslationKey = {
  [Section in keyof typeof en]: `${Section & string}.${keyof (typeof en)[Section] & string}`;
}[keyof typeof en];
