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

  wallets: {
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
    deleteCascadeConfirm: '{{message}}\n\nDelete "{{name}}" AND all of its records permanently?',
  },

  activity: {
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
    monthlyIncomeHint:
      'Base for percentage budgets. Leave blank to use the income you actually record each month.',
    categories: 'Categories',
    categoriesHint: 'Comma separated. Used by transactions and budgets.',
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

  tax: {
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
    additionalDeductions: 'Additional deductions',
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
