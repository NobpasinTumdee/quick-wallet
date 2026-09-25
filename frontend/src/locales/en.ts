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
 * ---------------------------------------------------------------------------
 * CONVENTIONS
 * ---------------------------------------------------------------------------
 *   - Keys are grouped by *area*, not by screen. A string used on three screens
 *     belongs under `common`, not copied into each.
 *   - Interpolation is i18next's `{{name}}`. Never assemble a sentence with
 *     template literals in a component: word order is not the same in every
 *     language, and a concatenation hard-codes English order somewhere a
 *     translator cannot reach it.
 *   - `_one` / `_other` are i18next plural suffixes, selected by `count`.
 *     Languages without plural inflection still declare both — see th.ts.
 */

export const en = {
  nav: {
    splits: 'Shared',
    dashboard: 'Overview',
    wallets: 'Wallets',
    cards: 'Cards',
    transactions: 'Activity',
    investments: 'Invest',
    budgets: 'Budgets',
    subscriptions: 'Recurring',
    debt: 'Debt',
    analytics: 'Analytics',
    deepAnalytics: 'Deep Analytics',
    goals: 'Goals',
    settings: 'Settings',
    more: 'More',
    /** The gesture button's accessible name — never rendered as text.
     *  Distinct from `more` above, which is the *page* the arc's last slot
     *  opens: the arc itself is a shortcut ring, not that page. */
    shortcuts: 'Shortcuts',
    shortcutsCurrent: 'Shortcuts — {{label}} is open',
    signOut: 'Sign out',
    signedInAs: 'Signed in as',
    mainNavigation: 'Main navigation',
    collapseSidebar: 'Collapse sidebar',
    expandSidebar: 'Expand sidebar',
    collapse: 'Collapse',
  },

  auth: {
    appName: 'Quick Wallet',
    username: 'Username',
    displayName: 'Display name',
    displayNameHint: 'Shown in the sidebar. Defaults to your username.',
    password: 'Password',
    passwordHint: 'At least 4 characters.',
    signIn: 'Sign in',
    createProfile: 'Create profile',
    signInFailed: 'Sign in failed',
    signInBlurb: 'Sign in to your workbook.',
    firstProfileBlurb: 'Create the first profile for this workbook.',
    anotherProfileBlurb: 'Add another profile to this workbook.',
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
    wallet: 'Wallet',
    seeAll: 'See all',
    manage: 'Manage',
    thisMonth: 'This month',
    somethingWentWrong: 'Something went wrong',
    clearFilters: 'Clear filters',
    addOne: 'Add one',
  },

  dashboard: {
    netWorth: 'Net worth',

    /* ---- The balance carousel ----
       Three readings of the same money, each the one before it minus a layer.
       The labels have to say what is *excluded*, because that is the only
       thing that tells them apart. */
    contextTotal: 'Total net worth',
    contextLiquid: 'Excluding investments',
    contextAvailable: 'Available to spend',
    contextLiquidNote: 'Cash and cards, with {{amount}} invested left out',
    contextAvailableNote: 'After {{amount}} earmarked for goals',
    contextAvailableNone: 'Nothing is earmarked for goals yet',
    balanceCarousel: 'Balance views',
    balanceCarouselHint: 'Swipe or use the dots to switch between total, liquid and available balances.',
    balanceView: 'View {{index}} of {{count}}',
    /* ---- Time travel ----
       The label has to name the month, because the one expensive mistake this
       feature can cause is reading a past balance as today's. */
    endOfMonthBalance: 'End of {{month}} balance',
    showEndOfMonthBalance: 'Show end-of-month balance',
    showCurrentBalance: 'Show current balance',
    asItStood: 'As it stood on {{date}}',
    holdingsAtCost: 'Holdings at cost',
    refresh: 'Refresh dashboard',
    loadFailed: "Couldn't load the dashboard",
    noData: 'No data returned',
    firstWalletTitle: 'Create your first wallet',
    firstWalletBody:
      'Wallets are where transactions and positions live. Add one, then start recording activity.',
    goToWallets: 'Go to wallets',
    taxCta: 'Calculate Thai income tax',

    cashOnHand: 'Cash on hand',
    cashWallets: 'Cash wallets',
    afterCards: '{{amount}} after cards',
    cardDebt: 'Card debt',
    limitUsed: '{{percent}} of limit used',
    alreadySubtracted: 'Already subtracted from net worth',
    income: 'Income',
    spent: 'Spent',
    savedLabel: 'Saved',
    savingsRate: 'Rate {{percent}}',
    unrealised: 'Unrealised',

    monthNetUp: '↑ {{amount}} this month',
    monthNetDown: '↓ {{amount}} this month',
    inPositions_one: '{{amount}} in {{count}} position · {{provider}} prices',
    inPositions_other: '{{amount}} in {{count}} positions · {{provider}} prices',
    walletCount_one: '{{count}} wallet',
    walletCount_other: '{{count}} wallets',
    categoryCount_one: '{{count}} category',
    categoryCount_other: '{{count}} categories',
    recordCount_one: '{{count}} record',
    recordCount_other: '{{count}} records',
    walletInvested: '{{cash}} cash · {{invested}} invested',

    budgetProgress: 'Budget progress',
    noBudgetsTitle: 'No budgets this month',
    noBudgetsBody:
      'Set limits by exact amount or as a share of income — 40% invest, 10% save, 20% needs.',
    createBudget: 'Create a budget',
    budgetUsed: '{{label}}: {{percent}} used',
    budgetOver: '{{amount}} over',
    budgetLeft: '{{amount}} left',
    allSpending: 'All spending',

    walletsTitle: 'Wallets',
    spending: 'Spending',
    investing: 'Investing',

    projectionTitle: 'Where this is heading',
    projectionSubtitle: "Projected net worth if today's savings rate holds",

    breakdownTitle: 'Where it went',
    nothingSpentTitle: 'Nothing spent yet',
    nothingSpentBody: 'Expenses this month show up here.',

    recentTitle: 'Recent activity',
    noTransactionsTitle: 'No transactions yet',
    noTransactionsBody: 'Add one from the Activity tab.',
  },

  invest: {
    noOpenPositions: 'No open positions',
    nothingSoldYet: 'Nothing sold yet',
    lotLabel: '{{symbol}} — {{quantity}} bought {{date}}',
    title: 'Invest',
    loadingPositions: 'Loading positions',
    noWalletTitle: 'No investment wallet yet',
    noWalletBody:
      'Create a wallet in Investment mode from the Wallets tab, then add positions here. Fund it with a transfer from a cash wallet.',

    costBasis: 'Cost basis',
    marketValue: 'Market value',
    unrealisedPnl: 'Unrealised P&L',
    realisedPnl: 'Realised P&L',

    holdings: 'Holdings',
    watchlist: 'Watchlist',
    positions: 'Positions',
    refreshPositions: 'Refresh positions',
    refreshPrices: 'Refresh prices',
    refreshWatchlist: 'Refresh watchlist',
    addPosition: 'Add a position',
    addSymbol: 'Add a symbol',
    addSymbolTo: 'Add a symbol to {{group}}',

    symbol: 'Symbol',
    quantity: 'Qty',
    avgCost: 'Avg cost',
    price: 'Price',
    value: 'Value',
    pnl: 'P&L',
    tags: 'Tags',
    buy: 'Buy',
    sell: 'Sell',
    cost: 'Cost',
    proceeds: 'Proceeds',
    targetPrice: 'Target price',

    purchaseHistory: 'Purchase history',
    addPurchase: 'Add purchase',
    addAnotherPurchase: 'Add another purchase of {{symbol}}',
    bought: 'Bought',
    pricePerShare: 'Price / share',
    shareOfPosition: 'Share of position',
    sellPrice: 'Sell price',
    deletePurchase: 'Delete this purchase',
    deletePurchaseConfirm: 'Delete this purchase?\n\n{{label}}',

    holdingCount: 'Holding ({{count}})',
    soldCount: 'Sold ({{count}})',
    closedLots_one: '{{count}} closed lot',
    closedLots_other: '{{count}} closed lots',
    sellLots_one: 'Sell {{count}} lot',
    sellLots_other: 'Sell {{count}} lots',
    sellSymbol: 'Sell {{symbol}}',
    whatSelling: 'What are you selling?',
    whatSellingHint:
      'Lots are sold whole. Pick one purchase, or close the entire position at this price.',
    sellPricePerShare: 'Sell price per share ({{currency}})',
    sellPriceCurrency: 'Sell price currency',
    brokerRateHint:
      'Type it exactly as your broker shows it — converted at {{rate}} on save.',

    investmentView: 'Investment view',
    positionView: 'Position view',
    convertedToday: "Converted at today's rate",
    convertedAt: 'Converted at {{rate}}',
    rateUnavailable: 'Exchange rate unavailable',
    currencyConversion: 'Currency conversion',
    rateFrom: 'Rate from {{time}}.',
    simulatedPrices: 'Simulated prices',
    someQuotesFailed: 'Some quotes failed',
    quoteMeta: '{{provider}} · {{time}}',

    emptyWatchlistTitle: 'Nothing on the watchlist',
    emptyWatchlistBody:
      'Track symbols you do not own yet. Group them however you think — sectors, conviction, a shortlist — set a target price, and click any row to chart it.',
    chartSymbol: 'Chart {{symbol}}',
    chartAndHistory: '{{symbol}}: chart and purchase history',
    expandChart: 'Expand the {{symbol}} chart to full screen',
    removeFromWatchlist: 'Remove {{symbol}} from the watchlist',
    removeFromWatchlistConfirm: 'Remove {{symbol}} from your watchlist?',

    newPosition: '+ New position',
    confirmSale: 'Confirm sale',
    positionCount_one: '{{count}} position',
    positionCount_other: '{{count}} positions',
    purchaseCount_one: '{{count}} purchase',
    purchaseCount_other: '{{count}} purchases',
    dateRange: '{{from}} – {{to}}',
    quoteError: '{{symbol}}: {{message}}',
    misEntered_one: '{{count}} position may be priced in {{currency}}',
    misEntered_other: '{{count}} positions may be priced in {{currency}}',
    checkPrice: 'check price',
    exitFullscreenHint: 'Exit full screen (Esc)',
    exitFullscreen: 'Exit full screen',
    fullscreen: 'Full screen',
    expandWatchlist: 'Expand the watchlist to full screen',
    emptyHoldingsBody:
      'Add a position with its symbol, buy price and quantity to start tracking P&L. Buy the same ticker again later and the two purchases average together automatically.',
    emptySoldBody:
      'Positions you mark as sold appear here with their realised P&L, one row per purchase.',
    sellPricePrefilled: 'Pre-filled with the latest quote, already converted.',
    checkPriceHint:
      'The cost per share is about {{factor}}× below the live price — the sign of a {{quote}} figure saved as {{base}}. Open the purchase history and re-enter the offending buy with the {{quote}} toggle.',
  },

  /* The re-authentication dialog. Its own section because it guards whatever
     it is pointed at, not wallets in particular. */
  confirm: {
    password: 'Your password',
    passwordPlaceholder: 'Enter your password',
    wrongPassword: 'That password is not right. Nothing was deleted.',
  },

  wallets: {
    /* ---- Deleting, which asks for the password ---- */
    deleteTitle: 'Delete {{name}}?',
    deleteWarning: 'This permanently deletes {{name}}.',
    deleteWarningBody: 'Deleting a wallet cannot be undone, and nothing in the workbook keeps a copy. Enter your password to confirm it is you.',
    deleteConfirm: 'Delete wallet',
    deleteEverything: 'Delete wallet and records',
    deleteCascadeOption: 'Also delete every transaction, investment and budget attached to this wallet',
    title: 'Wallets',
    accounts: 'Accounts',
    lede: 'Spending wallets track day-to-day money. Investment wallets hold positions and are funded by a transfer.',
    refresh: 'Refresh wallets',
    newWallet: 'New wallet',
    showArchived: 'Show archived',
    hideArchived: 'Hide archived',
    archived: 'Archived',
    invested: 'Invested',
    activity: 'Activity',
    owed: 'Owed',
    cash: 'Cash',
    creditCard: 'credit card',
    openedWith: 'Opened {{amount}}',
    emptyTitle: 'No wallets yet',
    emptyBody:
      'Create a cash or bank wallet to record spending, or an investment wallet to track stocks.',
    createWallet: 'Create a wallet',
    spendingGroup: 'Spending',
    spendingCaption: 'Income, expenses and transfers',
    spendingEmpty: 'No spending wallets yet.',
    investingGroup: 'Investing',
    investingCaption: 'Stock positions valued at cost',
    investingEmpty: 'No investment wallets yet — add one to start tracking positions.',
    deleted: 'Deleted "{{name}}".',
    deletedWithRecords: 'Deleted "{{name}}" and its records.',
  },

  activity: {
    /** The clock time a row was recorded, shown beneath its date. */
    recordedAt: 'Recorded at {{time}}',

    clear: 'Clear',
    dateRange: 'Date range',
    timeOfDay: 'Time of day',
    timeOfDayHint: 'Matches when a transaction was',
    walletAndType: 'Wallet & type',
    removeFilter: 'Remove filter: {{label}}',
    addTransaction: 'Add a transaction',
    filterTo: 'To',
    timeMorning: 'Morning',
    timeAfternoon: 'Afternoon',
    timeEvening: 'Evening',
    timeLateNight: 'Late night',
    noMatches: 'No matches',
    nothingRecorded: 'Nothing recorded here',
    createWalletFirst: 'Create a wallet first, then start adding transactions.',
    nothingInRange: 'Nothing was recorded in this range yet.',
    datePresetToday: 'Today',
    datePresetYesterday: 'Yesterday',
    datePresetLast7: 'Last 7 days',
    datePresetLast30: 'Last 30 days',
    datePresetCustom: 'Custom range',
    filterAtLeast: 'At least',
    filterAtMost: 'At most',
    filterFrom: 'From',
    filterNoLimit: 'No limit',
    filterSearchPlaceholder: 'Note or category…',
    filterAllCategories: 'All categories',
    filterAllTypes: 'All types',
    filterAllWallets: 'All wallets',
    header: 'Activity · {{range}}',
    totals: '{{income}} in · {{expense}} out · net {{net}}',
    rangeStart: 'the start',
    rangeToday: 'today',
    rangeSpan: '{{from}} → {{to}}',
    deleteConfirm: 'Delete this {{type}} of {{amount}}?',
    filteredOutTitle: 'Nothing matches',
    filteredOutBody:
      'All {{count}} transactions in this range were filtered out. Widen the range, or clear a filter above.',

    title: 'Activity',
    refresh: 'Refresh transactions',
    newTransaction: 'New transaction',
    categoryOrRoute: 'Category / Route',
    emptyTitle: 'Nothing here',
    emptyBody: 'No transactions match these filters.',
    transferRoute: '{{from}} → {{to}}',
  },

  cards: {
    overdueBadge: 'Overdue',
    dueSoonBadge: 'Due soon',
    cashbackBadge: '{{percent}} back',
    percentUsedShort: '{{percent}} used',
    limitShort: '{{amount}} limit',
    closesDue: 'closes / due',
    cycle: 'cycle',
    cycleNotSet: 'not set',
    title: 'Cards',
    debt: 'Debt',
    lede: 'Charges add to what you owe; paying a bill is a transfer from a cash wallet, so it never counts as spending twice.',
    refresh: 'Refresh cards',
    newCard: 'New card',
    emptyTitle: 'No credit cards yet',
    emptyBody:
      'Add one to track what you owe, when the statement closes, and what is still unbilled. Existing wallets are unaffected — they stay cash.',
    addCard: 'Add a card',

    totalOwed: 'Total owed',
    billed: '{{amount}} billed',
    acrossCards_one: 'across {{count}} card',
    acrossCards_other: 'across {{count}} cards',
    scheduledSuffix: ' · {{amount}} scheduled',
    availableCredit: 'Available credit',
    ofLimit: 'of {{amount}}',
    noLimits: 'No limits set',
    utilisation: 'Utilisation',
    utilisationHealthy: 'Under 30% — healthy',
    utilisationHigh: 'Over 30%',
    utilisationOver: 'Over the limit',

    statementBalance: 'Statement balance',
    unbilled: 'Unbilled',
    scheduled: 'Scheduled',
    scheduledHint: 'Installment chunks still to be billed',
    dueOn: 'Due {{date}}',
    daysLate_one: '{{count}} day late',
    daysLate_other: '{{count}} days late',
    dueToday: 'today',
    dueInDays_one: 'in {{count}} day',
    dueInDays_other: 'in {{count}} days',
    setCycleHint: 'Set a billing cycle to track this',
    billsOn: 'Bills {{date}}',
    sinceOpened: 'Since the account opened',
    percentOfUsed: '{{percent}} of {{amount}} used',
    noLimitSet: 'No limit set',
    noCycleWarning:
      'No billing cycle on this card yet. Add the statement and due days and it can tell you what has been billed and when it falls due.',

    payBill: 'Pay bill',
    newInstallment: 'New installment',
    nothingOwed: 'Nothing owed on this card',
    overdueTitle: 'Payment overdue',
    overdueBody: '{{names}} — due date has passed with a balance outstanding.',
    dueSoonTitle: 'Due within three days',
    dueSoonEntry: '{{name}} · {{amount}} on {{date}}',
    billPaid: 'Bill paid',
    billPaidBody: '{{amount}} paid to {{name}}.',
    planCreated: 'Installment plan created',
    planCreatedBody: '{{count}} monthly charges of about {{amount}} on {{name}}.',
    paymentFailed: 'Payment failed',
    planFailed: 'Could not create the plan',
  },

  recurring: {
    /* ---- Shared subscriptions ----
       A template that becomes a real bill on the day it is paid, which is why
       the wording is future tense throughout: nobody owes anything yet. */
    shareToggle: 'Create a shared bill when this is paid',
    shareHint: 'Each payment raises a bill on the Shared Expenses screen, so you can track who has paid you back. One expense, not two — the bill reuses the payment.',
    splitDetails: 'Who owes what',
    splitEvenly: 'Split evenly',
    addPerson: 'Add person',
    personName: 'Name',
    removePerson: 'Remove {{name}}',
    splitEmpty: 'Nobody added yet. The whole payment stays yours until you add someone.',
    splitSummary: 'Others owe {{owed}} · your share {{own}}',
    splitOverBy: 'The shares are {{amount}} more than the subscription. Lower one to continue.',
    splitDuplicate: '“{{name}}” is on this split twice.',

    /* Said after a payment, when a bill was raised alongside it. */
    sharedBillCreated: 'Shared bill raised · {{owed}} owed to you',
    sharedBillFailed: 'Paid, but the shared bill could not be created: {{reason}}',
    subscriptionCount_one: '{{count}} subscription · weekly and yearly bills normalised to a monthly figure',
    subscriptionCount_other: '{{count}} subscriptions · weekly and yearly bills normalised to a monthly figure',
    createWalletFirst: 'Create a wallet first — a subscription needs somewhere to deduct from.',
    emptyHint: 'Add rent, Netflix, insurance — anything on a cycle — and this tracks what is due next.',
    addFirst: 'Add the first one',
    bucketDueTitle: 'Action required',
    bucketDueBlurb: 'Due now or overdue',
    bucketSoonTitle: 'Upcoming',
    bucketSoonBlurb: 'Within 7 days — make sure the funds are there',
    bucketLaterTitle: 'Later',
    bucketLaterBlurb: 'Scheduled further out',
    freqWeekly: 'Weekly',
    freqMonthly: 'Monthly',
    freqYearly: 'Yearly',
    dueTodayFull: 'Due today',
    dueTomorrowFull: 'Due tomorrow',
    unknownWallet: 'Unknown wallet',
    nothingDue: 'Nothing due',
    dueIn_one: 'In {{count}} day',
    dueIn_other: 'In {{count}} days',
    overdueBy_one: 'Overdue by {{count}} day',
    overdueBy_other: 'Overdue by {{count}} days',
    dueTomorrow: 'Tomorrow',
    dueTodayLabel: 'Today',
    paidToast: '{{name}} · {{amount}} recorded',
    deleteConfirm: 'Delete the "{{name}}" subscription? Past payments are kept.',
    dueSummary: '{{count}} due · {{amount}}',

    title: 'Recurring',
    subscriptions: 'Subscriptions',
    refresh: 'Refresh subscriptions',
    newSubscription: 'New subscription',
    committedMonthly: 'Committed each month',
    emptyTitle: 'No subscriptions yet',
    emptyBody: 'Add the bills that repeat, and confirm each one when it is paid.',
    addSubscription: 'Add a subscription',
    dueOn: 'Due {{date}}',
    markPaid: 'Confirm payment',
    overdue: 'Overdue',
  },

  budgets: {
    lede: 'Percentage budgets track a share of your income; fixed budgets track a flat amount.',
    budgetedThisMonth: 'Budgeted this month',
    spentBadge: '{{amount}} spent',
    ofIncomeAllocated: 'of income allocated',
    unallocatedShare: '{{percent}} unallocated',
    baseIncome: 'Base income',
    fromSettings: 'From Settings',
    fromRecordedIncome: 'From recorded income',
    budgetLines: 'Budget lines',
    overLimitCount: '{{count}} over limit',
    remaining: 'Remaining',
    acrossAll: 'Across all budgets',
    saveFailed: 'Could not save the budget',
    copyFailed: 'Copy failed',
    percentOfIncome: '{{percent}}% of income',
    fixedBadge: 'fixed',
    overBadge: 'over',
    emptyBodyFull:
      'Try a 40 / 10 / 20 split — Invest 40%, Save 10%, Needs 20% — or set flat amounts per category.',
    createBudget: 'Create a budget',
    noteSuffix: ' · {{note}}',
    amountOver: '{{amount}} over',
    amountLeft: '{{amount}} left',
    deleteConfirm: 'Delete the "{{label}}" budget?',
    copied: 'Copied {{count}} budget(s){{skipped}}.',
    copiedSkipped: ', skipped {{count}} already set',
    planUsed: '{{percent}} of plan used',
    nothingPlanned: 'Nothing planned yet',
    savingEllipsis: 'Saving…',
    percentUsed: '{{percent}} used',
    baseSuffix: ' · base {{amount}}',
    emptyThisMonth: 'No budgets for this month',

    title: 'Budgets',
    refresh: 'Refresh budgets',
    newBudget: 'New budget',
    emptyTitle: 'No budgets for {{period}}',
    emptyBody: 'Set a limit per category, per wallet, or across everything.',
    copyPrevious: 'Copy last month',
    allocated: 'Allocated',
    unallocated: 'Unallocated',
    spentOfLimit: '{{spent}} of {{limit}}',
  },

  forms: {
    /* ---- The wallet icon picker ----
       One stored field, two sources: an emoji, or a Thai bank logo saved as
       `bank:SYMBOL`. */
    iconSource: 'Icon source',
    iconStandard: 'Standard icons',
    iconBanks: 'Thai banks',
    iconHint: 'Pick an emoji, or the logo of the bank this wallet is with.',
    installmentNotePlaceholder: 'iPhone 17 Pro',
    // ---- Wallet ----
    walletModeLabel: 'Wallet mode',
    walletModeExpense: '💳 Expense / Income',
    walletModeInvestment: '📈 Investment',
    walletModeExpenseHint: 'Tracks income, expenses and transfers.',
    walletModeInvestmentHint:
      'Holds stock positions with live P&L. Fund it with a transfer from a cash wallet.',
    walletModeLocked: 'Mode can only change while the wallet has no records.',
    newWallet: 'New wallet',
    editWallet: 'Edit {{name}}',
    createWallet: 'Create wallet',
    walletNameRequired: 'Give the wallet a name',
    walletNamePlaceholderExpense: 'Everyday spending',
    walletNamePlaceholderInvestment: 'Brokerage',
    kindCash: 'Cash',
    kindBank: 'Bank account',
    kindEwallet: 'E-wallet',
    kindCredit: 'Credit card',
    kindBrokerage: 'Brokerage',
    kindOther: 'Other',
    creditKindHint: 'Charges add to what you owe; a transfer in pays it off.',
    openingBalance: 'Opening balance',
    openingBalanceHint: "What's in it right now.",
    balanceOwed: 'Balance already owed',
    balanceOwedHint: 'What the card owes today, as a positive number.',
    icon: 'Icon',
    iconNamed: 'Icon {{icon}}',
    colour: 'Colour',
    colourNamed: 'Colour {{colour}}',

    billingCycle: 'Billing cycle',
    billingCycleHint:
      'Optional, but without both days the card cannot tell a statement balance from an unbilled one, and nothing can fall due.',
    creditLimit: 'Credit limit',
    creditLimitHint: "Leave empty if you'd rather not track utilisation.",
    cashbackRate: 'Cashback rate',
    cashbackRateHint: 'Percent. 1.5 means 1.5% back.',
    statementCloses: 'Statement closes',
    statementClosesHint: 'Day of month the bill is cut.',
    paymentDue: 'Payment due',
    paymentDueHint: 'Day of month it has to be paid.',
    limitLooksSwapped:
      'That balance is more than ten times the limit — check the two fields are the right way round.',

    // ---- Transaction ----
    newTransaction: 'New transaction',
    editTransaction: 'Edit transaction',
    transactionType: 'Transaction type',
    typeExpense: 'Expense',
    typeIncome: 'Income',
    typeTransfer: 'Transfer',
    fromWallet: 'Wallet',
    toWallet: 'To wallet',
    selectPlaceholder: 'Select…',
    noEligibleWallet: 'No eligible wallet',
    amountIn: 'Amount ({{currency}})',
    approxAmount: '≈ {{amount}}',
    pickWallet: 'Pick a wallet',
    pickDestination: 'Pick a destination wallet',
    pickCategory: 'Pick a category',
    amountPositive: 'Amount must be greater than zero',

    // ---- Pay bill ----
    payCard: 'Pay {{name}}',
    payAmount: 'Pay {{amount}}',
    nowhereToPayFrom: 'Nowhere to pay from',
    nowhereToPayFromBody:
      'Every wallet you have is a credit card. Add a cash or bank wallet first — a card bill has to be settled from real money.',
    noDueDateSet: 'No due date set',
    noStatementDaySet: 'No statement day set',
    unbilledSince: 'Unbilled since',
    howMuch: 'How much',
    paymentAmount: 'Payment amount',
    presetStatement: 'Statement · {{amount}}',
    presetFull: 'Full · {{amount}}',
    presetCustom: 'Custom',
    stillOwed: '{{amount}} would still be owed',
    endsInCredit: '{{amount}} more than the balance — the card ends in credit',
    clearsExactly: 'Clears the balance exactly',
    payFrom: 'Pay from',
    onlyHolds: '{{name}} only holds {{amount}}',
    walletOption: '{{icon}} {{name}} — {{amount}}',
    billPaymentNote: '{{name}} bill payment',
    transferNotice:
      'Recorded as a transfer, so it moves the balance without counting as spending — the charges were already the expense.',
    chooseSourceWallet: 'Choose a wallet to pay from',
    amountGreaterThanZero: 'Enter an amount greater than zero',

    // ---- Installments ----
    installmentTitle: '0% installment plan',
    installmentIntro:
      'Charged to <1>{{name}}</1>. Written as {{count}} dated expenses, so each month is billed one chunk while the card shows the whole amount you still owe.',
    createCharges_one: 'Create {{count}} charge',
    createCharges_other: 'Create {{count}} charges',
    purchasePrice: 'Purchase price',
    purchasePriceHint: 'The full price, not the monthly figure.',
    firstCharge: 'First charge',
    term: 'Term',
    termMonths: '{{count}}m',
    termOther: 'Other',
    numberOfMonths: 'Number of months',
    months: 'Months',
    monthsHint: '1 to {{max}}.',
    categoryFiledUnder: 'Every chunk is filed under this.',
    whatIsIt: 'What is it',
    whatIsItHint: 'Shown on every chunk.',
    perMonth: 'Per month',
    firstChunkNote: 'First {{amount}} — rounding rides on it',
    evenSplit: 'Even split',
    hitsThisMonth: "All that hits this month's spending",
    cardBalance: 'Card balance',
    owedFromToday: 'Owed to the bank from today',
    moreThrough: '{{count}} more, through {{date}}',
    overLimitTitle: 'Over the limit',
    overLimitBody:
      'This is more than the {{amount}} available on {{name}}. Banks often approve a plan anyway — recording it here is fine either way.',
    enterPurchasePrice: 'Enter the full purchase price',
    chooseTerm: 'Choose between 1 and {{max}} months',
    pickInstallmentCategory: 'Pick a category — each chunk is an ordinary expense and needs one',
  },

  theme: {
    /* The one theme failure that is not the user's doing: the palette ships in
       the app before the Apps Script that validates its name does. */
    unknownTheme: 'This theme needs the updated backend',
    unknownThemeHint:
      'Your Apps Script has an older list of theme names, so it rejected this one and the previous theme was put back. Open the Apps Script editor, paste in the current google-apps-script/Code.gs, and deploy it — then this theme will stick.',
    /* ---- The picker's names and one-liners ----
       Kept as keys rather than literals in `themes.ts`: choosing a theme is
       choosing a feeling, and the blurb is what carries it. */

    nameLight: 'Light',
    nameDark: 'Dark',
    nameOcean: 'Ocean',
    nameForest: 'Forest',
    nameSunset: 'Sunset',
    nameCyberpunk: 'Cyberpunk',
    nameRosegold: 'Rose Gold',
    nameMidnight: 'Midnight',
    nameDracula: 'Dracula',
    nameNord: 'Nord',
    nameSolarized: 'Solarized',
    nameAmethyst: 'Amethyst',
    nameMatcha: 'Matcha',
    nameOatmilk: 'Oatmilk',
    nameSakura: 'Sakura',
    nameLavender: 'Lavender',
    nameDaylight: 'Daylight',
    nameCocoa: 'Cocoa',
    nameMoonlight: 'Moonlight',
    namePine: 'Pine',
    nameSlate: 'Slate',
    nameTwilight: 'Twilight',
    nameCustom: 'Custom base',

    blurbLight: 'The default paper palette',
    blurbDark: 'Cool graphite and blue',
    blurbOcean: 'Deep water, cold cyan',
    blurbForest: 'Pine and moss',
    blurbSunset: 'Dusk over warm plum',
    blurbCyberpunk: 'Neon magenta on near-black',
    blurbRosegold: 'Light, warm blush and copper',
    blurbMidnight: 'The quietest dark in the set',
    blurbDracula: 'The classic developer palette',
    blurbNord: 'Polar night and frost',
    blurbSolarized: 'Light, on warm paper',
    blurbAmethyst: 'Violet, the richest dark here',
    blurbMatcha: 'Creamy paper, sage and dark olive',
    blurbOatmilk: 'Warm beige, soft brown, espresso',
    blurbSakura: 'Blush petals and deep maroon',
    blurbLavender: 'Pale lilac and deep plum',
    blurbDaylight: 'Crisp white, airy blue, navy',
    blurbCocoa: 'Dark chocolate and warm cream',
    blurbMoonlight: 'Soft navy, muted cyan, icy white',
    blurbPine: 'Charcoal green and soft mint',
    blurbSlate: 'Matte grey-blue and silver',
    blurbTwilight: 'Muted purple and soft lilac',
    blurbCustom: 'Midnight teal — the blank canvas',

    schemeLight: 'Light',
    schemeDark: 'Dark',
    themeGroup: 'Theme',
    typefaceGroup: 'Typeface',
    newTheme: 'New theme',
    makeFirstTheme: 'Make your first theme',
    makeFirstThemeBody: "Start from the palette you're wearing and change what you like.",
    matchTheme: 'Match theme',
    livePreview: 'Live preview',
    palette: 'Palette',
    typography: 'Typography',
    editingSaved: 'Editing a saved theme',
    editNamed: 'Edit {{name}}',
    duplicateNamed: 'Duplicate {{name}}',
    confirmDeleting: 'Confirm deleting {{name}}',
    deleteNamed: 'Delete {{name}}',
    accentNamed: 'Accent {{colour}}',
    librarySubtitle: 'Your saved palettes and the built-in ones. Everything here is plain CSS variables.',
    accentHint: "Applied on top of whichever theme is active. Picking a theme resets it to that theme's own accent.",
    editorSubtitle: 'Every change shows instantly across the whole app. Nothing reaches the sheet until you save.',
    themeNameHint: "What you'll see in the library — e.g. Cyberpunk, Forest, Monday morning.",
    library: 'Theme library',
    previewing: 'Previewing {{name}}',
    yourNewTheme: 'your new theme',
    unsavedHint: 'Nothing is saved yet — look around the app, then save or discard.',
    adjustHint: 'Adjust the colours below. Changes stay on this device until you save.',
    discard: 'Discard',
    saveTheme: 'Save theme',
    useTheme: 'Use {{name}}',
    editingNow: 'Editing now',
    inUse: 'In use',
    savedTheme: 'Saved theme',
    duplicate: 'Duplicate',
    clickAgainToDelete: 'Click again to delete',
    editTheme: 'Edit theme',
    createTheme: 'Create theme',
    themeName: 'Theme name',
    untitledTheme: 'Untitled theme',
    accentColour: 'Accent colour',
    customAccentColour: 'Custom accent colour',
    revertChanges: 'Revert changes',
    resetToDefault: 'Reset to default',
  },

  split: {
    // ---- Chip-based creation flow ----
    amountPlaceholder: '0',
    titlePlaceholder: 'What was it?',
    whoSharing: 'Who is sharing this?',
    me: 'Me',
    addNamePlaceholder: 'Add a name',
    addName: 'Add',
    removeChip: 'Remove {{name}}',
    meIncluded: 'You are in the split — tap to take yourself out',
    meExcluded: 'You are not in the split — tap to join',
    perPerson: '{{amount}} / person',
    addDetails: 'Add details',
    hideDetails: 'Hide details',
    remaining: 'Remaining {{amount}}',
    overBy: 'Over by {{amount}}',
    allAssigned: 'All assigned',
    unassigned: '{{amount}} unassigned',
    yourShareIs: 'Your share {{amount}}',
    tapAmount: 'Amount for {{name}}',
    nobodyYet: 'Nobody yet — add the people sharing this bill.',
    owedLabel: 'They owe',
    youCoverLabel: 'You cover',
    leavesNowLabel: 'Leaves now',
    // ---- Page chrome ----
    title: 'Shared expenses',
    navLabel: 'Shared',
    lede: 'Paid for the group? Record the whole bill, then collect each share back into the same wallet.',
    refresh: 'Refresh shared expenses',
    newBill: 'Split a bill',
    emptyTitle: 'Nothing split yet',
    emptyBody:
      'Paid for a dinner or a group shop? Record the bill once, list who owes what, and mark each person off as they pay you back.',
    splitFirstBill: 'Split your first bill',

    // ---- Roll-up ----
    owedToYou: 'Owed to you',
    peopleOwing_one: '{{count}} person still owes you',
    peopleOwing_other: '{{count}} people still owe you',
    nobodyOwes: 'Everyone has settled up',
    recoveredTotal: 'Recovered',
    openBills_one: '{{count}} open bill',
    openBills_other: '{{count}} open bills',
    settledBills: 'Settled',
    showSettled: 'Show settled',
    hideSettled: 'Hide settled',

    // ---- A bill card ----
    statusOpen: 'Open',
    statusSettled: 'Settled',
    billTotal: 'Total {{amount}}',
    yourShare: 'Your share {{amount}}',
    paidFrom: 'Paid from {{wallet}}',
    recoveredOf: '{{recovered}} of {{owed}} back',
    outstandingAmount: '{{amount}} still out',
    owesAmount: 'Owes {{amount}}',
    markPaid: 'Mark as paid',
    markPaidFor: 'Mark {{name}} as paid',
    paid: 'Paid',
    undo: 'Undo',
    undoFor: 'Undo {{name}} — removes the income it recorded',
    deleteBill: 'Delete bill',
    deleteConfirm:
      'Delete "{{title}}"? The expense and every repayment it recorded are removed from your ledger too.',
    deleted: 'Deleted "{{title}}".',
    paidToast: '{{name}} paid {{amount}} back to {{wallet}}.',
    paidToastTitle: 'Repayment recorded',
    alreadyPaid: '{{name}} was already marked paid.',
    recordFailed: 'Could not record the payment',

    // ---- The form ----
    formTitle: 'Split a bill',
    formEditTitle: 'Edit {{title}}',
    billName: 'What was it',
    billNameHint: 'What you would call it later — "Dinner at Shabu", "Big C run".',
    billNamePlaceholder: 'Dinner at Shabu',
    totalPrice: 'Total price',
    totalPriceHint: 'The whole bill, including your own share.',
    payFromWallet: 'Paid from',
    payFromWalletHint: 'The full amount comes out of here now, and each repayment goes back in.',
    noteHint: 'Optional. Shown on the bill and on the expense row.',

    // ---- The split engine ----
    whoOwes: 'Who owes a share',
    splitMode: 'How to split',
    modeEqual: 'Split equally',
    modeCustom: 'Custom amounts',
    includeSelf: 'Count me in the split',
    includeSelfHint:
      'On, {{total}} divides between you and {{count}} others. Off, the whole bill is theirs.',
    addPerson: 'Add a person',
    personName: 'Name',
    personNamePlaceholder: 'Nick',
    shareAmount: 'Owes',
    removePerson: 'Remove {{name}}',
    removeRow: 'Remove this person',
    eachOwes: 'Each owes {{amount}}',
    noPeopleYet: 'Add the people who owe you a share.',

    // ---- Live validation ----
    theyOwe: 'They owe {{amount}}',
    youCover: 'You cover {{amount}}',
    exceedsTotal: 'The shares are {{amount}} over the bill.',
    exceedsTotalHint: 'Lower a share, or raise the total price.',
    duplicateName: '"{{name}}" is on this bill twice.',
    needAmount_one: '{{count}} person has no amount yet.',
    needAmount_other: '{{count}} people have no amount yet.',
    needName: 'Every person needs a name.',
    needTotal: 'Enter the total price first.',
    needWallet: 'Choose the wallet that paid.',
    needPeople: 'Add at least one person.',
    createBill: 'Record bill',
    creating: 'Recording…',
    createdToast: '{{amount}} recorded, {{owed}} owed back.',
    createdToastTitle: 'Bill split',

    // ---- The explanation that stops the support question ----
    ledgerExplainer:
      'The full {{total}} is recorded as an expense now, because until someone pays you back you really are down that much. Each repayment comes back as income to the same wallet, so once everyone has settled you are out only your own share.',
  },

  settings: {
    liveQuotesOn: ' · live quotes enabled',
    liveQuotesOff: ' · no API key, prices are simulated',
    envHint: 'Set <1>{{provider}}</1> and <3>{{key}}</3> in <5>{{file}}</5>, then restart the dev server.',
    quotesCurrencyWarning:
      "Quotes come back in the market's own currency (USD for US tickers) and are compared directly against your stored cost basis. For accurate P&L, keep the currency above as USD and use the display conversion below to read totals in {{currency}}.",
    anotherCurrency: 'another currency',
    rateFetched: '1 {{from}} = {{rate}} {{to}}{{asOf}}. Press Save to keep it.',
    rateAsOf: ' (as of {{date}})',
    rateAboveZero: 'Enter an exchange rate above zero, or fetch one.',
    amountsNowIn: 'Amounts now display in {{currency}}.',
    conversionOff: 'Conversion turned off.',
    rateLookupFailed: 'Rate lookup failed',
    passwordUpdated: 'Password updated.',
    passwordChangeFailed: 'Could not change password',
    keepEverythingIn: 'Leave blank to keep everything in {{currency}}.',
    noConversion: '{{currency}} (no conversion)',
    rateLabel: 'Rate: 1 {{from}} = ? {{to}}',
    booksAreIn: 'Your books are in {{currency}}',
    providerLabel: 'Provider:',
    providerConfigured: 'Set',
    workbookLocked: 'database.xlsx is open elsewhere',
    workbookSaveFailed: 'Could not save the workbook',
    title: 'Settings',
    preferences: 'Preferences',
    language: 'Language',
    languageHint: 'Changes the interface language, and the locale used to format dates and amounts.',
    currency: 'Currency',
    currencyHint: 'What amounts are stored in. ISO code, e.g. USD, THB, EUR.',
    locale: 'Locale',
    localeHint: 'Controls number and date formatting.',
    monthlyIncome: 'Monthly income',
    monthlyIncomeHint:
      'Base for percentage budgets. Leave blank to use the income you actually record each month.',
    savePreferences: 'Save preferences',

    conversionTitle: 'Display in another currency',
    conversionSubtitle:
      'Convert every amount on screen — e.g. keep books in USD but read them in Thai baht. Stored values never change, so you can switch back any time.',
    showAmountsIn: 'Show amounts in',
    rateHint: "Type it yourself, or fetch today's rate.",
    fetchRate: "Fetch today's rate",
    saveConversion: 'Save conversion',
    preview: 'Preview',

    quotesTitle: 'Stock quotes',
    provider: 'Provider:',
    providerSet: 'Set',

    workbookTitle: 'Workbook',
    refreshWorkbook: 'Refresh settings and workbook status',
    file: 'File',
    lastSaved: 'Last saved',
    fileLocked: 'File is locked',
    queuedWrites: 'Unsaved changes are queued — they write automatically.',
    allWritten: 'All changes are written to disk.',
    saveWorkbook: 'Save workbook now',
    checkingBackend: 'Checking the backend…',

    account: 'Account',
    signedInAs: 'Signed in as {{name}} (@{{username}})',
    currentPassword: 'Current password',
    newPassword: 'New password',
    passwordHint: 'At least 4 characters.',
    changePassword: 'Change password',
  },

  analytics: {
    title: 'Analytics',
    subtitle: 'The patterns behind the numbers',
    /* The two widgets that moved off the Overview screen. */
    flowTitle: 'Where the money moved',
    projectionTitle: 'Where this is heading',
    projectionSubtitle: "Projected net worth if today's savings rate holds",

    savingsRateTitle: 'Savings rate',
    savingsRateSubtitle: 'Share of income kept, month by month',
    savingsRateAverage: '{{value}} average over {{count}} months',
    savingsRateNegative: 'Months below zero are months you spent more than you earned.',

    heatmapTitle: 'Spending by day',
    heatmapSubtitle: 'Which days of the month cost the most',
    heatmapLegendLess: 'Less',
    heatmapLegendMore: 'More',
    heatmapNoSpend: 'No spending',
    heatmapDayTotal: '{{date}} · {{amount}}',

    categoriesTitle: 'Category breakdown',
    categoriesSubtitle: 'Where it goes, by size',
    categoriesOther: 'Other',

    merchantsTitle: 'Top payees',
    merchantsSubtitle: 'Where the money goes most often',
    merchantsColumnPayee: 'Payee',
    merchantsColumnCount: 'Times',
    merchantsColumnTotal: 'Total',
    merchantsColumnAverage: 'Average',
    merchantsUnlabelled: 'No note',

    empty: 'Nothing to analyse yet',
    emptyHint: 'Record a few transactions and the patterns show up here.',
    /* Shown on the cards that are still being built. */
    comingSoon: 'Coming next',
  },

  goals: {
    title: 'Goals',
    subtitle: 'Set money aside without moving it',

    /* The three figures at the top of the page. The distinction between them is
       the entire concept, so each carries its own explanation. */
    totalCash: 'Total cash',
    totalCashHint: 'Everything in your spendable wallets',
    lockedInGoals: 'Locked in goals',
    lockedInGoalsHint: 'Earmarked, but still sitting in your wallets',
    availableToSpend: 'Available to spend',
    availableToSpendHint: 'Cash you have not promised to anything yet',
    overCommitted: 'You have earmarked more than you hold',
    overCommittedHint:
      'Your goals add up to more than your spendable cash. Nothing is wrong with your balances — the envelopes are just ahead of them.',

    /* A goal card. */
    saved: '{{saved}} of {{target}}',
    remaining: '{{amount}} to go',
    complete: 'Funded',
    completeHint: 'This goal has reached its target.',
    deadline: 'By {{date}}',
    noDeadline: 'No deadline',
    overdue: 'Past its date',
    perMonth: '{{amount}} a month to make it',
    perMonthPast: 'The date has passed',

    /* Funding. */
    fund: 'Add money',
    fundTitle: 'Add to {{title}}',
    fundAmount: 'Amount to add',
    fundHint: 'This moves nothing. It only marks money you already have as spoken for.',
    fundConfirm: 'Add to goal',
    withdraw: 'Take out',
    withdrawTitle: 'Take money out of {{title}}',
    withdrawAmount: 'Amount to take out',
    withdrawHint: 'Releases the earmark. Your wallet balances do not change.',
    withdrawConfirm: 'Take out',
    withdrawAll: 'Take out everything',
    fundedToast: '{{amount}} set aside for {{title}}',
    withdrewToast: '{{amount}} released from {{title}}',

    /* ---- Buying the thing ----
       The one goals flow that spends real money: it writes an expense against
       a wallet and closes the goal, in one call. */
    buyNow: 'Complete & Buy',
    purchaseTitle: 'Buy {{title}}',
    purchasePrice: 'Price',
    purchaseFrom: 'Which wallet will you use to pay for this?',
    purchaseFromHint: 'The money leaves this wallet and appears as an expense.',
    purchaseDate: 'Purchase date',
    purchaseConfirm: 'Pay {{amount}}',
    purchaseAfter: '{{wallet}} will hold {{amount}} afterwards',
    purchaseShortfall: '{{amount}} of this is more than the goal saved up — it comes out of the wallet too.',
    purchaseOverdraw: 'This is more than {{wallet}} holds ({{balance}}).',
    purchaseEffect: 'This records a real expense and closes the goal. It cannot be undone by editing the goal — delete the expense instead.',
    purchaseNoWallet: 'Add a spending wallet first — a purchase has to come out of one.',
    purchaseDone: '{{title}} bought for {{amount}}',

    /* ---- Bought ---- */
    purchased: 'Purchased',
    purchasedOn: 'Purchased {{date}}',
    purchasedHint: 'Bought and paid for.',
    paidAmount: 'Paid {{amount}}',

    /* The form. */
    newGoal: 'New goal',
    editGoal: 'Edit {{title}}',
    fieldTitle: 'What are you saving for?',
    fieldTitlePlaceholder: 'Japan trip',
    fieldTarget: 'Target amount',
    fieldDeadline: 'Target date',
    fieldDeadlineHint: 'Optional. Used to work out what you need to put aside each month.',
    fieldColor: 'Colour',
    fieldNote: 'Note',
    fieldNotePlaceholder: 'Flights, hotel and spending money',
    addGoal: 'Add goal',
    deleteConfirm: 'Delete the goal “{{title}}”? The money it holds was never moved, so nothing else changes.',

    empty: 'No goals yet',
    emptyHint:
      'A goal earmarks money you already have — a new laptop, a trip, a rainy day. Nothing leaves your wallets.',
  },

  receipt: {
    /* Slip / receipt scanning inside the transaction form. */
    scan: 'Scan a receipt',
    scanHint: 'Drop an image here, or choose a file',
    scanning: 'Reading the receipt…',
    scanningHint: 'This takes a moment',
    dropHere: 'Drop to scan',
    chooseFile: 'Choose a file',
    remove: 'Remove',
    retry: 'Try another image',
    filled: 'Filled in from the receipt — check it before saving',
    /* Named individually so the user can see exactly what the scan claimed. */
    foundAmount: 'Amount',
    foundDate: 'Date',
    foundNote: 'Merchant',
    nothingFound: 'Could not read that one',
    nothingFoundHint: 'Nothing was filled in. Type the details, or try a clearer photo.',
    failed: 'The scan failed',
    tooLarge: 'That image is larger than {{limit}}',
    wrongType: 'That is not an image file',
    /* Stated plainly while the feature is a stub. */
    /* Progress, per phase. The bar is remapped to be monotonic; these name
       what it is actually doing. */
    stagePreparing: 'Starting the reader…',
    stageLoading: 'Loading Thai and English models…',
    stageReading: 'Reading the receipt…',
    firstRunHint: 'The language models download once, then stay cached.',
    onDevice: 'Read on your device — the image is never uploaded',
    rawText: 'What it read',
    useAnyway: 'Use this text as the note',
  },

  /**
   * The app directory.
   *
   * Only the descriptions live here. Every card's *title* is the same
   * `nav.<route>` string the sidebar, the tab bar and the topbar already use —
   * a screen called "Activity" in one place and "Transactions" in another is
   * two names for one thing, and the reader has to work out they are the same.
   */
  more: {
    title: 'All features',
    lede: 'Every screen in Quick Wallet, grouped by what you came to do.',

    sectionCore: 'Core Finance',
    sectionCoreHint: 'Money in, money out, and where it sits right now',
    sectionTracking: 'Advanced Tracking',
    sectionTrackingHint: 'The longer view — holdings, patterns and shared costs',
    sectionPlanning: 'Planning & Goals',
    sectionPlanningHint: 'Money you have promised to future you',
    sectionApp: 'App',
    sectionAppHint: 'Preferences, currency and language',

    /* One line each, keyed by route. Says what the screen is *for*, not what it
       is called — the title above it already says that. */
    dashboard: 'Balances, spending and this month at a glance',
    wallets: 'Accounts, cash and balances you keep track of',
    transactions: 'Every entry, searchable and filterable by date',
    cards: 'Statements, due dates and installment plans',
    investments: 'Holdings, average cost and your watchlist',
    analytics: 'Savings rate, spending habits and where it all goes',
    deepAnalytics: 'Build your own charts from the raw data, with filters',
    splits: 'Costs shared with other people, and who still owes',
    subscriptions: 'Recurring bills and what falls due next',
    debt: 'Loans and borrowed money, and what they cost you',
    goals: 'What you are saving towards, and how far along',
    budgets: 'Monthly limits per category, and how much is left',
    settings: 'Currency, language, theme and your workbook',
  },

  /**
   * The liability heatmap — committed outgoings, day by day.
   *
   * Its own section rather than living under `analytics`, because the widget
   * appears on two screens and belongs to neither.
   */
  /**
   * Debt management.
   *
   * Financial terms are used precisely and consistently: `principal` is what
   * was borrowed, `outstanding balance` is what is still owed, `APR` is the
   * annual rate. Loose synonyms ("total", "amount left") are avoided on
   * purpose — someone reading a loan statement alongside this screen has to be
   * able to line the two up word for word.
   */
  debt: {
    title: 'Debt',
    heading: 'Debt management',
    lede: 'Loans and borrowed money. Paying one records a real expense and moves the money out of a wallet.',

    /* ---- Terms ---- */
    principal: 'Principal',
    outstanding: 'Outstanding balance',
    apr: 'APR',
    aprValue: '{{rate}}% APR',
    minimumPayment: 'Minimum payment',
    dueDay: 'Payment due',
    dueDayValue: 'Day {{day}} of the month',
    dueDayNone: 'No due day set',
    paidOff: 'Principal repaid',
    monthlyInterest: 'Interest per month',
    settled: 'Settled',

    /* ---- Portfolio summary ---- */
    totalOutstanding: 'Total outstanding',
    totalCommitment: 'Minimum payments',
    totalCommitmentHint_one: 'Due across {{count}} active debt every month',
    totalCommitmentHint_other: 'Due across {{count}} active debts every month',
    portfolioInterest: 'Interest cost per month',
    portfolioProgress: '{{paid}} of {{principal}} repaid',
    costliest: 'Costliest debt',

    /* ---- Payoff projection ---- */
    payoffIn_one: 'Clear in {{count}} month at the minimum',
    payoffIn_other: 'Clear in {{count}} months at the minimum',
    payoffInterest: 'Interest to come: {{amount}}',
    payoffUnknown: 'Set a minimum payment to project a payoff date',
    /* The one warning on this screen that is not decorative. */
    neverAmortises: 'This never clears',
    neverAmortisesHint:
      'The minimum payment is less than the {{amount}} of interest charged each month, so the balance grows.',
    neverAmortisesCount_one: '{{count}} debt is growing rather than shrinking',
    neverAmortisesCount_other: '{{count}} debts are growing rather than shrinking',

    /* ---- Actions ---- */
    addDebt: 'Add a debt',
    newDebt: 'New debt',
    editDebt: 'Edit debt',
    payDebt: 'Make a payment',
    payTitle: 'Pay {{title}}',
    refresh: 'Refresh debts',
    deleteConfirm:
      'Delete "{{title}}"? The payments already recorded stay in your ledger — only the debt is removed.',

    /* ---- The payment modal ---- */
    payAmount: 'Payment amount',
    payFrom: 'Pay from',
    payFromHint: 'The money leaves this wallet as an expense.',
    payDate: 'Payment date',
    payCategory: 'Category',
    payNote: 'Note',
    payConfirm: 'Confirm payment',
    payMinimum: 'Minimum ({{amount}})',
    payFull: 'Pay off in full ({{amount}})',
    /* Shown live as the user types, so the trade-off is visible before they
       commit rather than explained afterwards. */
    paySplit: '{{interest}} covers this month’s interest · {{principal}} comes off the balance',
    paySplitShortfall:
      'This is less than the {{amount}} of interest due this month, so the balance will not fall.',
    payOverdraw: '{{wallet}} holds {{balance}}. This payment takes it below zero.',
    payOverpay: 'This is {{amount}} more than the outstanding balance. The extra is still recorded as spent.',
    payAfter: 'Balance after this payment: {{amount}}',
    payNoWallet: 'Add a spending wallet before recording a payment.',
    paid: 'Payment recorded',

    /* ---- The form ---- */
    formTitle: 'Debt name',
    formTitlePlaceholder: 'Car loan, mortgage, money from Dad',
    formPrincipal: 'Original amount borrowed',
    formPrincipalHint: 'What the loan started at. Progress is measured against this.',
    formBalance: 'Outstanding balance',
    formBalanceHint: 'Leave blank to start at the full principal.',
    formApr: 'Interest rate (APR %)',
    formAprHint: 'Annual rate as your lender quotes it. 0 if interest-free.',
    formMinimum: 'Minimum monthly payment',
    formDueDay: 'Payment due on day',
    formNote: 'Note',
    formBalanceOverPrincipal: 'The balance cannot be more than the principal.',

    /* ---- Empty & disclaimer ---- */
    emptyTitle: 'No debts recorded',
    emptyHint:
      'Add a loan, a mortgage, or money you owe someone. Payments come out of a wallet, so your balances stay honest.',
    createWalletFirst: 'Create a spending wallet first — a payment has to come from somewhere.',
    estimateNote:
      'Interest figures are estimates from the APR you entered. Nothing here accrues interest automatically — your lender’s statement is the authority.',
  },

  /**
   * The category distribution chart.
   *
   * Statistical vocabulary is used plainly rather than avoided: "median" and
   * "outlier" are the words for these things, and a reader who does not know
   * them is not helped by a vaguer synonym. The tooltip spells out what each
   * one means in figures, which is where the explaining belongs.
   */
  /** Rearranging the phone's two navigation surfaces. */
  mobileNav: {
    title: 'Mobile navigation',
    subtitle: 'Choose which screens the phone’s bottom bar and gesture menu carry',

    barTitle: 'Bottom bar',
    barHint: 'Four slots, always visible. Best for the screens you open to read something.',
    centreNote: 'The centre button is fixed — press and hold it for the gesture menu below.',

    arcTitle: 'Gesture menu',
    arcHint: 'Up to {{max}} shortcuts, fanned out around the centre button. The last one sits nearest your thumb.',
    moreNote: 'A route to More always stays available, so every screen can be reached from a phone.',

    slotLabel: 'Slot {{index}}',
    moveUp: 'Move {{name}} earlier',
    moveDown: 'Move {{name}} later',
    removeSlot: 'Remove {{name}}',
    addSlot: 'Add a shortcut',
    reset: 'Reset to default',
  },

  /** Salary dates, which anchor the liability heatmap. */
  payday: {
    title: 'Paydays',
    subtitle: 'When your income arrives, so the heatmap can show what falls due before it',
    dayLabel: 'Day {{day}}',
    none: 'No paydays set yet.',
    add: 'Add a payday',
    remove: 'Remove day {{day}}',
    hint: 'Add every date you get paid. Day 29–31 is fine — in a shorter month no marker is drawn.',
    limit: 'That is the maximum of {{max}} paydays.',
  },

  /**
   * The expense donut.
   *
   * Its own section rather than under `analytics`, because the component takes
   * a transaction list and a label and belongs to no particular screen.
   */
  pie: {
    title: 'Expense breakdown',
    subtitle: 'What share of spending each category takes',
    empty: 'Nothing spent in this range',
    emptyHint: 'Expenses appear here as soon as one is recorded.',
    ariaLabel: 'Donut chart of {{amount}} spending across {{count}} categories',
    rangeMonth: 'This month',
    rangeYear: 'Last 12 months',
    loadYear: 'Load 1-year data',
    backToMonth: 'Back to this month',
  },

  boxplot: {
    title: 'Spending distribution',
    subtitle: 'How individual purchases spread out within each category',

    /* The range loader. Default is this month — a year of rows is thousands of
       circles, and nobody wants that rendered before they asked for it. */
    rangeMonth: 'This month',
    rangeYear: 'Last 12 months',
    loadYear: 'Load 1-year data',
    loadingYear: 'Loading a year…',
    backToMonth: 'Back to this month',

    median: 'Median',
    iqrRange: 'Middle half {{from}}–{{to}}',
    rangeSummary: 'Range {{from}}–{{to}}',
    outlier: 'Unusually large for this category',
    outlierCount_one: '{{count}} outlier',
    outlierCount_other: '{{count}} outliers',
    pointCount_one: '{{count}} tx',
    pointCount_other: '{{count}} txs',

    hoverHint: 'Hover a box for its spread, or a dot for one transaction',
    caption: '{{range}} · {{count}} transactions',
    omitted_one: '{{count}} category not shown',
    omitted_other: '{{count}} categories not shown',
    ariaLabel: 'Box plot of transaction amounts across {{count}} categories',

    empty: 'Not enough spending to plot',
    emptyHint:
      'A category needs at least two transactions before a distribution says anything.',
  },

  /**
   * Deep Analytics — the raw-data explorer.
   *
   * Flat keys, not nested: `TranslationKey` is `section.key`, two levels, so
   * `explorer.chart.bar` could never type-check. The prefixes (`chart…`,
   * `agg…`, `role…`) do the grouping a nested object would have.
   *
   * Statistical terms are used by their proper names. Someone opening a
   * JMP-style explorer is asking for "median" and "interquartile range", and a
   * softer synonym would only make them wonder whether it means the same thing.
   */
  explorer: {
    entryTitle: 'Deep Analytics',
    entryHint: 'Raw data explorer — map any column to any axis',
    entryAria: 'Open Deep Analytics, the raw data explorer',

    /* ---- The page ---- */
    backToAnalytics: 'Analytics',
    settings: 'Chart settings',
    chartSection: 'Chart',
    filtersSection: 'Filters',
    noMatches: 'No rows match these filters. Loosen one to see data again.',

    /* ---- Filters ---- */
    addFilter: 'Add filter',
    noFilters: 'No filters — every row is included.',
    filtersMatchAll: 'Rows must match every filter.',
    filterN: 'Filter {{n}}',
    removeFilter: 'Remove filter {{n}}',
    filterColumn: 'Column',
    filterOperator: 'Condition',
    filterValue: 'Value',
    chooseColumn: 'Choose a column',
    chooseValue: 'Choose',
    valuePlaceholder: 'Value',
    filteredCount: '{{shown}} of {{total}} rows',
    filterSummary_one: '{{count}} filter',
    filterSummary_other: '{{count}} filters',
    opEq: '= is',
    opNeq: '≠ is not',
    opGt: '> greater than',
    opLt: '< less than',
    opAfter: '> after',
    opBefore: '< before',
    opContains: 'contains',

    /* ---- Colours ---- */
    changeColor: 'Change the colour of {{name}}',
    resetColor: 'Reset colour',
    resetColorFor: 'Reset the colour of {{name}}',
    resetAllColors: 'Reset all colours',
    /* A hand-picked colour cannot be validated, only warned about. */
    lowContrast: 'Low contrast — hard to see on this background. Exact values are in Chart data.',

    title: 'Deep Analytics',
    loading: 'Loading {{source}}…',
    emptySource: 'This table has no rows yet.',
    rowCount_one: '{{count}} row',
    rowCount_other: '{{count}} rows',

    dataSource: 'Data source',
    sourceTransactions: 'Transactions',
    sourceInvestments: 'Investments',
    sourceDebts: 'Debts',
    sourceGoals: 'Goals',
    sourceSubscriptions: 'Subscriptions',
    sourceBudgets: 'Budgets',
    sourceBillSplits: 'Shared bills',
    sourceWallets: 'Wallets',
    sourceWatchlist: 'Watchlist',

    chartType: 'Chart',
    chartBar: 'Bar',
    chartLine: 'Line',
    chartScatter: 'Scatter',
    chartBox: 'Box plot',

    roleX: 'X axis',
    roleY: 'Y axis',
    roleOverlay: 'Overlay (colour)',
    rolePage: 'Page by',
    addVariable: 'Add variable',
    removeVariable: 'Remove {{name}}',
    maxVarsReached: 'This chart takes up to {{max}}. Remove one to add another.',
    oneXForChart: 'This chart takes one X variable. Bar and box plots can nest several.',
    nestHint: 'Nested outer to inner, in the order added.',
    sharedYHint: 'All share one Y axis, and colour shows which is which.',
    overlayPausedForMetrics: 'Paused — with several Y variables, colour shows the variables. Remove one to overlay again.',
    overlayNotForChart: 'Box plots colour by Y variable, not by overlay.',
    pageHint: 'One chart per value, all drawn on the same scales.',
    choose: 'Choose a column',
    none: 'None',
    noColumnsForRole: 'This table has no column of that kind.',
    countNeedsNoY: 'Not needed — Count counts rows.',

    kindNumber: 'number',
    kindDate: 'date',
    kindCategory: 'category',
    kindBoolean: 'yes/no',

    aggregation: 'Summarize Y as',
    aggSum: 'Sum',
    aggMean: 'Mean',
    aggMedian: 'Median',
    aggCount: 'Count',

    dateBucket: 'Group dates by',
    bucketDay: 'Day',
    bucketMonth: 'Month',
    bucketYear: 'Year',

    views: 'Views',
    viewChart: 'Chart',
    viewTwin: 'Chart data',
    viewRaw: 'Raw rows',

    /* Why a selection cannot be drawn — shown in place of the chart. */
    problemNeedX: 'Choose a column for the X axis.',
    problemBadX: 'That column cannot go on this chart’s X axis.',
    problemNeedY: 'Choose a numeric column for the Y axis.',
    problemBadY: 'The Y axis needs a numeric column.',
    problemTooManyX: 'This chart takes fewer X variables. Remove one.',
    problemTooManyY: 'Too many Y variables for this chart. Remove one.',
    problemBadOverlay: 'That column cannot be used as an overlay on this chart.',
    problemBadPage: 'Page by needs a category, yes/no or date column.',
    problemTooManyFacets: 'Too many facets generated. Please filter your data.',
    tooManyFacetsDetail: 'Page by {{column}} would make {{panels}} charts; up to {{max}} fit side by side. Add a filter, or page by a column with fewer values.',

    /* Small multiples. */
    facetGrid: '{{count}} charts',
    facetCaption_one: 'One chart per {{column}} · {{count}} chart, all on the same scales',
    facetCaption_other: 'One chart per {{column}} · {{count}} charts, all on the same scales',
    seriesColumn: 'Series',
    problemTooManyBuckets: 'Too many bars to read. Group dates by month or year instead.',

    /* What the chart left out, stated rather than done silently. */
    noteSampled: 'Showing a sample of {{shown}} of {{total}} points — every point is in Chart data.',
    noteFolded_one: '{{count}} smaller group is combined into Other.',
    noteFolded_other: '{{count}} smaller groups are combined into Other.',
    noteFoldedBands_one: '{{count}} smaller category on the X axis is combined into Other.',
    noteFoldedBands_other: '{{count}} smaller categories on the X axis are combined into Other.',
    noteDropped_one: '{{count}} row without a usable value was left out.',
    noteDropped_other: '{{count}} rows without a usable value were left out.',
    noteHiddenOutliers_one: '{{count}} further outlier is counted but not drawn.',
    noteHiddenOutliers_other: '{{count}} further outliers are counted but not drawn.',

    statN: 'n',
    statMin: 'Min',
    statQ1: 'Q1',
    statMedian: 'Median',
    statQ3: 'Q3',
    statMax: 'Max',
    statIqr: 'Interquartile range',
    statRange: 'Range',
    statOutliers: 'Outliers',

    blank: '(blank)',
    other: 'Other',
    yes: 'Yes',
    no: 'No',

    tableCapped: 'Showing the first {{shown}} of {{total}} rows.',
    tableEmpty: 'Nothing to show.',
    chartAria: 'Chart of {{y}} by {{x}}',
    keyboardHint: 'Use the left and right arrow keys to step through the chart, Home and End to jump, Escape to clear.',
  },

  /* ---- The financial inbox ----
     Micro-IOUs and reminders. The wording stays casual on purpose: this is the
     one place in the app where writing something down has to feel like sending
     yourself a message, not filing a record. */
  inbox: {
    title: 'Inbox',
    placeholder: 'Mai owes me 300 for lunch…',
    newItem: 'New inbox item',
    add: 'Add to inbox',
    moreOptions: 'Amount, date and type',
    type: 'Type',
    typeNote: 'Just a note',
    typeToPay: 'I owe',
    typeToReceive: 'Owed to me',
    amount: 'Amount',
    dueDate: 'Due date',

    empty: 'Nothing waiting. Jot down an IOU or a reminder above.',
    allClear: 'All clear',
    pendingCount_one: '{{count}} open',
    pendingCount_other: '{{count}} open',
    owedSummary: 'you owe {{amount}}',
    owedToYouSummary: 'owed to you {{amount}}',
    overdue: 'Overdue · {{date}}',
    resolveItem: 'Resolve “{{text}}”',
    deleteItem: 'Delete “{{text}}”',

    /* The one question resolving asks. */
    convertTitle: 'Record this transaction now?',
    convertPayHint: 'Yes records an expense for this amount. The form opens so you can pick the wallet and category.',
    convertReceiveHint: 'Yes records income for this amount. The form opens so you can pick the wallet and category.',
    convertNoHint: 'No just ticks it off — nothing is added to your ledger.',
    convertYes: 'Yes, record it',
    convertNo: 'No, just tick it off',
  },

  /* ---- The category manager ----
     Chips, not a comma-separated line. The errors have to say what to do about
     it, not just that something is wrong. */
  categories: {
    title: 'Categories',
    subtitle: 'The labels every transaction, budget and report is grouped by',
    add: 'Add category',
    newField: 'New category name',
    newPlaceholder: 'Groceries',
    renameField: 'Rename {{name}}',
    rename: 'Rename {{name}}',
    remove: 'Delete {{name}}',
    hint_one: '{{count}} category. Renaming one here does not relabel entries already filed under it.',
    hint_other: '{{count}} categories. Renaming one here does not relabel entries already filed under it.',
    atLimit: 'You have reached the limit of {{max}} categories.',

    errorEmpty: 'Give the category a name.',
    errorDuplicate: 'That category already exists.',
    errorTooLong: 'Keep it under {{max}} characters.',
    errorTooMany: 'You can have at most {{max}} categories.',
    errorLast: 'Keep at least one category — every transaction needs somewhere to go.',
  },

  liability: {
    title: 'Upcoming bills',
    subtitle: 'What is already promised, and when it lands',
    empty: 'Nothing is scheduled this month.',
    emptyHint: 'Subscriptions and card statements appear here as they fall due.',

    /* Day cells. `count` drives the plural. */
    dayEmpty: '{{date}} · nothing due',
    daySummary_one: '{{date}} · {{amount}} across {{count}} bill',
    daySummary_other: '{{date}} · {{amount}} across {{count}} bills',

    /* The detail popover. */
    dueOn: 'Due {{date}}',
    dayTotal: 'Total due',
    close: 'Close',
    kindSubscription: 'Subscription',
    kindCard: 'Card statement',
    kindDebt: 'Debt payment',
    kindInstallment: 'Installment',

    /* Legend. */
    legendQuiet: 'Quiet',
    legendHeavy: 'Heavy',
    legendPayday: 'Payday',
    yearAria: 'Twelve months of upcoming bills, one square per day',
    cardsUnprojected: 'Card statements beyond the next one are not projected',
    rangeMonth: '1 month',
    rangeYear: '1 year',
    rangeAria: 'Time range',
    yearTotal: '{{amount}} over 12 months',
    yearPeakMonth: 'Heaviest month: {{month}} · {{amount}}',
    paydayNone: 'No payday set',
    paydayOption: 'Payday: day {{day}}',

    /* Insights. */
    insights: 'Insights',
    peakWeek: 'Peak billing week',
    peakWeekValue: 'Week {{week}} ({{from}}–{{to}}) costs {{amount}}',
    peakDay: 'Heaviest day',
    peakDayValue: '{{date}} · {{amount}}',
    totalLiabilities: 'Total monthly liabilities',
    fromSubscriptions: '{{amount}} subscriptions',
    fromCards: '{{amount}} card statements',
    peakMonth: 'Heaviest month',
    monthlyAverage: 'Average per month',
    acrossMonths: 'Across {{count}} months of commitments',
    fromDebts: '{{amount}} debt payments',
    fromInstallments: '{{amount}} installments',

    /* The payday split — the actual warning this screen exists to give. */
    beforePayday: 'Due before payday',
    beforePaydayHint: 'You cover this from last month{{sep}}s balance',
    afterPayday: 'Due on or after payday',
    paydayUnset: 'Set a payday to see what lands before it',
    paydaySet: 'Set paydays',
    /* Shown instead of the before/after split once there is more than one
       payday, where that split stops being a meaningful reading. */
    peakPayPeriod: 'Heaviest pay period',
    payPeriodLeading: 'Days 1–{{to}}, before your first payday',
    payPeriodFunded: 'Days {{from}}–{{to}}, funded by the {{from}}',
    paydayCount_one: '{{count}} payday configured',
    paydayCount_other: '{{count}} paydays configured',

    /* Bill splits. Deliberately phrased as money coming in, because it is. */
    expectedBack: 'Expected back',
    expectedBackHint_one: 'From {{count}} open shared bill — not counted above',
    expectedBackHint_other: 'From {{count}} open shared bills — not counted above',
  },

  notFound: {
    title: 'Lost in the ledger',
    message: 'That page is not in the books. It may have been renamed, or the link may be wrong.',
    /* The raw hash the user tried, so a mistyped link is self-explanatory. */
    attempted: 'You asked for {{path}}',
    goHome: 'Back to Overview',
  },

  tax: {
    estimateHeading: 'Thai income tax estimate',
    progressiveBands: 'Progressive bands',
    assumptionsHeading: 'What this estimate assumes',
    loadFailed: 'Could not load transactions',
    pdfFailed: 'Could not build the PDF',
    refundDue: 'Estimated refund due',
    stillToPay: 'Tax still to pay',
    estimatedPayable: 'Estimated tax payable',
    recalculate: 'Recalculate',
    lessWithholding: 'Less: withholding tax already paid',
    exportPdf: 'Export as PDF',
    additionalDeductions: 'Additional deductions',
    entered: '{{count}} entered',
    socialSecurityHint: 'ประกันสังคม · max {{amount}} a year',
    insuranceHint: 'ประกันชีวิตและสุขภาพ · max {{amount}}',
    fundsHint: 'กองทุนรวม SSF / RMF / Thai ESG · enter your own total, already within your limits',
    withholdingHint:
      'ภาษีหัก ณ ที่จ่าย · from your 50 Tawi certificate. Credited against the tax, not deducted from income.',
    wrongCurrencyTitle: 'Your books are in {{currency}}, not THB',
    wrongCurrencyBody:
      'Thai tax bands are fixed baht amounts, so a {{currency}} total is compared against THB thresholds and the result below is not meaningful. Switch the bookkeeping currency in Settings, or read this as a shape rather than a figure.',
    idleBody:
      'Nothing is calculated until you ask. Choose a range and press <1>{{action}}</1> — it reads your income transactions for those dates and works through the 0–35% bands.',
    noIncomeBody:
      'The calculation is correct for what is in the app, but a ฿0 result usually means the income for these dates has not been entered yet.',

    grossIncome: 'Gross assessable income',
    grossIncomeSub: 'เงินได้พึงประเมิน · all income in range',
    expenseDeduction: 'Less: standard expense deduction',
    expenseDeductionSub: 'ค่าใช้จ่าย · 50% of income, capped at {{amount}}',
    expenseDeductionCapped: ' — 50% would be {{amount}}, so the cap applies',
    personalAllowance: 'Less: personal allowance',
    personalAllowanceSub: 'ค่าลดหย่อนส่วนตัว · the taxpayer’s own allowance',
    netTaxableIncome: 'Net taxable income',
    netTaxableIncomeSub: 'เงินได้สุทธิ · what the bands below are applied to',

    lessLabel: 'Less: {{label}}',
    allowanceSocialSecurity: 'social security',
    allowanceInsurance: 'life and health insurance',
    allowanceFunds: 'investment funds',
    allowanceFundsHint: 'as entered; own limits not verified',
    allowanceCapped: ' · {{requested}} entered, capped at {{cap}}',
    allowanceHintSuffix: ' · {{hint}}',

    bandLadderHint: 'Each rate applies only to the slice of income inside its own band',
    bandOver: 'Over {{from}}',
    bandRange: '{{from}} – {{to}}',
    yourRate: 'your rate',
    taxColumn: 'Tax',
    title: 'Thai income tax',
    close: 'Close',
    from: 'From',
    to: 'To',
    dateRangeError: 'The start date is after the end date.',
    readingTransactions: 'Reading transactions…',
    runCalculation: 'Run calculation',
    noIncomeInRange: 'No income recorded in this range',

    socialSecurity: 'Social security',
    lifeHealthInsurance: 'Life & health insurance',
    investmentFunds: 'Investment funds',
    withholding: 'Withholding tax already paid',

    howTaxableReached: 'How the taxable figure is reached',
    band: 'Band',
    rate: 'Rate',
    taxableHere: 'Taxable here',
    taxPayable: 'Tax payable',
    afterTax: 'After tax',
    perMonth: 'Per month',
    effectiveRate: 'Effective rate',
    marginalRate: 'Marginal rate',
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
