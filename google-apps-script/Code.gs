/**
 * Quick Wallet — Google Apps Script REST API
 * ===========================================================================
 * Replaces the local Node/Express backend. The Google Sheet is the database;
 * this script is the only thing that touches it.
 *
 * ---------------------------------------------------------------------------
 * DEPLOYMENT
 * ---------------------------------------------------------------------------
 * 1. Open your spreadsheet → Extensions → Apps Script. Paste this file in.
 * 2. Project Settings → Script Properties, add:
 *      SESSION_SECRET   any long random string (signs session tokens)
 *      ADMIN_SECRET     any long random string (guards auth.resetPassword)
 *    If SPREADSHEET_ID below is left empty the script uses the spreadsheet it
 *    is bound to, which is what you want for a container-bound script.
 * 3. Deploy → New deployment → Web app
 *      Execute as:      Me
 *      Who has access:  Anyone
 *    "Anyone" is required — the frontend calls this without a Google login.
 *    Copy the /exec URL into frontend/.env.local as VITE_GAS_WEB_APP_URL.
 * 4. Run `setup()` once from the editor to accept the permission prompt and
 *    verify every sheet/header is present.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ODD REQUEST SHAPE
 * ---------------------------------------------------------------------------
 * A browser sends a CORS preflight (OPTIONS) for any request that isn't
 * "simple", and Apps Script cannot answer OPTIONS. So:
 *   - POSTs use Content-Type: text/plain;charset=utf-8 with a JSON string body,
 *     which keeps them simple. doPost parses e.postData.contents itself.
 *   - No custom headers, ever. The session token travels in the query string
 *     (GET) or inside the JSON body (POST) instead of an Authorization header.
 *   - Everything non-GET (create/update/delete) is tunnelled through POST with
 *     a `method` field, because PATCH/DELETE would also preflight.
 *
 * ---------------------------------------------------------------------------
 * RESPONSES
 * ---------------------------------------------------------------------------
 * Apps Script always answers HTTP 200, so the real status rides in the body:
 *      success -> { "ok": true,  "data": ... }
 *      failure -> { "ok": false, "status": 404, "code": "NOT_FOUND",
 *                   "error": "human readable" }
 * The React client turns ok:false into a thrown ApiError.
 * ===========================================================================
 */

/** Leave empty for a container-bound script; set an ID to target another file. */
var SPREADSHEET_ID = '';

/** Password hashing cost. Each iteration is one HMAC-SHA256 in Apps Script,
 *  which is far slower than native crypto — 1500 keeps login under ~1s. */
var PBKDF2_ITERATIONS = 1500;

/** Session lifetime. */
var TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/* =========================================================================
 * Schema — must match the headers in your migrated sheets exactly.
 * ========================================================================= */

var SHEETS = {
  Users: {
    key: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string' },
      { key: 'username', header: 'Username', type: 'string' },
      { key: 'displayName', header: 'Display Name', type: 'string' },
      { key: 'salt', header: 'Salt', type: 'string' },
      { key: 'passwordHash', header: 'Password Hash', type: 'string' },
      { key: 'active', header: 'Active', type: 'boolean' },
      { key: 'createdAt', header: 'Created At', type: 'date' }
    ]
  },
  Wallets: {
    key: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string' },
      { key: 'userId', header: 'User ID', type: 'string' },
      { key: 'name', header: 'Name', type: 'string' },
      { key: 'mode', header: 'Mode', type: 'string' },
      { key: 'kind', header: 'Kind', type: 'string' },
      { key: 'currency', header: 'Currency', type: 'string' },
      { key: 'openingBalance', header: 'Opening Balance', type: 'number' },
      { key: 'color', header: 'Color', type: 'string' },
      { key: 'icon', header: 'Icon', type: 'string' },
      { key: 'archived', header: 'Archived', type: 'boolean' },
      { key: 'note', header: 'Note', type: 'string' },
      { key: 'createdAt', header: 'Created At', type: 'date' },
      /* ---- Credit card fields, appended after createdAt on purpose ----
         insertRow_/updateRow_ write columns positionally in schema order, so a
         new column is only safe at the end, where createMissingSheets() also
         appends its header. Every one of these coerces to 0 or '' for a row
         written before they existed, which is what makes the upgrade seamless:
         walletType_() reads an empty `type` as 'CASH', so every wallet already
         in the sheet keeps behaving exactly as it did.

         `type` is a coarser cut than the existing `kind`: kind is a label the
         user picks for the card ("bank", "ewallet"), type is what the balance
         maths has to know. They are kept in sync on write — kind 'credit'
         implies type 'CREDIT' and vice versa — so neither can drift. */
      { key: 'type', header: 'Type', type: 'string' },
      { key: 'creditLimit', header: 'Credit Limit', type: 'number' },
      /* Day of month the statement closes / falls due, 1-31. 0 means unset,
         which the client reads as "this card has no billing cycle yet". A day
         past the end of a short month is clamped, never overflowed — see
         cycleDayInMonth() in lib/creditMath.ts. */
      { key: 'statementDate', header: 'Statement Day', type: 'number' },
      { key: 'dueDate', header: 'Due Day', type: 'number' },
      /* Percent, so 1.5 means 1.5% back. Purely informational — no cashback
         transaction is ever written automatically, because the issuer decides
         the real figure and a guess in the ledger is worse than no figure. */
      { key: 'cashbackRate', header: 'Cashback Rate %', type: 'number' }
    ]
  },
  Transactions: {
    key: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string' },
      { key: 'userId', header: 'User ID', type: 'string' },
      { key: 'walletId', header: 'Wallet ID', type: 'string' },
      { key: 'toWalletId', header: 'To Wallet ID', type: 'string' },
      { key: 'type', header: 'Type', type: 'string' },
      { key: 'amount', header: 'Amount', type: 'number' },
      { key: 'category', header: 'Category', type: 'string' },
      { key: 'note', header: 'Note', type: 'string' },
      { key: 'date', header: 'Date', type: 'datekey' },
      { key: 'createdAt', header: 'Created At', type: 'date' },
      /* ---- 0% installment plans ----
         A plan is n ordinary Transaction rows sharing one group id, one per
         monthly chunk, dated a month apart. Nothing about the existing ledger
         changes: each row is a normal expense that lands in its own month, so
         `monthExpense` and budget progress count one chunk per month rather
         than the whole purchase up front, while the card's balance — which
         sums every row regardless of date — correctly shows the full amount
         still owed to the bank.

         Empty on every row that is not part of a plan, which is all of them
         until someone creates one. */
      { key: 'installmentGroupId', header: 'Installment Group ID', type: 'string' },
      /* "3/10" — human-readable on purpose, because this column is read in the
         sheet as often as it is read by code, and a bare index would need the
         group's length fetched to mean anything. */
      { key: 'installmentIndex', header: 'Installment Index', type: 'string' }
    ]
  },
  Investments: {
    key: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string' },
      { key: 'userId', header: 'User ID', type: 'string' },
      { key: 'walletId', header: 'Wallet ID', type: 'string' },
      { key: 'symbol', header: 'Symbol', type: 'string' },
      { key: 'quantity', header: 'Quantity', type: 'number' },
      { key: 'buyPrice', header: 'Buy Price', type: 'number' },
      { key: 'fees', header: 'Fees', type: 'number' },
      { key: 'buyDate', header: 'Buy Date', type: 'datekey' },
      { key: 'tags', header: 'Tags', type: 'string' },
      { key: 'status', header: 'Status', type: 'string' },
      { key: 'sellPrice', header: 'Sell Price', type: 'number' },
      { key: 'sellDate', header: 'Sell Date', type: 'datekey' },
      { key: 'note', header: 'Note', type: 'string' },
      { key: 'createdAt', header: 'Created At', type: 'date' }
    ]
  },
  Budgets: {
    key: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string' },
      { key: 'userId', header: 'User ID', type: 'string' },
      { key: 'period', header: 'Period', type: 'period' },
      { key: 'scope', header: 'Scope', type: 'string' },
      { key: 'targetId', header: 'Target ID', type: 'string' },
      { key: 'targetLabel', header: 'Target Label', type: 'string' },
      { key: 'mode', header: 'Mode', type: 'string' },
      { key: 'value', header: 'Value', type: 'number' },
      { key: 'baseIncome', header: 'Base Income', type: 'number' },
      { key: 'note', header: 'Note', type: 'string' },
      { key: 'createdAt', header: 'Created At', type: 'date' }
    ]
  },
  Subscriptions: {
    key: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string' },
      { key: 'userId', header: 'User ID', type: 'string' },
      { key: 'name', header: 'Name', type: 'string' },
      { key: 'amount', header: 'Amount', type: 'number' },
      { key: 'walletId', header: 'Wallet ID', type: 'string' },
      { key: 'category', header: 'Category', type: 'string' },
      { key: 'frequency', header: 'Frequency', type: 'string' },
      /* datekey, not string: Sheets would otherwise parse "2026-09-01" into a
         Date and hand it back as a UTC ISO stamp — the same trap the Budgets
         Period column fell into. */
      { key: 'nextDueDate', header: 'Next Due Date', type: 'datekey' },
      { key: 'note', header: 'Note', type: 'string' },
      { key: 'createdAt', header: 'Created At', type: 'date' }
    ]
  },
  Watchlist: {
    key: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string' },
      { key: 'userId', header: 'User ID', type: 'string' },
      { key: 'symbol', header: 'Symbol', type: 'string' },
      { key: 'category', header: 'Category', type: 'string' },
      { key: 'targetPrice', header: 'Target Price', type: 'number' },
      { key: 'note', header: 'Note', type: 'string' },
      { key: 'createdAt', header: 'Created At', type: 'date' }
    ]
  },
  /**
   * A bill one person paid and several people owe a share of.
   *
   * -------------------------------------------------------------------------
   * WHY THE SHARES ARE ONE JSON CELL AND NOT THEIR OWN SHEET
   * -------------------------------------------------------------------------
   * A share has no life of its own: it is never queried across bills, never
   * reported on independently, and never outlives the bill it belongs to. A
   * `BillSplitShares` sheet would therefore cost an extra getDataRange() and a
   * billId filter on every read, to model a strict parent-child relationship
   * the parent already fully contains. Apps Script bills per Sheets call, so
   * that is the expensive shape, not the cheap one.
   *
   * The same reasoning the Settings sheet uses for its theme library.
   */
  BillSplits: {
    key: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string' },
      { key: 'userId', header: 'User ID', type: 'string' },
      { key: 'title', header: 'Title', type: 'string' },
      { key: 'totalAmount', header: 'Total Amount', type: 'number' },
      /* The wallet that actually paid, and that every repayment returns to.
         Held on the bill rather than re-derived from the expense row, because
         the expense can be edited or deleted by the user from the Activity
         screen and the bill still has to know where the money came from. */
      { key: 'walletId', header: 'Wallet ID', type: 'string' },
      { key: 'note', header: 'Note', type: 'string' },
      /* [{ personName, amount, isPaid, repaymentTxId }] — see parseSplits_. */
      { key: 'splitsJSON', header: 'Splits (JSON)', type: 'jsonlist' },
      /* 'open' | 'settled'. Derived on every write from the shares themselves,
         never set by the client: a status that can disagree with the rows it
         summarises is worse than no status at all. */
      { key: 'status', header: 'Status', type: 'string' },
      { key: 'createdAt', header: 'Created At', type: 'date' },
      /* -------------------------------------------------------------------
         NOT IN THE ORIGINAL SPEC, AND LOAD-BEARING
         -------------------------------------------------------------------
         The id of the expense Transaction written when the bill was created.
         Without it the bill is a dead end: nothing can delete the bill and its
         expense as one act, nothing can tell you which row on the Activity
         screen this bill produced, and a repayment has no way to prove it is
         returning money the same wallet actually spent. One string column is a
         cheap price for that. */
      { key: 'expenseTxId', header: 'Expense Tx ID', type: 'string' }
    ]
  },
  Goals: {
    key: 'id',
    columns: [
      { key: 'id', header: 'ID', type: 'string' },
      /* Not in the original spec, and required. Every read in this script goes
         through `userRows_`, which scopes by this column; without it a goal
         would be visible to every profile in the workbook. */
      { key: 'userId', header: 'User ID', type: 'string' },
      { key: 'title', header: 'Title', type: 'string' },
      { key: 'targetAmount', header: 'Target Amount', type: 'number' },
      /* The envelope's balance. Only ever moved by `goals.fund`, never written
         directly by the client — see the note there. */
      { key: 'savedAmount', header: 'Saved Amount', type: 'number' },
      /* Optional. `datekey`, not `date`: Sheets would parse a bare
         "2027-03-01" into a Date and hand it back as a UTC stamp, which is the
         trap the Subscriptions and Budgets columns already document. */
      { key: 'deadline', header: 'Deadline', type: 'datekey' },
      { key: 'color', header: 'Color', type: 'string' },
      { key: 'note', header: 'Note', type: 'string' },
      { key: 'createdAt', header: 'Created At', type: 'date' }
    ]
  },
  Settings: {
    key: 'userId',
    columns: [
      { key: 'userId', header: 'User ID', type: 'string' },
      { key: 'theme', header: 'Theme', type: 'string' },
      { key: 'accent', header: 'Accent', type: 'string' },
      { key: 'customVars', header: 'Custom Vars (JSON)', type: 'json' },
      { key: 'currency', header: 'Currency', type: 'string' },
      { key: 'displayCurrency', header: 'Display Currency', type: 'string' },
      { key: 'fxRate', header: 'FX Rate (base->display)', type: 'number' },
      { key: 'fxRateUpdatedAt', header: 'FX Rate Updated At', type: 'date' },
      { key: 'locale', header: 'Locale', type: 'string' },
      { key: 'monthlyIncome', header: 'Monthly Income', type: 'number' },
      { key: 'categories', header: 'Categories', type: 'list' },
      { key: 'updatedAt', header: 'Updated At', type: 'date' },
      /* The theme library. A JSON array of
           { id, name, colors: { '--bg': '#…', … }, createdAt, updatedAt }
         held in one cell rather than in a CustomThemes sheet of its own.

         Apps Script bills per Sheets call, not per byte: a separate sheet would
         cost an extra getDataRange() on every settings read plus a userId filter,
         to store a handful of ~400-byte rows. This column rides along with the
         Settings row the client already fetches on boot, so the whole library
         arrives in the request that was happening anyway and a library write is
         one setValues() on a row we had already located. A cell holds 50,000
         characters — roughly 100 themes — which is far past what anyone will make,
         and MAX_CUSTOM_THEMES below keeps it well under that.

         Appended after updatedAt on purpose: insertRow_/updateRow_ write columns
         positionally in schema order, so new columns are only safe at the end,
         where createMissingSheets() also appends their headers. */
      { key: 'customThemes', header: 'Custom Themes (JSON)', type: 'jsonlist' },
      /* Which library entry `theme: 'custom'` is currently showing. Empty when a
         built-in preset is active or the custom slot is being edited ad hoc. */
      { key: 'activeCustomThemeId', header: 'Active Custom Theme ID', type: 'string' },
      /* The typeface, as a FONTS id ('sarabun') rather than a CSS font stack.
         Storing a name from a closed list keeps arbitrary CSS out of the sheet
         and out of the custom property it ends up in; the client resolves the
         id to a stack. Empty = the system face. */
      { key: 'fontFamily', header: 'Font Family', type: 'string' }
    ]
  }
};

var DEFAULT_CATEGORIES = [
  'Salary', 'Bonus', 'Needs', 'Groceries', 'Rent', 'Utilities', 'Transport',
  'Health', 'Wants', 'Dining', 'Entertainment', 'Shopping', 'Save', 'Invest',
  'Education', 'Other'
];

/* =========================================================================
 * Entry points
 * ========================================================================= */

function doGet(e) {
  return handle_(function () {
    var params = (e && e.parameter) || {};
    var action = params.action || 'health';
    return dispatch_(action, 'GET', params, {}, params.token || '');
  });
}

function doPost(e) {
  return handle_(function () {
    if (!e || !e.postData || !e.postData.contents) {
      throw apiError_('Request body is missing', 400, 'BAD_REQUEST');
    }

    // Sent as text/plain to dodge the CORS preflight, so parse it ourselves.
    var envelope;
    try {
      envelope = JSON.parse(e.postData.contents);
    } catch (err) {
      throw apiError_('Request body is not valid JSON', 400, 'BAD_JSON');
    }

    var action = envelope.action || '';
    var method = (envelope.method || 'POST').toUpperCase();
    var query = envelope.query || {};
    var body = envelope.body || {};
    var token = envelope.token || '';

    if (!action) throw apiError_('Missing "action"', 400, 'BAD_REQUEST');
    return dispatch_(action, method, query, body, token);
  });
}

/** Wraps a handler so every outcome becomes the JSON envelope. */
function handle_(fn) {
  var payload;
  try {
    payload = { ok: true, data: fn() };
  } catch (err) {
    payload = {
      ok: false,
      status: err && err.__status ? err.__status : 500,
      code: err && err.__code ? err.__code : 'INTERNAL_ERROR',
      error: (err && err.message) || 'Unexpected server error'
    };
    console.error(err && err.stack ? err.stack : err);
  }
  return ContentService.createTextOutput(JSON.stringify(payload)).setMimeType(
    ContentService.MimeType.JSON
  );
}

/* =========================================================================
 * Router
 * ========================================================================= */

function dispatch_(action, method, query, body, token) {
  var handlers = {
    'health': function () { return health_(); },

    'auth.status': function () { return authStatus_(); },
    'auth.register': function () { return authRegister_(body); },
    'auth.login': function () { return authLogin_(body); },
    'auth.me': function () { return { user: publicUser_(requireAuth_(token)) }; },
    'auth.changePassword': function () { return authChangePassword_(requireAuth_(token), body); },
    'auth.resetPassword': function () { return authResetPassword_(body); },

    'wallets.list': function () { return walletsList_(requireAuth_(token), query); },
    'wallets.get': function () { return walletsGet_(requireAuth_(token), query); },
    'wallets.create': function () { return walletsCreate_(requireAuth_(token), body); },
    'wallets.update': function () { return walletsUpdate_(requireAuth_(token), query, body); },
    'wallets.delete': function () { return walletsDelete_(requireAuth_(token), query); },

    'transactions.list': function () { return transactionsList_(requireAuth_(token), query); },
    'transactions.get': function () { return ownedRow_(requireAuth_(token), 'Transactions', query); },
    'transactions.create': function () { return transactionsCreate_(requireAuth_(token), body); },
    'transactions.update': function () { return transactionsUpdate_(requireAuth_(token), query, body); },
    'transactions.delete': function () { return transactionsDelete_(requireAuth_(token), query); },

    /* A 0% installment plan: n dated expense rows written as one row-block.
       Separate from transactions.create because it answers with the whole plan
       and the client patches every chunk into its cache at once. */
    'transactions.installment': function () {
      return transactionsCreateInstallment_(requireAuth_(token), body);
    },
    'transactions.cancelInstallment': function () {
      return transactionsDeleteInstallment_(requireAuth_(token), query);
    },

    'investments.list': function () { return investmentsList_(requireAuth_(token), query); },
    'investments.symbols': function () { return investmentsSymbols_(requireAuth_(token)); },
    'investments.get': function () {
      return decorateInvestment_(ownedRow_(requireAuth_(token), 'Investments', query));
    },
    'investments.create': function () { return investmentsCreate_(requireAuth_(token), body); },
    'investments.update': function () { return investmentsUpdate_(requireAuth_(token), query, body); },
    'investments.sell': function () { return investmentsSell_(requireAuth_(token), query, body); },
    'investments.delete': function () { return investmentsDelete_(requireAuth_(token), query); },

    'budgets.list': function () { return budgetsList_(requireAuth_(token), query); },
    'budgets.get': function () { return ownedRow_(requireAuth_(token), 'Budgets', query); },
    'budgets.create': function () { return budgetsCreate_(requireAuth_(token), body); },
    'budgets.update': function () { return budgetsUpdate_(requireAuth_(token), query, body); },
    'budgets.delete': function () { return budgetsDelete_(requireAuth_(token), query); },
    'budgets.copy': function () { return budgetsCopy_(requireAuth_(token), body); },

    'subscriptions.list': function () { return subscriptionsList_(requireAuth_(token)); },
    'subscriptions.get': function () { return ownedRow_(requireAuth_(token), 'Subscriptions', query); },
    'subscriptions.create': function () { return subscriptionsCreate_(requireAuth_(token), body); },
    'subscriptions.update': function () { return subscriptionsUpdate_(requireAuth_(token), query, body); },
    'subscriptions.delete': function () { return subscriptionsDelete_(requireAuth_(token), query); },
    'subscriptions.pay': function () { return subscriptionsPay_(requireAuth_(token), query, body); },

    /* Bill splits. Create and markPaid each write a Transaction *and* a
       BillSplits row in one locked call — see the note above the handlers. */
    'billSplits.list': function () { return billSplitsList_(requireAuth_(token), query); },
    'billSplits.get': function () { return billSplitsGet_(requireAuth_(token), query); },
    'billSplits.create': function () { return billSplitsCreate_(requireAuth_(token), body); },
    'billSplits.update': function () { return billSplitsUpdate_(requireAuth_(token), query, body); },
    'billSplits.delete': function () { return billSplitsDelete_(requireAuth_(token), query); },
    'billSplits.markPaid': function () { return billSplitsMarkPaid_(requireAuth_(token), query, body); },
    'billSplits.markUnpaid': function () { return billSplitsMarkUnpaid_(requireAuth_(token), query, body); },

    'goals.list': function () { return goalsList_(requireAuth_(token)); },
    'goals.create': function () { return goalsCreate_(requireAuth_(token), body); },
    'goals.update': function () { return goalsUpdate_(requireAuth_(token), query, body); },
    'goals.fund': function () { return goalsFund_(requireAuth_(token), query, body); },
    'goals.delete': function () { return goalsDelete_(requireAuth_(token), query); },

    'watchlist.list': function () { return watchlistList_(requireAuth_(token), query); },
    'watchlist.create': function () { return watchlistCreate_(requireAuth_(token), body); },
    'watchlist.update': function () { return watchlistUpdate_(requireAuth_(token), query, body); },
    'watchlist.delete': function () { return watchlistDelete_(requireAuth_(token), query); },

    'settings.get': function () { return settingsGet_(requireAuth_(token)); },
    'settings.save': function () { return settingsSave_(requireAuth_(token), body); },

    /* Saved palettes. Every write answers with the whole Settings row so the
       client can swap its settings in one round trip. */
    'themes.list': function () { return themesList_(requireAuth_(token)); },
    'themes.create': function () { return themesCreate_(requireAuth_(token), body); },
    'themes.update': function () { return themesUpdate_(requireAuth_(token), query, body); },
    'themes.delete': function () { return themesDelete_(requireAuth_(token), query); },
    'themes.activate': function () { return themesActivate_(requireAuth_(token), query); },

    'dashboard.get': function () { return dashboardGet_(requireAuth_(token), query); },
    'dashboard.periods': function () { return dashboardPeriods_(requireAuth_(token)); },

    /* The old backend buffered writes in memory; Sheets writes land immediately,
       so this stays only so the Settings screen's button keeps working. */
    'flush': function () { return health_(); }
  };

  var handler = handlers[action];
  if (!handler) throw apiError_('Unknown action "' + action + '"', 404, 'UNKNOWN_ACTION');

  // Reads never take the lock; writes serialise so two tabs can't interleave.
  if (method === 'GET') return handler();

  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    throw apiError_('The sheet is busy, try again in a moment', 503, 'BUSY');
  }
  try {
    return handler();
  } finally {
    lock.releaseLock();
  }
}

/* =========================================================================
 * Sheet access
 * ========================================================================= */

/** Per-execution memo. A single request often reads the same sheet 3-4 times. */
var CACHE_ = {};

function spreadsheet_() {
  return SPREADSHEET_ID
    ? SpreadsheetApp.openById(SPREADSHEET_ID)
    : SpreadsheetApp.getActiveSpreadsheet();
}

function sheet_(name) {
  var sheet = spreadsheet_().getSheetByName(name);
  if (!sheet) {
    throw apiError_(
      'Sheet "' + name + '" is missing from the spreadsheet',
      500,
      'SHEET_MISSING'
    );
  }
  return sheet;
}

function schema_(name) {
  var def = SHEETS[name];
  if (!def) throw apiError_('Unknown sheet "' + name + '"', 500, 'UNKNOWN_SHEET');
  return def;
}

/**
 * Reads a whole sheet into typed objects.
 * Each row carries a non-enumerable-ish `_row` (1-based sheet row) so updates
 * and deletes don't need a second lookup.
 */
function readTable_(name) {
  if (CACHE_[name]) return CACHE_[name];

  var def = schema_(name);
  var values = sheet_(name).getDataRange().getValues();
  if (values.length < 1) {
    CACHE_[name] = [];
    return CACHE_[name];
  }

  var headers = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var indexByKey = {};
  def.columns.forEach(function (col) {
    indexByKey[col.key] = headers.indexOf(col.header.toLowerCase());
  });

  var rows = [];
  var seen = {};

  for (var r = 1; r < values.length; r += 1) {
    var raw = values[r];
    var row = {};
    var hasContent = false;

    def.columns.forEach(function (col) {
      var idx = indexByKey[col.key];
      var cell = idx >= 0 ? raw[idx] : '';
      if (cell !== '' && cell !== null && cell !== undefined) hasContent = true;
      row[col.key] = coerce_(cell, col.type);
    });

    if (!hasContent) continue;

    var id = String(row[def.key] || '').trim();
    if (!id || seen[id]) continue; // unusable or duplicate row
    seen[id] = true;

    row._row = r + 1;
    rows.push(row);
  }

  CACHE_[name] = rows;
  return rows;
}

function invalidate_(name) {
  delete CACHE_[name];
}

function findById_(name, id) {
  var def = schema_(name);
  var rows = readTable_(name);
  for (var i = 0; i < rows.length; i += 1) {
    if (String(rows[i][def.key]) === String(id)) return rows[i];
  }
  return null;
}

function insertRow_(name, obj) {
  var def = schema_(name);
  var normalized = {};
  def.columns.forEach(function (col) {
    normalized[col.key] = coerce_(obj[col.key], col.type);
  });

  var values = def.columns.map(function (col) {
    return serialize_(normalized[col.key], col.type);
  });

  sheet_(name).appendRow(values);
  invalidate_(name);
  return normalized;
}

/**
 * Appends many rows in a single setValues() call.
 *
 * appendRow() is one Sheets round trip each, and Apps Script bills per call
 * with a six-minute execution ceiling. A ten-month installment plan written a
 * row at a time is ten of those inside a lock every other tab is waiting on;
 * as one write it is indistinguishable from creating a single transaction.
 *
 * Returns the normalised rows in the order given.
 */
function insertRows_(name, objects) {
  if (!objects || !objects.length) return [];

  var def = schema_(name);
  var normalized = objects.map(function (obj) {
    var row = {};
    def.columns.forEach(function (col) {
      row[col.key] = coerce_(obj[col.key], col.type);
    });
    return row;
  });

  var values = normalized.map(function (row) {
    return def.columns.map(function (col) { return serialize_(row[col.key], col.type); });
  });

  var sheet = sheet_(name);
  sheet
    .getRange(sheet.getLastRow() + 1, 1, values.length, def.columns.length)
    .setValues(values);

  invalidate_(name);
  return normalized;
}

function updateRow_(name, id, patch) {
  var def = schema_(name);
  var existing = findById_(name, id);
  if (!existing) throw apiError_(name + ' row "' + id + '" not found', 404, 'NOT_FOUND');

  var merged = {};
  def.columns.forEach(function (col) {
    var value = Object.prototype.hasOwnProperty.call(patch, col.key)
      ? patch[col.key]
      : existing[col.key];
    merged[col.key] = coerce_(value, col.type);
  });
  merged[def.key] = existing[def.key];

  var values = def.columns.map(function (col) {
    return serialize_(merged[col.key], col.type);
  });

  sheet_(name).getRange(existing._row, 1, 1, def.columns.length).setValues([values]);
  invalidate_(name);

  merged._row = existing._row;
  return merged;
}

function deleteRow_(name, id) {
  var existing = findById_(name, id);
  if (!existing) return false;
  sheet_(name).deleteRow(existing._row);
  invalidate_(name);
  return true;
}

/** Bulk delete. Rows are removed bottom-up so earlier indexes stay valid. */
function deleteWhere_(name, predicate) {
  var rows = readTable_(name).filter(predicate);
  if (!rows.length) return 0;

  var sheet = sheet_(name);
  rows
    .map(function (r) { return r._row; })
    .sort(function (a, b) { return b - a; })
    .forEach(function (rowNumber) { sheet.deleteRow(rowNumber); });

  invalidate_(name);
  return rows.length;
}

/* =========================================================================
 * Value coercion
 * ========================================================================= */

function coerce_(value, type) {
  switch (type) {
    case 'number': {
      if (value === '' || value === null || value === undefined) return 0;
      var n = typeof value === 'number' ? value : Number(String(value).replace(/[, ]/g, ''));
      return isFinite(n) ? n : 0;
    }
    case 'boolean': {
      if (typeof value === 'boolean') return value;
      if (value === '' || value === null || value === undefined) return false;
      var s = String(value).trim().toLowerCase();
      return s === 'true' || s === '1' || s === 'yes' || s === 'y';
    }
    case 'date': {
      if (value instanceof Date) return value.toISOString();
      if (!value) return '';
      return String(value);
    }
    /* Sheets loves turning "2026-08-16" into a Date object. Force it back to a
       plain YYYY-MM-DD key so string comparisons and .slice(0,7) keep working. */
    case 'datekey': {
      if (value instanceof Date) return toDateKey_(value);
      if (!value) return '';
      var raw = String(value).trim();
      if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
      var parsed = new Date(raw);
      return isNaN(parsed.getTime()) ? raw : toDateKey_(parsed);
    }
    /* Same trap one level up: Sheets reads "2026-08" as a date too, and a
       Date coerced as a plain string comes back as a UTC ISO stamp whose month
       can differ from the one that was stored. Always rebuild the YYYY-MM key. */
    case 'period':
      return periodOf_(value);
    case 'json': {
      if (value && typeof value === 'object' && !(value instanceof Date)) return value;
      if (!value) return {};
      try {
        var parsed = JSON.parse(String(value));
        return parsed && typeof parsed === 'object' ? parsed : {};
      } catch (err) {
        return {};
      }
    }
    /* Like 'json', but the empty cell coerces to [] rather than {}.
       That difference is not cosmetic: the client calls .map() on this value,
       and an object arriving where an array was declared is an unhandled
       TypeError that unmounts the whole React tree. 'json' answers {} for an
       empty cell, which is right for a map like customVars and wrong for a
       list, so a list gets its own type rather than a normaliser bolted onto
       every handler that returns one. */
    case 'jsonlist': {
      if (Object.prototype.toString.call(value) === '[object Array]') return value;
      if (!value) return [];
      try {
        var list = JSON.parse(String(value));
        return Object.prototype.toString.call(list) === '[object Array]' ? list : [];
      } catch (err) {
        return [];
      }
    }
    case 'list': {
      if (Object.prototype.toString.call(value) === '[object Array]') {
        return value.map(function (v) { return String(v).trim(); }).filter(String);
      }
      if (!value) return [];
      return String(value)
        .split(/[|,]/)
        .map(function (s) { return s.trim(); })
        .filter(String);
    }
    default: {
      if (value === null || value === undefined) return '';
      if (value instanceof Date) return value.toISOString();
      return String(value);
    }
  }
}

function serialize_(value, type) {
  if (value === null || value === undefined) {
    return type === 'number' ? 0 : type === 'boolean' ? false : '';
  }
  switch (type) {
    case 'number': {
      var n = Number(value);
      return isFinite(n) ? n : 0;
    }
    case 'boolean':
      return Boolean(value);
    case 'json':
      return JSON.stringify(value || {});
    case 'jsonlist':
      return JSON.stringify(
        Object.prototype.toString.call(value) === '[object Array]' ? value : []
      );
    case 'list':
      return Object.prototype.toString.call(value) === '[object Array]'
        ? value.join(', ')
        : String(value);
    /* Leading apostrophe stops Sheets re-parsing the date into a serial number. */
    case 'datekey':
    case 'period':
      return value ? "'" + String(value) : '';
    default:
      return String(value);
  }
}

/* =========================================================================
 * Errors & validation
 * ========================================================================= */

function apiError_(message, status, code) {
  var err = new Error(message);
  err.__status = status || 400;
  err.__code = code || 'ERROR';
  return err;
}

function bad_(message, code) {
  return apiError_(message, 400, code || 'VALIDATION_ERROR');
}

function str_(value, field, opts) {
  opts = opts || {};
  var required = opts.required !== false;
  var max = opts.max || 500;
  var s = value === null || value === undefined ? '' : String(value).trim();
  if (required && !s) throw bad_('"' + field + '" is required');
  if (s.length > max) throw bad_('"' + field + '" must be ' + max + ' characters or fewer');
  return s;
}

function num_(value, field, opts) {
  opts = opts || {};
  if (value === '' || value === null || value === undefined) {
    if (opts.required) throw bad_('"' + field + '" is required');
    return opts.fallback || 0;
  }
  var n = typeof value === 'number' ? value : Number(String(value).replace(/[, ]/g, ''));
  if (!isFinite(n)) throw bad_('"' + field + '" must be a number');
  if (opts.min !== undefined && n < opts.min) {
    throw bad_('"' + field + '" must be at least ' + opts.min);
  }
  if (opts.max !== undefined && n > opts.max) {
    throw bad_('"' + field + '" must be at most ' + opts.max);
  }
  return n;
}

function bool_(value, fallback) {
  if (value === undefined || value === null || value === '') return Boolean(fallback);
  if (typeof value === 'boolean') return value;
  var s = String(value).toLowerCase();
  return s === 'true' || s === '1' || s === 'yes';
}

function oneOf_(value, field, allowed, fallback) {
  var s = String(value === undefined || value === null ? '' : value).trim().toLowerCase();
  if (allowed.indexOf(s) !== -1) return s;
  if (fallback !== undefined && !s) return fallback;
  throw bad_('"' + field + '" must be one of: ' + allowed.join(', '));
}

function isoDate_(value, field, opts) {
  opts = opts || {};
  if (!value) {
    if (opts.required === false) return '';
    throw bad_('"' + field + '" is required');
  }
  if (value instanceof Date) return toDateKey_(value);
  var raw = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  var parsed = new Date(raw);
  if (isNaN(parsed.getTime())) throw bad_('"' + field + '" must be a valid date (YYYY-MM-DD)');
  return toDateKey_(parsed);
}

function periodKey_(value, field, fallback) {
  var raw = String(value === undefined || value === null ? '' : value).trim();
  if (!raw) {
    if (fallback) return fallback;
    throw bad_('"' + (field || 'period') + '" is required (YYYY-MM)');
  }
  if (!/^\d{4}-\d{2}$/.test(raw)) throw bad_('"' + (field || 'period') + '" must look like YYYY-MM');
  return raw;
}

function toDateKey_(date) {
  var y = date.getFullYear();
  var m = String(date.getMonth() + 1);
  var d = String(date.getDate());
  return y + '-' + (m.length < 2 ? '0' + m : m) + '-' + (d.length < 2 ? '0' + d : d);
}

function currentPeriod_() {
  return toDateKey_(new Date()).slice(0, 7);
}

/**
 * `dateKey` plus n calendar months, clamped to the target month's length.
 *
 * Naive arithmetic overflows: 31 Jan + 1 month lands on 3 Mar, because
 * `new Date(2026, 1, 31)` is February the 31st, which is March. An installment
 * plan started on the 31st would then skip a month entirely and pay twice in
 * another. Day 0 of the following month is the last day of the target month,
 * which gives the clamp. Same rule advanceDueDate_() uses for subscriptions.
 */
function addMonths_(dateKey, months) {
  var parts = String(dateKey || '').split('-');
  var year = Number(parts[0]);
  var monthIndex = Number(parts[1]) - 1;
  var day = Number(parts[2]);
  if (!isFinite(year) || !isFinite(monthIndex) || !isFinite(day)) {
    throw bad_('Cannot shift an invalid date: "' + dateKey + '"');
  }

  var target = monthIndex + Math.round(Number(months) || 0);
  var targetYear = year + Math.floor(target / 12);
  var targetMonth = ((target % 12) + 12) % 12;
  var lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();

  return toDateKey_(new Date(targetYear, targetMonth, Math.min(day, lastDay)));
}

/**
 * Normalises anything that has ever represented a month into a YYYY-MM key.
 *
 * Handles the three shapes a Period cell can arrive in:
 *   "2026-08"                  already correct
 *   Date(2026-08-01)           Sheets parsed the text as a date on write
 *   "2026-07-31T17:00:00.000Z" that Date read back through String coercion,
 *                              where UTC has already shifted it a month back
 *
 * Local getters are used throughout, so GMT+7 stays in August.
 */
function periodOf_(value) {
  if (value instanceof Date) return toDateKey_(value).slice(0, 7);
  if (value === null || value === undefined) return '';
  var raw = String(value).trim();
  if (!raw) return '';
  if (/^\d{4}-\d{2}$/.test(raw)) return raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw.slice(0, 7);
  var parsed = new Date(raw);
  return isNaN(parsed.getTime()) ? raw : toDateKey_(parsed).slice(0, 7);
}

function shiftPeriod_(period, delta) {
  var parts = period.split('-');
  var date = new Date(Number(parts[0]), Number(parts[1]) - 1 + delta, 1);
  var m = String(date.getMonth() + 1);
  return date.getFullYear() + '-' + (m.length < 2 ? '0' + m : m);
}

function money_(value) {
  return Math.round((value + Number.EPSILON) * 100) / 100;
}

function uuid_() {
  return Utilities.getUuid();
}

/* =========================================================================
 * Auth
 * ========================================================================= */

function scriptProperty_(name, required) {
  var value = PropertiesService.getScriptProperties().getProperty(name);
  if (!value && required) {
    throw apiError_(
      'Script Property "' + name + '" is not set — see the deployment notes at the top of Code.gs',
      500,
      'CONFIG_MISSING'
    );
  }
  return value || '';
}

function bytesToHex_(bytes) {
  var out = '';
  for (var i = 0; i < bytes.length; i += 1) {
    var b = (bytes[i] + 256) % 256;
    out += (b < 16 ? '0' : '') + b.toString(16);
  }
  return out;
}

function hexToBytes_(hex) {
  var bytes = [];
  for (var i = 0; i < hex.length; i += 2) {
    var b = parseInt(hex.substr(i, 2), 16);
    bytes.push(b > 127 ? b - 256 : b);
  }
  return bytes;
}

/**
 * PBKDF2-ish key derivation: iterated HMAC-SHA256.
 *
 * Apps Script has no scrypt/bcrypt, so this is the strongest primitive
 * available. It is materially weaker than the Node backend's scrypt — see the
 * migration note in the README.
 */
function derive_(password, saltHex, iterations) {
  var saltBytes = hexToBytes_(saltHex);
  var bytes = Utilities.computeHmacSha256Signature(
    Utilities.newBlob(String(password)).getBytes(),
    saltBytes
  );
  for (var i = 1; i < iterations; i += 1) {
    bytes = Utilities.computeHmacSha256Signature(bytes, saltBytes);
  }
  return bytesToHex_(bytes);
}

function makeSalt_() {
  var bytes = [];
  for (var i = 0; i < 16; i += 1) bytes.push(Math.floor(Math.random() * 256) - 128);
  return bytesToHex_(bytes);
}

/** Stored as: pbkdf2-sha256$<iterations>$<saltHex>$<hashHex> */
function hashPassword_(password) {
  var salt = makeSalt_();
  var hash = derive_(password, salt, PBKDF2_ITERATIONS);
  return { salt: salt, stored: 'pbkdf2-sha256$' + PBKDF2_ITERATIONS + '$' + salt + '$' + hash };
}

function verifyPassword_(password, stored) {
  var parts = String(stored || '').split('$');
  if (parts.length !== 4 || parts[0] !== 'pbkdf2-sha256') {
    // A hash from the old Node backend (raw scrypt hex) — unverifiable here.
    throw apiError_(
      'This account still uses the old backend\'s password format. Reset it once with the auth.resetPassword action (see README), then sign in again.',
      409,
      'PASSWORD_MIGRATION_REQUIRED'
    );
  }
  var iterations = Number(parts[1]) || PBKDF2_ITERATIONS;
  var actual = derive_(password, parts[2], iterations);
  return timingSafeEqual_(actual, parts[3]);
}

function timingSafeEqual_(a, b) {
  if (a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function sign_(payload) {
  var secret = scriptProperty_('SESSION_SECRET', true);
  return Utilities.base64EncodeWebSafe(
    Utilities.computeHmacSha256Signature(payload, secret)
  ).replace(/=+$/, '');
}

function issueToken_(userId) {
  var payload = userId + '.' + (Date.now() + TOKEN_TTL_MS);
  return Utilities.base64EncodeWebSafe(payload).replace(/=+$/, '') + '.' + sign_(payload);
}

function requireAuth_(token) {
  if (!token) throw apiError_('Missing session token', 401, 'UNAUTHORIZED');

  var parts = String(token).split('.');
  if (parts.length !== 2) throw apiError_('Malformed session token', 401, 'UNAUTHORIZED');

  var payload;
  try {
    payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  } catch (err) {
    throw apiError_('Malformed session token', 401, 'UNAUTHORIZED');
  }

  if (!timingSafeEqual_(sign_(payload), parts[1])) {
    throw apiError_('Session expired or invalid — please sign in again', 401, 'UNAUTHORIZED');
  }

  var split = payload.split('.');
  var userId = split[0];
  var expiry = Number(split[1]);
  if (!userId || !expiry || expiry < Date.now()) {
    throw apiError_('Session expired — please sign in again', 401, 'UNAUTHORIZED');
  }

  var user = findById_('Users', userId);
  if (!user || user.active === false) {
    throw apiError_('User no longer exists', 401, 'UNAUTHORIZED');
  }
  return user;
}

function publicUser_(user) {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt
  };
}

function defaultSettings_(userId) {
  return {
    userId: userId,
    theme: 'dark',
    accent: '#4f8cff',
    customVars: {},
    currency: 'USD',
    displayCurrency: '',
    fxRate: 1,
    fxRateUpdatedAt: '',
    locale: 'en-US',
    monthlyIncome: 0,
    categories: DEFAULT_CATEGORIES.slice(),
    updatedAt: new Date().toISOString(),
    customThemes: [],
    activeCustomThemeId: '',
    fontFamily: ''
  };
}

/* ---- auth actions ---- */

/**
 * Whether this workbook has any profile yet — and nothing else.
 *
 * This replaces an `auth.users` action that returned every active user's id,
 * username and display name. It runs before authentication, by necessity: the
 * sign-in screen has to know whether to show "create the first profile" or
 * "sign in". But that single bit is the entire legitimate need, and the old
 * shape handed anyone holding the /exec URL a complete list of who banks here,
 * plus half of every credential pair.
 *
 * So the answer is one boolean. Enumerating accounts is not something a finance
 * app should let an unauthenticated caller do, and the fix has to be here
 * rather than in the client — hiding the list in the UI would have left the
 * endpoint answering the same question to anyone who asked it directly.
 */
function authStatus_() {
  var count = readTable_('Users').filter(function (u) { return u.active !== false; }).length;
  return { needsSetup: count === 0 };
}

function authRegister_(body) {
  var username = str_(body.username, 'username', { max: 40 }).toLowerCase();
  var password = str_(body.password, 'password', { max: 200 });
  var displayName = str_(body.displayName, 'displayName', { required: false, max: 60 }) || username;

  if (!/^[a-z0-9._-]{2,40}$/.test(username)) {
    throw bad_('Username may only contain letters, numbers, dot, dash and underscore (2-40 chars)');
  }
  if (password.length < 4) throw bad_('Password must be at least 4 characters');

  var clash = readTable_('Users').filter(function (u) { return u.username === username; })[0];
  if (clash) throw apiError_('That username is already taken', 409, 'USERNAME_TAKEN');

  var hashed = hashPassword_(password);
  var user = {
    id: uuid_(),
    username: username,
    displayName: displayName,
    salt: hashed.salt,
    passwordHash: hashed.stored,
    active: true,
    createdAt: new Date().toISOString()
  };

  insertRow_('Users', user);
  insertRow_('Settings', defaultSettings_(user.id));
  insertRow_('Wallets', {
    id: uuid_(),
    userId: user.id,
    name: 'Cash',
    mode: 'expense',
    kind: 'cash',
    currency: 'USD',
    openingBalance: 0,
    color: '#4f8cff',
    icon: '💵',
    archived: false,
    note: 'Created automatically — rename or delete it any time.',
    createdAt: new Date().toISOString()
  });

  return { token: issueToken_(user.id), user: publicUser_(user) };
}

function authLogin_(body) {
  var username = str_(body.username, 'username', { max: 40 }).toLowerCase();
  var password = str_(body.password, 'password', { max: 200 });

  var user = readTable_('Users').filter(function (u) { return u.username === username; })[0];
  // Same message either way — no username enumeration on a public endpoint.
  if (!user || user.active === false) {
    throw apiError_('Incorrect username or password', 401, 'INVALID_CREDENTIALS');
  }
  if (!verifyPassword_(password, user.passwordHash)) {
    throw apiError_('Incorrect username or password', 401, 'INVALID_CREDENTIALS');
  }

  if (!findById_('Settings', user.id)) insertRow_('Settings', defaultSettings_(user.id));

  return { token: issueToken_(user.id), user: publicUser_(user) };
}

function authChangePassword_(user, body) {
  var current = str_(body.currentPassword, 'currentPassword', { max: 200 });
  var next = str_(body.newPassword, 'newPassword', { max: 200 });
  if (next.length < 4) throw bad_('New password must be at least 4 characters');

  if (!verifyPassword_(current, user.passwordHash)) {
    throw apiError_('Current password is incorrect', 401, 'INVALID_CREDENTIALS');
  }

  var hashed = hashPassword_(next);
  updateRow_('Users', user.id, { salt: hashed.salt, passwordHash: hashed.stored });
  return { ok: true };
}

/**
 * One-time migration escape hatch for accounts whose hashes came from the Node
 * backend. Guarded by ADMIN_SECRET because this endpoint is public.
 */
function authResetPassword_(body) {
  var secret = str_(body.adminSecret, 'adminSecret', { max: 200 });
  var expected = scriptProperty_('ADMIN_SECRET', true);
  if (!timingSafeEqual_(secret, expected)) {
    throw apiError_('Invalid admin secret', 403, 'FORBIDDEN');
  }

  var username = str_(body.username, 'username', { max: 40 }).toLowerCase();
  var newPassword = str_(body.newPassword, 'newPassword', { max: 200 });
  if (newPassword.length < 4) throw bad_('New password must be at least 4 characters');

  var user = readTable_('Users').filter(function (u) { return u.username === username; })[0];
  if (!user) throw apiError_('No such user', 404, 'NOT_FOUND');

  var hashed = hashPassword_(newPassword);
  updateRow_('Users', user.id, { salt: hashed.salt, passwordHash: hashed.stored });
  return { ok: true, username: username };
}

/* =========================================================================
 * Domain helpers (ported from the Node backend so results match exactly)
 * ========================================================================= */

function userRows_(sheetName, userId) {
  return readTable_(sheetName).filter(function (row) { return row.userId === userId; });
}

function inPeriod_(dateKey, period) {
  if (!dateKey || !period) return false;
  if (dateKey instanceof Date) return toDateKey_(dateKey).slice(0, 7) === period;
  return String(dateKey).slice(0, 7) === period;
}

/** Fetches one row by id and refuses it if it belongs to someone else. */
function ownedRow_(user, sheetName, query) {
  var id = str_(query.id, 'id');
  var row = findById_(sheetName, id);
  if (!row || row.userId !== user.id) {
    throw apiError_(sheetName + ' record not found', 404, 'NOT_FOUND');
  }
  var copy = {};
  for (var k in row) if (k !== '_row') copy[k] = row[k];
  return copy;
}

function ownedWallet_(userId, walletId, label) {
  var wallet = findById_('Wallets', walletId);
  if (!wallet || wallet.userId !== userId) {
    throw apiError_((label || 'Wallet') + ' not found', 404, 'WALLET_NOT_FOUND');
  }
  return wallet;
}

/**
 * 'CASH' or 'CREDIT' for any wallet row, including ones written before the
 * column existed.
 *
 * The fallback is what makes the upgrade seamless. An empty cell means the row
 * predates this feature, so it falls back to `kind`: a wallet the user had
 * already labelled "Credit card" becomes CREDIT without them touching it, and
 * everything else — every cash, bank, e-wallet, brokerage and other wallet in
 * every existing sheet — becomes CASH. No migration script, no dirty state.
 *
 * Investment wallets are always CASH here: they hold positions, and a
 * brokerage margin account is not something this app models.
 */
function walletType_(wallet) {
  if (!wallet) return 'CASH';
  var raw = String(wallet.type || '').trim().toUpperCase();
  if (raw === 'CREDIT' || raw === 'CASH') return raw;
  if (wallet.mode === 'investment') return 'CASH';
  return String(wallet.kind || '').toLowerCase() === 'credit' ? 'CREDIT' : 'CASH';
}

/**
 * Wallet balance = opening + income - expense + transfers in - transfers out,
 * then investment wallets additionally convert cash into holdings on buy and
 * back into cash on sell.
 *
 * Credit cards need no special case here, which is the point. A charge is an
 * expense, so it drives the balance negative; a bill payment is an ordinary
 * transfer from a cash wallet, so it drives it back toward zero. A credit
 * wallet's balance is therefore already "debt, expressed as a negative number"
 * with no new arithmetic — and because a transfer is neither income nor
 * expense, paying a card off never double-counts as spending.
 */
function computeWalletBalances_(userId, period) {
  var wallets = userRows_('Wallets', userId).slice().sort(function (a, b) {
    return String(a.name).localeCompare(String(b.name));
  });
  var transactions = userRows_('Transactions', userId);
  var investments = userRows_('Investments', userId);

  var byId = {};
  var ordered = [];
  wallets.forEach(function (wallet) {
    var entry = {
      id: wallet.id, userId: wallet.userId, name: wallet.name, mode: wallet.mode,
      kind: wallet.kind, currency: wallet.currency, openingBalance: wallet.openingBalance,
      color: wallet.color, icon: wallet.icon, archived: wallet.archived, note: wallet.note,
      createdAt: wallet.createdAt,
      type: walletType_(wallet),
      creditLimit: Number(wallet.creditLimit) || 0,
      statementDate: Number(wallet.statementDate) || 0,
      dueDate: Number(wallet.dueDate) || 0,
      cashbackRate: Number(wallet.cashbackRate) || 0,
      balance: wallet.openingBalance || 0,
      investedCost: 0, income: 0, expense: 0, transactionCount: 0
    };
    byId[wallet.id] = entry;
    ordered.push(entry);
  });

  transactions.forEach(function (tx) {
    var source = byId[tx.walletId];
    var target = byId[tx.toWalletId];
    var amount = Number(tx.amount) || 0;
    var counted = !period || inPeriod_(tx.date, period);

    if (tx.type === 'income') {
      if (!source) return;
      source.balance += amount;
      source.transactionCount += 1;
      if (counted) source.income += amount;
    } else if (tx.type === 'expense') {
      if (!source) return;
      source.balance -= amount;
      source.transactionCount += 1;
      if (counted) source.expense += amount;
    } else if (tx.type === 'transfer') {
      if (source) { source.balance -= amount; source.transactionCount += 1; }
      if (target) { target.balance += amount; target.transactionCount += 1; }
    }
  });

  investments.forEach(function (inv) {
    var wallet = byId[inv.walletId];
    if (!wallet) return;
    var quantity = Number(inv.quantity) || 0;
    var cost = quantity * (Number(inv.buyPrice) || 0) + (Number(inv.fees) || 0);
    if (inv.status === 'hold') {
      wallet.investedCost += cost;
      wallet.balance -= cost;
    } else {
      wallet.balance += quantity * (Number(inv.sellPrice) || 0) - cost;
    }
  });

  return ordered.map(function (w) {
    w.balance = money_(w.balance);
    w.investedCost = money_(w.investedCost);
    w.income = money_(w.income);
    w.expense = money_(w.expense);
    return w;
  });
}

function getSettingsRow_(userId) {
  var row = findById_('Settings', userId);
  if (!row) return null;
  if (!row.categories || !row.categories.length) row.categories = DEFAULT_CATEGORIES.slice();
  if (!(row.fxRate > 0)) row.fxRate = 1;
  return row;
}

function computeBudgetProgress_(userId, period) {
  var budgets = userRows_('Budgets', userId).filter(function (b) { return periodOf_(b.period) === period; });
  var transactions = userRows_('Transactions', userId).filter(function (t) {
    return inPeriod_(t.date, period);
  });
  var settings = getSettingsRow_(userId);

  var actualIncome = 0;
  var totalExpense = 0;
  transactions.forEach(function (t) {
    if (t.type === 'income') actualIncome += Number(t.amount) || 0;
    if (t.type === 'expense') totalExpense += Number(t.amount) || 0;
  });

  return budgets
    .map(function (budget) {
      // Preference order: explicit override -> Settings -> income recorded.
      var base = budget.baseIncome > 0
        ? budget.baseIncome
        : (settings && settings.monthlyIncome > 0 ? settings.monthlyIncome : actualIncome);

      var limit = budget.mode === 'percent'
        ? money_((base * budget.value) / 100)
        : money_(budget.value);

      var spent = 0;
      if (budget.scope === 'category') {
        transactions.forEach(function (t) {
          if (t.type === 'expense' &&
              String(t.category).trim().toLowerCase() === String(budget.targetId).trim().toLowerCase()) {
            spent += Number(t.amount) || 0;
          }
        });
      } else if (budget.scope === 'wallet') {
        transactions.forEach(function (t) {
          if (t.type === 'expense' &&
              String(t.walletId).trim() === String(budget.targetId).trim()) {
            spent += Number(t.amount) || 0;
          }
        });
      } else {
        spent = totalExpense;
      }

      spent = money_(spent);
      var percentUsed = limit > 0 ? money_((spent / limit) * 100) : (spent > 0 ? 100 : 0);

      return {
        id: budget.id, userId: budget.userId, period: periodOf_(budget.period), scope: budget.scope,
        targetId: budget.targetId, targetLabel: budget.targetLabel, mode: budget.mode,
        value: budget.value, baseIncome: budget.baseIncome, note: budget.note,
        createdAt: budget.createdAt,
        base: money_(base),
        limit: limit,
        spent: spent,
        remaining: money_(limit - spent),
        percentUsed: percentUsed,
        status: percentUsed >= 100 ? 'over' : (percentUsed >= 80 ? 'warning' : 'ok')
      };
    })
    .sort(function (a, b) { return b.percentUsed - a.percentUsed; });
}

/**
 * The identity of a *holding* — the thing a user thinks of as "my Apple
 * position" — as opposed to a lot, which is one purchase of it.
 *
 * Dollar-cost averaging means one holding is many rows: buy AAPL in January,
 * again in March, again in June. Those are three Investments rows and must
 * stay three rows (each has its own price, date and fees, and each is sold
 * independently), but every screen wants them presented as one line with a
 * blended average cost.
 *
 * The grouping key is computed here rather than on the client so that the
 * definition of "same position" lives in exactly one place. It is scoped to the
 * wallet as well as the symbol: the same ticker held in two brokerages is two
 * holdings, because selling one does not touch the other.
 */
function positionKey_(inv) {
  return String(inv.walletId || '') + '::' + String(inv.symbol || '').toUpperCase();
}

/** Adds the figures the client shouldn't recompute. Unrealised P&L needs a
 *  live price and stays on the client. */
function decorateInvestment_(inv) {
  var costBasis = money_(inv.quantity * inv.buyPrice + (inv.fees || 0));
  var realizedPnl = inv.status === 'sold'
    ? money_(inv.quantity * inv.sellPrice - costBasis)
    : 0;

  return {
    id: inv.id, userId: inv.userId, walletId: inv.walletId, symbol: inv.symbol,
    quantity: inv.quantity, buyPrice: inv.buyPrice, fees: inv.fees, buyDate: inv.buyDate,
    tags: inv.tags, status: inv.status, sellPrice: inv.sellPrice, sellDate: inv.sellDate,
    note: inv.note, createdAt: inv.createdAt,
    positionKey: positionKey_(inv),
    costBasis: costBasis,
    avgCost: inv.quantity > 0 ? money_(costBasis / inv.quantity) : 0,
    realizedPnl: realizedPnl,
    realizedPnlPercent:
      inv.status === 'sold' && costBasis > 0 ? money_((realizedPnl / costBasis) * 100) : 0,
    tagList: inv.tags
      ? String(inv.tags).split(',').map(function (t) { return t.trim(); }).filter(String)
      : []
  };
}

/* =========================================================================
 * Wallets
 * ========================================================================= */

var WALLET_MODES = ['expense', 'investment'];
var WALLET_KINDS = ['cash', 'bank', 'ewallet', 'credit', 'brokerage', 'other'];
/* Lowercase because oneOf_() lowercases what it is given before matching — an
   uppercase list here would reject the very values the client sends. The stored
   and returned form is uppercase, which walletTypeIn_() below restores. */
var WALLET_TYPES = ['cash', 'credit'];

/** Validates a `type` from a request body and returns it in its stored form. */
function walletTypeIn_(value) {
  return oneOf_(value, 'type', WALLET_TYPES, 'cash').toUpperCase();
}

/**
 * Validates the credit-card half of a wallet payload and returns the fields to
 * write, with `type` and `kind` reconciled.
 *
 * `resolvedType` is the type the wallet will have once this write lands, which
 * is not always what the body says: an update that only sets `creditLimit` has
 * to be judged against the type already on the row.
 *
 * Billing days are stored as given, including 29-31. Clamping them here would
 * lose the user's intent — a card that closes on the 31st should close on the
 * 28th in February and back on the 31st in March — so the clamp happens where
 * a concrete month is known, in cycleDayInMonth() on the client.
 */
function creditFieldsPatch_(body, resolvedType) {
  var patch = {};

  if (resolvedType === 'CASH') {
    // Switching a card back to cash: clear the billing profile rather than
    // leaving a limit and a due date on a wallet that has neither.
    patch.creditLimit = 0;
    patch.statementDate = 0;
    patch.dueDate = 0;
    patch.cashbackRate = 0;
    return patch;
  }

  if (body.creditLimit !== undefined) {
    patch.creditLimit = num_(body.creditLimit, 'creditLimit', { min: 0 });
  }
  if (body.statementDate !== undefined) {
    patch.statementDate = Math.round(num_(body.statementDate, 'statementDate', { min: 0, max: 31 }));
  }
  if (body.dueDate !== undefined) {
    patch.dueDate = Math.round(num_(body.dueDate, 'dueDate', { min: 0, max: 31 }));
  }
  if (body.cashbackRate !== undefined) {
    patch.cashbackRate = num_(body.cashbackRate, 'cashbackRate', { min: 0, max: 100 });
  }

  return patch;
}

function walletsList_(user, query) {
  var includeArchived = bool_(query.includeArchived, false);
  return computeWalletBalances_(user.id).filter(function (w) {
    return includeArchived || !w.archived;
  });
}

function walletsGet_(user, query) {
  var id = str_(query.id, 'id');
  ownedWallet_(user.id, id);
  return computeWalletBalances_(user.id).filter(function (w) { return w.id === id; })[0];
}

function walletsCreate_(user, body) {
  var name = str_(body.name, 'name', { max: 60 });

  var duplicate = userRows_('Wallets', user.id).filter(function (w) {
    return !w.archived && String(w.name).toLowerCase() === name.toLowerCase();
  })[0];
  if (duplicate) throw bad_('You already have a wallet called "' + name + '"', 'DUPLICATE_WALLET');

  var mode = oneOf_(body.mode, 'mode', WALLET_MODES, 'expense');
  var kind = oneOf_(body.kind, 'kind', WALLET_KINDS, mode === 'investment' ? 'brokerage' : 'cash');

  /* Either field can declare the card, so both are consulted and then made to
     agree. Picking a "Credit card" kind in the existing form is enough to get
     a CREDIT wallet, which is what a user who has never seen the new field
     will do. An investment wallet is never CREDIT. */
  var type = mode === 'investment'
    ? 'CASH'
    : (kind === 'credit' || walletTypeIn_(body.type) === 'CREDIT') ? 'CREDIT' : 'CASH';
  if (type === 'CREDIT') kind = 'credit';

  var wallet = {
    id: uuid_(),
    userId: user.id,
    name: name,
    mode: mode,
    kind: kind,
    currency: (str_(body.currency, 'currency', { required: false, max: 8 }) || 'USD').toUpperCase(),
    openingBalance: num_(body.openingBalance, 'openingBalance', {}),
    color: str_(body.color, 'color', { required: false, max: 20 }) || '#4f8cff',
    icon: str_(body.icon, 'icon', { required: false, max: 8 }) ||
      (mode === 'investment' ? '📈' : '💳'),
    archived: false,
    note: str_(body.note, 'note', { required: false, max: 300 }),
    createdAt: new Date().toISOString(),
    type: type,
    creditLimit: 0,
    statementDate: 0,
    dueDate: 0,
    cashbackRate: 0
  };

  var credit = creditFieldsPatch_(body, type);
  for (var field in credit) wallet[field] = credit[field];

  insertRow_('Wallets', wallet);
  return wallet;
}

function walletsUpdate_(user, query, body) {
  var existing = ownedWallet_(user.id, str_(query.id, 'id'));
  var patch = {};

  if (body.name !== undefined) patch.name = str_(body.name, 'name', { max: 60 });
  if (body.kind !== undefined) patch.kind = oneOf_(body.kind, 'kind', WALLET_KINDS);
  if (body.currency !== undefined) {
    patch.currency = str_(body.currency, 'currency', { max: 8 }).toUpperCase();
  }
  if (body.openingBalance !== undefined) {
    patch.openingBalance = num_(body.openingBalance, 'openingBalance', {});
  }
  if (body.color !== undefined) patch.color = str_(body.color, 'color', { max: 20 });
  if (body.icon !== undefined) patch.icon = str_(body.icon, 'icon', { required: false, max: 8 });
  if (body.note !== undefined) patch.note = str_(body.note, 'note', { required: false, max: 300 });
  if (body.archived !== undefined) patch.archived = bool_(body.archived);

  /* ---- Cash <-> credit ----
     Unlike `mode` below this is not locked once the wallet has records, and
     deliberately so: someone who recorded a card as a plain bank wallet for six
     months needs to be able to say what it really is without deleting the
     history. The switch is safe because it changes no arithmetic — a credit
     balance is the same "opening + income - expense +/- transfers" figure a
     cash wallet has, only usually negative. All that changes is how the UI
     reads and labels it.

     Setting kind:'credit' through the existing wallet form implies the type,
     and vice versa, so the two can never disagree on the row. */
  /* Read from `body`, not `patch`: the mode block below runs after this one
     (it has to, because it can throw) so `patch.mode` is not set yet. */
  var resolvedMode = body.mode !== undefined
    ? oneOf_(body.mode, 'mode', WALLET_MODES)
    : existing.mode;
  var resolvedType = walletType_(existing);

  if (body.type !== undefined) {
    resolvedType = walletTypeIn_(body.type);
  } else if (patch.kind !== undefined) {
    resolvedType = patch.kind === 'credit' ? 'CREDIT' : 'CASH';
  }
  if (resolvedMode === 'investment') resolvedType = 'CASH';

  if (resolvedType !== walletType_(existing) || body.type !== undefined) {
    patch.type = resolvedType;
    if (resolvedType === 'CREDIT') patch.kind = 'credit';
    else if (patch.kind === undefined && existing.kind === 'credit') patch.kind = 'bank';
  }

  var credit = creditFieldsPatch_(body, resolvedType);
  for (var field in credit) patch[field] = credit[field];

  // Switching modes would strand existing rows, so only allow it while empty.
  if (body.mode !== undefined) {
    var mode = oneOf_(body.mode, 'mode', WALLET_MODES);
    if (mode !== existing.mode) {
      var hasTx = readTable_('Transactions').filter(function (t) {
        return t.walletId === existing.id || t.toWalletId === existing.id;
      }).length;
      var hasInv = readTable_('Investments').filter(function (i) {
        return i.walletId === existing.id;
      }).length;
      if (hasTx || hasInv) {
        throw bad_('Cannot change the mode of a wallet that already has records', 'MODE_LOCKED');
      }
      patch.mode = mode;
    }
  }

  var updated = updateRow_('Wallets', existing.id, patch);
  delete updated._row;
  // Never hand back an empty `type` — a legacy row that this edit did not touch
  // still has one, and the client should not have to re-derive it.
  updated.type = walletType_(updated);
  return updated;
}

function walletsDelete_(user, query) {
  var wallet = ownedWallet_(user.id, str_(query.id, 'id'));
  var cascade = bool_(query.cascade, false);

  var linkedTx = userRows_('Transactions', user.id).filter(function (t) {
    return t.walletId === wallet.id || t.toWalletId === wallet.id;
  });
  var linkedInv = userRows_('Investments', user.id).filter(function (i) {
    return i.walletId === wallet.id;
  });

  if ((linkedTx.length || linkedInv.length) && !cascade) {
    throw apiError_(
      '"' + wallet.name + '" still has ' + linkedTx.length + ' transaction(s) and ' +
        linkedInv.length + ' investment(s). Archive it instead, or delete with cascade=true.',
      409,
      'WALLET_NOT_EMPTY'
    );
  }

  if (cascade) {
    deleteWhere_('Transactions', function (t) {
      return t.userId === user.id && (t.walletId === wallet.id || t.toWalletId === wallet.id);
    });
    deleteWhere_('Investments', function (i) {
      return i.userId === user.id && i.walletId === wallet.id;
    });
    deleteWhere_('Budgets', function (b) {
      return b.userId === user.id && b.scope === 'wallet' && b.targetId === wallet.id;
    });
  }

  deleteRow_('Wallets', wallet.id);
  return {
    ok: true,
    removedTransactions: cascade ? linkedTx.length : 0,
    removedInvestments: cascade ? linkedInv.length : 0
  };
}

/* =========================================================================
 * Transactions
 * ========================================================================= */

var TX_TYPES = ['income', 'expense', 'transfer'];

function parseTransaction_(userId, body) {
  var type = oneOf_(body.type, 'type', TX_TYPES);
  var amount = num_(body.amount, 'amount', { min: 0 });
  if (amount <= 0) throw bad_('"amount" must be greater than zero');

  var walletId = str_(body.walletId, 'walletId');
  var source = ownedWallet_(userId, walletId, 'Source wallet');

  if (source.mode === 'investment' && type !== 'transfer') {
    throw bad_(
      'Investment wallets hold positions, not income/expense rows. Use a transfer to move cash in or out.',
      'WRONG_WALLET_MODE'
    );
  }

  var toWalletId = '';
  if (type === 'transfer') {
    toWalletId = str_(body.toWalletId, 'toWalletId');
    if (toWalletId === walletId) throw bad_('A transfer needs two different wallets', 'SAME_WALLET');
    ownedWallet_(userId, toWalletId, 'Destination wallet');
  }

  return {
    walletId: walletId,
    toWalletId: toWalletId,
    type: type,
    amount: amount,
    category: type === 'transfer' ? 'Transfer' : str_(body.category, 'category', { max: 60 }),
    note: str_(body.note, 'note', { required: false, max: 300 }),
    date: isoDate_(body.date || toDateKey_(new Date()), 'date'),
    /* Carried through rather than validated into existence. transactionsUpdate_
       re-parses the merged row, so dropping these here would silently strip a
       chunk out of its plan the first time someone corrected its note. */
    installmentGroupId: str_(body.installmentGroupId, 'installmentGroupId', {
      required: false, max: 60
    }),
    installmentIndex: str_(body.installmentIndex, 'installmentIndex', { required: false, max: 12 })
  };
}

function transactionsList_(user, query) {
  var rows = userRows_('Transactions', user.id);
  var limit = Math.min(Number(query.limit) || 500, 5000);

  if (query.walletId) {
    rows = rows.filter(function (t) {
      return t.walletId === query.walletId || t.toWalletId === query.walletId;
    });
  }
  if (query.type) rows = rows.filter(function (t) { return t.type === query.type; });
  if (query.category) {
    rows = rows.filter(function (t) {
      return String(t.category).toLowerCase() === String(query.category).toLowerCase();
    });
  }
  if (query.period) rows = rows.filter(function (t) { return t.date.slice(0, 7) === query.period; });
  if (query.from) rows = rows.filter(function (t) { return t.date >= query.from; });
  if (query.to) rows = rows.filter(function (t) { return t.date <= query.to; });
  if (query.search) {
    var needle = String(query.search).toLowerCase();
    rows = rows.filter(function (t) {
      return String(t.note).toLowerCase().indexOf(needle) !== -1 ||
        String(t.category).toLowerCase().indexOf(needle) !== -1;
    });
  }

  rows.sort(function (a, b) {
    return String(b.date + b.createdAt).localeCompare(String(a.date + a.createdAt));
  });

  return rows.slice(0, limit).map(function (r) {
    var copy = {};
    for (var k in r) if (k !== '_row') copy[k] = r[k];
    return copy;
  });
}

function transactionsCreate_(user, body) {
  var parsed = parseTransaction_(user.id, body);
  var tx = {
    id: uuid_(), userId: user.id,
    walletId: parsed.walletId, toWalletId: parsed.toWalletId, type: parsed.type,
    amount: parsed.amount, category: parsed.category, note: parsed.note, date: parsed.date,
    createdAt: new Date().toISOString(),
    installmentGroupId: parsed.installmentGroupId,
    installmentIndex: parsed.installmentIndex
  };
  insertRow_('Transactions', tx);
  return tx;
}

/* -------------------------------------------------------------------------
 * 0% installment plans
 * -------------------------------------------------------------------------
 * WHY REAL ROWS AND NOT A PROJECTION
 * -------------------------------------------------------------------------
 * The alternative was to store one row for the purchase and expand the monthly
 * chunks in the UI. That loses in three places at once:
 *
 *   - the current month's expense total would carry the whole ฿30,000 iPhone,
 *     which is exactly what the feature exists to avoid, and every consumer of
 *     `monthExpense` — budgets, the trend chart, the savings estimate, the
 *     Sankey — would each need to learn about installments to undo it
 *   - a projection is invisible in the sheet, and the sheet is the database
 *     the user actually opens
 *   - editing or deleting one chunk (banks do move them) has nowhere to write
 *
 * As n real rows, none of that is special-cased. Each chunk is an ordinary
 * expense in its own month, so every existing aggregate is right for free. The
 * card's balance sums rows without a date filter, so it shows the full amount
 * still owed the day the plan starts — which is what you owe the bank.
 *
 * Rounding lands on the FIRST chunk, not the last: ฿10,000 over 3 months is
 * 3,333.34 + 3,333.33 + 3,333.33. Banks front-load the odd satang, and a user
 * reconciling against a real statement compares the first line, not the last.
 */
var MAX_INSTALLMENT_MONTHS = 60;

function transactionsCreateInstallment_(user, body) {
  var months = Math.round(num_(body.months, 'months', { min: 1, max: MAX_INSTALLMENT_MONTHS }));
  var total = num_(body.amount, 'amount', { min: 0 });
  if (total <= 0) throw bad_('"amount" must be greater than zero');

  // Validated as one ordinary transaction first, so a plan can never create
  // rows a single create would have rejected.
  var parsed = parseTransaction_(user.id, {
    type: 'expense',
    amount: total,
    walletId: body.walletId,
    category: body.category,
    note: body.note,
    date: body.date
  });

  if (months === 1) {
    /* Not a plan. Writing a one-row group would leave "1/1" rows in the sheet
       that mean nothing and that the UI would have to filter back out.

       Built from `parsed` rather than forwarded as `body`, which carries a
       `months` field and no `type` — transactionsCreate_ would re-parse it and
       reject it for the missing type. */
    var single = transactionsCreate_(user, {
      type: 'expense',
      walletId: parsed.walletId,
      amount: parsed.amount,
      category: parsed.category,
      note: parsed.note,
      date: parsed.date
    });
    return { groupId: '', months: 1, monthly: money_(total), total: money_(total), transactions: [single] };
  }

  var groupId = uuid_();
  var createdAt = new Date().toISOString();

  // Split so the chunks sum to the total exactly, whatever the division does.
  var base = money_(Math.floor((total * 100) / months) / 100);
  var remainder = money_(total - base * months);

  var rows = [];
  for (var i = 0; i < months; i += 1) {
    rows.push({
      id: uuid_(),
      userId: user.id,
      walletId: parsed.walletId,
      toWalletId: '',
      type: 'expense',
      amount: i === 0 ? money_(base + remainder) : base,
      category: parsed.category,
      note: parsed.note,
      date: addMonths_(parsed.date, i),
      createdAt: createdAt,
      installmentGroupId: groupId,
      installmentIndex: (i + 1) + '/' + months
    });
  }

  insertRows_('Transactions', rows);

  return {
    groupId: groupId,
    months: months,
    monthly: base,
    total: money_(total),
    transactions: rows
  };
}

/**
 * Deletes every chunk of a plan in one call.
 *
 * Without this, cancelling a ten-month plan is ten round trips through the
 * generic delete, each taking the script lock, and a failure halfway leaves a
 * half-cancelled plan.
 */
function transactionsDeleteInstallment_(user, query) {
  var groupId = str_(query.groupId || query.id, 'groupId');
  var removed = deleteWhere_('Transactions', function (t) {
    return t.userId === user.id && t.installmentGroupId === groupId;
  });
  if (!removed) throw apiError_('Installment plan not found', 404, 'NOT_FOUND');
  return { ok: true, removed: removed, groupId: groupId };
}

function transactionsUpdate_(user, query, body) {
  var id = str_(query.id, 'id');
  var existing = findById_('Transactions', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Transaction not found', 404, 'NOT_FOUND');
  }

  // Re-validate the merged row so a partial edit can't produce an invalid combo.
  var merged = {};
  for (var k in existing) if (k !== '_row') merged[k] = existing[k];
  for (var j in body) merged[j] = body[j];

  var parsed = parseTransaction_(user.id, merged);
  var updated = updateRow_('Transactions', id, parsed);
  delete updated._row;
  return updated;
}

function transactionsDelete_(user, query) {
  var id = str_(query.id, 'id');
  var existing = findById_('Transactions', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Transaction not found', 404, 'NOT_FOUND');
  }
  deleteRow_('Transactions', id);
  return { ok: true };
}

/* =========================================================================
 * Investments
 * ========================================================================= */

var INVESTMENT_STATUSES = ['hold', 'sold'];

function normalizeTags_(value) {
  var raw = Object.prototype.toString.call(value) === '[object Array]'
    ? value.join(',')
    : String(value === undefined || value === null ? '' : value);

  var seen = {};
  var tags = [];
  raw.split(',').forEach(function (t) {
    var tag = t.trim();
    if (!tag || seen[tag.toLowerCase()]) return;
    seen[tag.toLowerCase()] = true;
    tags.push(tag);
  });
  return tags.slice(0, 12).join(', ');
}

function parseInvestment_(userId, body) {
  var walletId = str_(body.walletId, 'walletId');
  var wallet = ownedWallet_(userId, walletId);
  if (wallet.mode !== 'investment') {
    throw bad_('Positions can only be added to an investment-mode wallet', 'WRONG_WALLET_MODE');
  }

  var status = oneOf_(body.status, 'status', INVESTMENT_STATUSES, 'hold');
  var sellPrice = num_(body.sellPrice, 'sellPrice', { min: 0 });
  if (status === 'sold' && sellPrice <= 0) {
    throw bad_('A sold position needs a sell price', 'MISSING_SELL_PRICE');
  }

  // No artificial precision floor — fractional shares and 8-decimal crypto both
  // matter. Any positive quantity is accepted.
  var quantity = num_(body.quantity, 'quantity', { min: 0 });
  if (quantity <= 0) throw bad_('"quantity" must be greater than zero');

  return {
    walletId: walletId,
    symbol: str_(body.symbol, 'symbol', { max: 20 }).toUpperCase(),
    quantity: quantity,
    buyPrice: num_(body.buyPrice, 'buyPrice', { min: 0 }),
    fees: num_(body.fees, 'fees', { min: 0 }),
    buyDate: isoDate_(body.buyDate || toDateKey_(new Date()), 'buyDate'),
    tags: normalizeTags_(body.tags),
    status: status,
    sellPrice: sellPrice,
    sellDate: status === 'sold'
      ? isoDate_(body.sellDate || toDateKey_(new Date()), 'sellDate')
      : '',
    note: str_(body.note, 'note', { required: false, max: 300 })
  };
}

/**
 * Every lot, never aggregated.
 *
 * Grouping into holdings deliberately stays on the client: a holding's headline
 * figures (market value, unrealised P&L) need a live quote, and this script has
 * no price feed. Aggregating cost basis here and P&L there would put the two
 * halves of the same number in two places — the mistake `computeWalletBalances_`
 * exists to avoid. The server owns the grouping *key* (`positionKey`) and the
 * per-lot maths; the client owns the roll-up. See `lib/positions.ts`.
 */
function investmentsList_(user, query) {
  var rows = userRows_('Investments', user.id);

  // `?positionKey=<walletId>::<SYMBOL>` fetches one holding's lots — the
  // purchase-history view, without pulling the whole portfolio.
  if (query.positionKey) {
    rows = rows.filter(function (i) { return positionKey_(i) === String(query.positionKey); });
  }

  if (query.walletId) rows = rows.filter(function (i) { return i.walletId === query.walletId; });
  if (query.status) rows = rows.filter(function (i) { return i.status === query.status; });
  if (query.symbol) {
    rows = rows.filter(function (i) {
      return String(i.symbol).toUpperCase() === String(query.symbol).toUpperCase();
    });
  }
  if (query.tag) {
    var needle = String(query.tag).toLowerCase();
    rows = rows.filter(function (i) {
      return String(i.tags).split(',').map(function (t) {
        return t.trim().toLowerCase();
      }).indexOf(needle) !== -1;
    });
  }

  rows.sort(function (a, b) {
    return String(b.buyDate + b.createdAt).localeCompare(String(a.buyDate + a.createdAt));
  });

  return rows.map(decorateInvestment_);
}

function investmentsSymbols_(user) {
  var seen = {};
  var symbols = [];
  userRows_('Investments', user.id).forEach(function (i) {
    if (i.status !== 'hold') return;
    var symbol = String(i.symbol).toUpperCase();
    if (!symbol || seen[symbol]) return;
    seen[symbol] = true;
    symbols.push(symbol);
  });
  return symbols.sort();
}

function investmentsCreate_(user, body) {
  var parsed = parseInvestment_(user.id, body);
  var investment = {
    id: uuid_(), userId: user.id,
    walletId: parsed.walletId, symbol: parsed.symbol, quantity: parsed.quantity,
    buyPrice: parsed.buyPrice, fees: parsed.fees, buyDate: parsed.buyDate, tags: parsed.tags,
    status: parsed.status, sellPrice: parsed.sellPrice, sellDate: parsed.sellDate,
    note: parsed.note, createdAt: new Date().toISOString()
  };
  insertRow_('Investments', investment);
  return decorateInvestment_(investment);
}

function investmentsUpdate_(user, query, body) {
  var id = str_(query.id, 'id');
  var existing = findById_('Investments', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Investment not found', 404, 'NOT_FOUND');
  }

  var merged = {};
  for (var k in existing) if (k !== '_row') merged[k] = existing[k];
  for (var j in body) merged[j] = body[j];

  var parsed = parseInvestment_(user.id, merged);
  var updated = updateRow_('Investments', id, parsed);
  delete updated._row;
  return decorateInvestment_(updated);
}

function investmentsSell_(user, query, body) {
  var id = str_(query.id, 'id');
  var existing = findById_('Investments', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Investment not found', 404, 'NOT_FOUND');
  }
  if (existing.status === 'sold') throw bad_('This position is already marked as sold', 'ALREADY_SOLD');

  var updated = updateRow_('Investments', id, {
    status: 'sold',
    sellPrice: num_(body.sellPrice, 'sellPrice', { min: 0, required: true }),
    sellDate: isoDate_(body.sellDate || toDateKey_(new Date()), 'sellDate')
  });
  delete updated._row;
  return decorateInvestment_(updated);
}

function investmentsDelete_(user, query) {
  var id = str_(query.id, 'id');
  var existing = findById_('Investments', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Investment not found', 404, 'NOT_FOUND');
  }
  deleteRow_('Investments', id);
  return { ok: true };
}

/* =========================================================================
 * Budgets
 * ========================================================================= */

var BUDGET_SCOPES = ['category', 'wallet', 'global'];
var BUDGET_MODES = ['amount', 'percent'];

function parseBudget_(userId, body) {
  var scope = oneOf_(body.scope, 'scope', BUDGET_SCOPES, 'category');
  var mode = oneOf_(body.mode, 'mode', BUDGET_MODES, 'amount');
  var value = num_(body.value, 'value', { min: 0, max: mode === 'percent' ? 100 : undefined });

  var targetId = '';
  var targetLabel = '';

  if (scope === 'category') {
    targetId = str_(body.targetId, 'targetId', { max: 60 });
    targetLabel = targetId;
  } else if (scope === 'wallet') {
    targetId = str_(body.targetId, 'targetId');
    targetLabel = ownedWallet_(userId, targetId).name;
  } else {
    targetLabel = 'All spending';
  }

  return {
    period: periodKey_(body.period, 'period', currentPeriod_()),
    scope: scope,
    targetId: targetId,
    targetLabel: targetLabel,
    mode: mode,
    value: value,
    baseIncome: num_(body.baseIncome, 'baseIncome', { min: 0 }),
    note: str_(body.note, 'note', { required: false, max: 300 })
  };
}

function budgetsList_(user, query) {
  var period = periodKey_(query.period, 'period', currentPeriod_());
  var progress = computeBudgetProgress_(user.id, period);

  var percentAllocated = 0;
  var limit = 0;
  var spent = 0;
  progress.forEach(function (b) {
    if (b.mode === 'percent') percentAllocated += b.value;
    limit += b.limit;
    spent += b.spent;
  });

  return {
    period: period,
    budgets: progress,
    totals: {
      limit: limit,
      spent: spent,
      percentAllocated: percentAllocated,
      percentUnallocated: Math.max(0, 100 - percentAllocated)
    }
  };
}

function budgetsCreate_(user, body) {
  var parsed = parseBudget_(user.id, body);

  var clash = userRows_('Budgets', user.id).filter(function (b) {
    return periodOf_(b.period) === parsed.period && b.scope === parsed.scope &&
      String(b.targetId).toLowerCase() === String(parsed.targetId).toLowerCase();
  })[0];
  if (clash) {
    throw bad_(
      'A ' + parsed.scope + ' budget for "' + (parsed.targetLabel || parsed.period) +
        '" already exists this period — edit it instead.',
      'DUPLICATE_BUDGET'
    );
  }

  var budget = {
    id: uuid_(), userId: user.id,
    period: parsed.period, scope: parsed.scope, targetId: parsed.targetId,
    targetLabel: parsed.targetLabel, mode: parsed.mode, value: parsed.value,
    baseIncome: parsed.baseIncome, note: parsed.note,
    createdAt: new Date().toISOString()
  };
  insertRow_('Budgets', budget);
  return budget;
}

function budgetsUpdate_(user, query, body) {
  var id = str_(query.id, 'id');
  var existing = findById_('Budgets', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Budget not found', 404, 'NOT_FOUND');
  }

  var merged = {};
  for (var k in existing) if (k !== '_row') merged[k] = existing[k];
  for (var j in body) merged[j] = body[j];

  var updated = updateRow_('Budgets', id, parseBudget_(user.id, merged));
  delete updated._row;
  return updated;
}

function budgetsDelete_(user, query) {
  var id = str_(query.id, 'id');
  var existing = findById_('Budgets', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Budget not found', 404, 'NOT_FOUND');
  }
  deleteRow_('Budgets', id);
  return { ok: true };
}

function budgetsCopy_(user, body) {
  var from = periodKey_(body.from, 'from', shiftPeriod_(currentPeriod_(), -1));
  var to = periodKey_(body.to, 'to', currentPeriod_());
  if (from === to) throw bad_('Source and target periods must differ', 'SAME_PERIOD');

  var source = userRows_('Budgets', user.id).filter(function (b) { return periodOf_(b.period) === from; });
  if (!source.length) throw bad_('No budgets found for ' + from, 'NOTHING_TO_COPY');

  var taken = {};
  userRows_('Budgets', user.id).forEach(function (b) {
    if (periodOf_(b.period) === to) taken[b.scope + ':' + String(b.targetId).toLowerCase()] = true;
  });

  var copied = 0;
  source.forEach(function (budget) {
    if (taken[budget.scope + ':' + String(budget.targetId).toLowerCase()]) return;
    insertRow_('Budgets', {
      id: uuid_(), userId: user.id, period: to, scope: budget.scope,
      targetId: budget.targetId, targetLabel: budget.targetLabel, mode: budget.mode,
      value: budget.value, baseIncome: budget.baseIncome, note: budget.note,
      createdAt: new Date().toISOString()
    });
    copied += 1;
  });

  return { ok: true, copied: copied, skipped: source.length - copied };
}

/* =========================================================================
 * Goals — sinking funds
 * -------------------------------------------------------------------------
 * Virtual envelopes. A goal earmarks money that is still sitting in a real
 * wallet: funding "Japan Trip" moves nothing, writes no Transaction, and leaves
 * every balance in the app exactly as it was.
 *
 * That is the whole point, and it is also the thing most likely to be
 * "corrected" later, so: a sinking fund is a *label on money you already have*.
 * If funding a goal wrote an expense, the money would leave your net worth for
 * a purchase you have not made, your savings rate would collapse the month you
 * started saving, and every budget would count the transfer as spending. The
 * only figure a goal changes is how much of your cash is already spoken for,
 * which the client derives as `liquid - Σ savedAmount`.
 * ========================================================================= */

/** A goal with nothing typed into it still needs a swatch. */
var GOAL_DEFAULT_COLOR = '#3b6fff';

function parseGoal_(body) {
  var target = num_(body.targetAmount, 'targetAmount', { min: 0 });
  if (target <= 0) throw bad_('"targetAmount" must be greater than zero');

  return {
    title: str_(body.title, 'title', { max: 80 }),
    targetAmount: target,
    deadline: body.deadline ? isoDate_(body.deadline, 'deadline') : '',
    color: str_(body.color, 'color', { required: false, max: 20 }) || GOAL_DEFAULT_COLOR,
    note: str_(body.note, 'note', { required: false, max: 300 })
  };
}

/** Adds the figures the client would otherwise have to recompute per row. */
function decorateGoal_(goal) {
  var target = Number(goal.targetAmount) || 0;
  var saved = Number(goal.savedAmount) || 0;
  var remaining = Math.max(0, target - saved);

  return {
    id: goal.id, userId: goal.userId, title: goal.title,
    targetAmount: target, savedAmount: saved,
    deadline: goal.deadline, color: goal.color, note: goal.note,
    createdAt: goal.createdAt,
    /* computed server-side */
    remaining: money_(remaining),
    /* Uncapped on purpose. Over-funding a goal is a real thing people do, and
       clamping the percentage at 100 would hide it. The UI caps the *bar*. */
    percentComplete: target > 0 ? money_((saved / target) * 100) : 0,
    complete: saved >= target
  };
}

function goalsList_(user) {
  return userRows_('Goals', user.id)
    .map(function (row) {
      var copy = {};
      for (var k in row) if (k !== '_row') copy[k] = row[k];
      return decorateGoal_(copy);
    })
    .sort(function (a, b) {
      /* Unfinished first, then by deadline — a goal with a date is more urgent
         than one without, so a missing deadline sorts last rather than first
         (an empty string would otherwise win every comparison). */
      if (a.complete !== b.complete) return a.complete ? 1 : -1;
      var da = a.deadline || '9999-12-31';
      var db = b.deadline || '9999-12-31';
      return da.localeCompare(db) || String(a.title).localeCompare(String(b.title));
    });
}

function goalsCreate_(user, body) {
  var parsed = parseGoal_(body);

  var goal = {
    id: uuid_(), userId: user.id,
    title: parsed.title, targetAmount: parsed.targetAmount,
    /* Always starts empty. An opening balance would have to come from
       somewhere, and `goals.fund` is the only thing allowed to say where. */
    savedAmount: 0,
    deadline: parsed.deadline, color: parsed.color, note: parsed.note,
    createdAt: new Date().toISOString()
  };

  insertRow_('Goals', goal);
  return decorateGoal_(goal);
}

function goalsUpdate_(user, query, body) {
  var id = str_(query.id, 'id');
  var existing = findById_('Goals', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Goal not found', 404, 'NOT_FOUND');
  }

  var merged = {};
  for (var k in existing) if (k !== '_row') merged[k] = existing[k];
  for (var j in body) merged[j] = body[j];

  var parsed = parseGoal_(merged);
  /* `savedAmount` is deliberately absent from the patch. Editing a goal must
     not be a back door into its balance — that belongs to `goals.fund`, which
     is the only path that reads the stored figure before changing it. */
  var updated = updateRow_('Goals', id, parsed);
  delete updated._row;
  return decorateGoal_(updated);
}

/**
 * Move money into or out of the envelope.
 *
 * -------------------------------------------------------------------------
 * WHY THIS IS AN ACTION AND NOT A PATCH
 * -------------------------------------------------------------------------
 * The obvious implementation is for the client to send
 * `{ savedAmount: current + 500 }`. That is a lost update waiting to happen:
 * two tabs, or a phone and a laptop, each read 1,000, each write 1,500, and one
 * of the two deposits vanishes with no error anywhere.
 *
 * Sending the *delta* and resolving it against the stored row means the
 * arithmetic happens once, on the row as it actually is. Writes are already
 * serialised by the script lock, so the read and the write cannot interleave.
 *
 * A negative `amount` withdraws. The result is floored at zero rather than
 * rejected: taking out more than is in the envelope means "empty it", which is
 * what the user meant, and an error there would just make them do arithmetic.
 */
function goalsFund_(user, query, body) {
  var id = str_(query.id, 'id');
  var existing = findById_('Goals', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Goal not found', 404, 'NOT_FOUND');
  }

  var amount = num_(body.amount, 'amount', { required: true });
  if (!amount) throw bad_('"amount" must not be zero', 'ZERO_AMOUNT');

  var current = Number(existing.savedAmount) || 0;
  var next = money_(Math.max(0, current + amount));

  var updated = updateRow_('Goals', id, { savedAmount: next });
  delete updated._row;
  return decorateGoal_(updated);
}

function goalsDelete_(user, query) {
  var id = str_(query.id, 'id');
  var existing = findById_('Goals', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Goal not found', 404, 'NOT_FOUND');
  }
  /* No cascade to think about: a goal owns no Transactions by design, so
     deleting one cannot orphan anything or change a balance. */
  deleteRow_('Goals', id);
  return { ok: true, id: id };
}

/* =========================================================================
 * Watchlist
 * -------------------------------------------------------------------------
 * Symbols the user is tracking but does not own. Deliberately a separate table
 * from Investments rather than a status on it: a watchlist row has no quantity,
 * no cost basis and no wallet, so folding it into Investments would mean every
 * P&L calculation, every DCA roll-up and every wallet balance would first have
 * to filter it back out. The two tables answer different questions.
 * ========================================================================= */

/** Free text, but never empty — an unlabelled row still needs a bucket to sit in. */
var WATCHLIST_DEFAULT_CATEGORY = 'Watching';

function parseWatchlist_(body) {
  var symbol = str_(body.symbol, 'symbol', { max: 20 }).toUpperCase();

  var category = str_(body.category, 'category', { required: false, max: 40 }).trim();

  return {
    symbol: symbol,
    category: category || WATCHLIST_DEFAULT_CATEGORY,
    // 0 means "no target", which is why this is not required. The client shows
    // the proximity indicator only when it is above zero.
    targetPrice: num_(body.targetPrice, 'targetPrice', { min: 0 }),
    note: str_(body.note, 'note', { required: false, max: 300 })
  };
}

/**
 * Guards against the same ticker being watched twice.
 *
 * Two rows for AAPL would show up as two rows in two different categories with
 * the same live price, and deleting one would look like it did nothing. Scoped
 * per user, and `exceptId` lets an update re-save its own row.
 */
function assertWatchlistUnique_(userId, symbol, exceptId) {
  var clash = userRows_('Watchlist', userId).filter(function (row) {
    return String(row.symbol).toUpperCase() === symbol && row.id !== exceptId;
  })[0];

  if (clash) {
    throw apiError_(
      symbol + ' is already on your watchlist under "' + clash.category + '"',
      409,
      'DUPLICATE_SYMBOL'
    );
  }
}

/** Grouped the way the UI reads it: category, then symbol. */
function watchlistList_(user, query) {
  var rows = userRows_('Watchlist', user.id);

  if (query && query.category) {
    rows = rows.filter(function (row) {
      return String(row.category).toLowerCase() === String(query.category).toLowerCase();
    });
  }

  return rows
    .map(function (row) {
      var copy = {};
      for (var k in row) if (k !== '_row') copy[k] = row[k];
      return copy;
    })
    .sort(function (a, b) {
      return String(a.category).localeCompare(String(b.category)) ||
        String(a.symbol).localeCompare(String(b.symbol));
    });
}

function watchlistCreate_(user, body) {
  var parsed = parseWatchlist_(body);
  assertWatchlistUnique_(user.id, parsed.symbol, null);

  var entry = {
    id: uuid_(), userId: user.id,
    symbol: parsed.symbol, category: parsed.category,
    targetPrice: parsed.targetPrice, note: parsed.note,
    createdAt: new Date().toISOString()
  };

  insertRow_('Watchlist', entry);
  return entry;
}

function watchlistUpdate_(user, query, body) {
  var id = str_(query.id, 'id');
  var existing = findById_('Watchlist', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Watchlist entry not found', 404, 'NOT_FOUND');
  }

  var merged = {};
  for (var k in existing) if (k !== '_row') merged[k] = existing[k];
  for (var j in body) merged[j] = body[j];

  var parsed = parseWatchlist_(merged);
  assertWatchlistUnique_(user.id, parsed.symbol, id);

  var updated = updateRow_('Watchlist', id, parsed);
  delete updated._row;
  return updated;
}

function watchlistDelete_(user, query) {
  var id = str_(query.id, 'id');
  var existing = findById_('Watchlist', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Watchlist entry not found', 404, 'NOT_FOUND');
  }
  deleteRow_('Watchlist', id);
  return { ok: true, id: id };
}

/* =========================================================================
 * Subscriptions & recurring bills
 *
 * Just-in-time rather than scheduled: nothing runs on a timer. A subscription
 * carries a `nextDueDate`, the UI shows it as due once that date arrives, and
 * confirming payment does two things atomically enough for a spreadsheet —
 * writes a real expense Transaction, then rolls the date to the next cycle.
 *
 * Rolling forward from the OLD due date rather than from today is deliberate:
 * a bill missed for two months then paid twice lands on the two months it was
 * actually for, instead of silently swallowing a cycle.
 * ========================================================================= */

var SUBSCRIPTION_FREQUENCIES = ['weekly', 'monthly', 'yearly'];

/**
 * The next due date after `dateKey`, clamped to real calendar days.
 *
 * Naive month arithmetic overflows: 31 Jan + 1 month lands on 3 Mar because
 * February has no 31st. Anchoring to the last day of the target month keeps a
 * month-end bill on the month end, which is how billing actually behaves.
 */
function advanceDueDate_(dateKey, frequency) {
  var parts = String(dateKey || '').split('-');
  var year = Number(parts[0]);
  var monthIndex = Number(parts[1]) - 1;
  var day = Number(parts[2]);

  if (!isFinite(year) || !isFinite(monthIndex) || !isFinite(day)) {
    throw bad_('Cannot advance an invalid due date: "' + dateKey + '"');
  }

  if (frequency === 'weekly') {
    return toDateKey_(new Date(year, monthIndex, day + 7));
  }

  var step = frequency === 'yearly' ? 12 : 1;
  var target = monthIndex + step;
  var targetYear = year + Math.floor(target / 12);
  var targetMonth = ((target % 12) + 12) % 12;

  // Day 0 of the following month is the last day of the target month.
  var lastDay = new Date(targetYear, targetMonth + 1, 0).getDate();
  return toDateKey_(new Date(targetYear, targetMonth, Math.min(day, lastDay)));
}

function parseSubscription_(userId, body) {
  var walletId = str_(body.walletId, 'walletId');
  ownedWallet_(userId, walletId);

  return {
    name: str_(body.name, 'name', { max: 80 }),
    amount: num_(body.amount, 'amount', { min: 0 }),
    walletId: walletId,
    category: str_(body.category, 'category', { max: 60 }),
    frequency: oneOf_(body.frequency, 'frequency', SUBSCRIPTION_FREQUENCIES, 'monthly'),
    nextDueDate: isoDate_(body.nextDueDate || toDateKey_(new Date()), 'nextDueDate'),
    note: str_(body.note, 'note', { required: false, max: 300 })
  };
}

/** Soonest due first — the order the timeline renders in. */
function subscriptionsList_(user) {
  return userRows_('Subscriptions', user.id)
    .map(function (row) {
      var copy = {};
      for (var k in row) if (k !== '_row') copy[k] = row[k];
      return copy;
    })
    .sort(function (a, b) {
      return String(a.nextDueDate).localeCompare(String(b.nextDueDate)) ||
        String(a.name).localeCompare(String(b.name));
    });
}

function subscriptionsCreate_(user, body) {
  var parsed = parseSubscription_(user.id, body);

  var subscription = {
    id: uuid_(), userId: user.id,
    name: parsed.name, amount: parsed.amount, walletId: parsed.walletId,
    category: parsed.category, frequency: parsed.frequency,
    nextDueDate: parsed.nextDueDate, note: parsed.note,
    createdAt: new Date().toISOString()
  };

  insertRow_('Subscriptions', subscription);
  return subscription;
}

function subscriptionsUpdate_(user, query, body) {
  var id = str_(query.id, 'id');
  var existing = findById_('Subscriptions', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Subscription not found', 404, 'NOT_FOUND');
  }

  var merged = {};
  for (var k in existing) if (k !== '_row') merged[k] = existing[k];
  for (var j in body) merged[j] = body[j];

  var parsed = parseSubscription_(user.id, merged);
  var updated = updateRow_('Subscriptions', id, parsed);
  delete updated._row;
  return updated;
}

function subscriptionsDelete_(user, query) {
  var id = str_(query.id, 'id');
  var existing = findById_('Subscriptions', id);
  if (!existing || existing.userId !== user.id) {
    throw apiError_('Subscription not found', 404, 'NOT_FOUND');
  }
  deleteRow_('Subscriptions', id);
  return { ok: true, id: id };
}

/**
 * Confirm a payment: write the expense, then roll the cycle.
 *
 * The transaction is dated today rather than on the due date — the money left
 * the wallet when the user confirmed, so that is the month it belongs to under
 * cash accounting. Pass `date` to override for a payment being recorded late.
 */
function subscriptionsPay_(user, query, body) {
  var id = str_(query.id, 'id');
  var subscription = findById_('Subscriptions', id);
  if (!subscription || subscription.userId !== user.id) {
    throw apiError_('Subscription not found', 404, 'NOT_FOUND');
  }

  // Re-check now rather than trusting the row: the wallet may have been
  // deleted since the subscription was set up.
  ownedWallet_(user.id, subscription.walletId);

  var amount = num_(subscription.amount, 'amount', { min: 0 });
  if (!(amount > 0)) throw bad_('This subscription has no amount to pay', 'ZERO_AMOUNT');

  var paidOn = isoDate_((body && body.date) || toDateKey_(new Date()), 'date');

  var tx = {
    id: uuid_(), userId: user.id,
    walletId: subscription.walletId, toWalletId: '', type: 'expense',
    amount: amount,
    category: subscription.category,
    note: (body && body.note) ? str_(body.note, 'note', { required: false, max: 300 })
                              : subscription.name,
    date: paidOn,
    createdAt: new Date().toISOString()
  };
  insertRow_('Transactions', tx);

  var nextDue = advanceDueDate_(subscription.nextDueDate, subscription.frequency);
  var updated = updateRow_('Subscriptions', id, { nextDueDate: nextDue });
  delete updated._row;

  // Both halves, so the client can reconcile its optimistic patch exactly
  // rather than guessing what the server decided.
  return { ok: true, subscription: updated, transaction: tx };
}

/* Must stay in step with ThemeName in the frontend types: settingsSave_ runs
   every incoming theme through oneOf_(), so a name missing here is rejected
   with a 400 and the picker silently rolls back. */
var THEMES = [
  'light', 'dark', 'custom',
  'ocean', 'forest', 'sunset', 'cyberpunk', 'rosegold',
  'midnight', 'dracula', 'nord', 'solarized', 'amethyst'
];

/* Must stay in step with FONTS in frontend/src/lib/fonts.ts. An id not listed
   here is rejected with a 400 rather than written through to a stylesheet. */
var FONTS = ['system', 'inter', 'prompt', 'sarabun', 'noto-sans-thai', 'sans-serif'];

/** '' (the system face) or a known id. Anything else is a 400. */
function fontId_(value) {
  return oneOf_(value, 'fontFamily', FONTS, '');
}

/** CSS custom properties the client may override in the `custom` theme. */
var ALLOWED_CUSTOM_VARS = [
  '--bg', '--surface', '--surface-2', '--border', '--text', '--text-muted',
  '--accent', '--accent-contrast', '--positive', '--negative', '--warning', '--radius'
];

function sanitizeCustomVars_(input) {
  if (!input || typeof input !== 'object') return {};
  var out = {};
  Object.keys(input).forEach(function (key) {
    if (ALLOWED_CUSTOM_VARS.indexOf(key) === -1) return;
    var raw = String(input[key] === undefined ? '' : input[key]).trim();
    // Anything that could break out of a CSS declaration is dropped.
    if (!raw || raw.length > 40 || /[;{}<>()]/.test(raw)) return;
    out[key] = raw;
  });
  return out;
}

function normalizeCategories_(input) {
  var list = Object.prototype.toString.call(input) === '[object Array]'
    ? input
    : String(input === undefined || input === null ? '' : input).split(',');

  var seen = {};
  var out = [];
  list.forEach(function (c) {
    var name = String(c).trim();
    if (!name || seen[name.toLowerCase()]) return;
    seen[name.toLowerCase()] = true;
    out.push(name);
  });
  return out.length ? out.slice(0, 100) : DEFAULT_CATEGORIES.slice();
}

function settingsGet_(user) {
  var existing = getSettingsRow_(user.id);
  if (existing) {
    delete existing._row;
    /* The library goes out through the same validator the write path uses.
       The column type already guarantees an array, but the *entries* are
       whatever was in the cell — including whatever a hand-edit left there —
       and the client renders them directly. Validating on the way out means
       one malformed row cannot take the screen down. */
    existing.customThemes = themeLibrary_(existing);
    return existing;
  }
  return insertRow_('Settings', defaultSettings_(user.id));
}

/** The one place a Settings row is written. Stamps updatedAt and upserts. */
function persistSettings_(userId, next) {
  next.userId = userId;
  next.updatedAt = new Date().toISOString();

  var saved = findById_('Settings', userId)
    ? updateRow_('Settings', userId, next)
    : insertRow_('Settings', next);

  delete saved._row;
  return saved;
}

function settingsSave_(user, body) {
  var current = getSettingsRow_(user.id) || defaultSettings_(user.id);

  var theme = body.theme !== undefined ? oneOf_(body.theme, 'theme', THEMES) : current.theme;

  var next = {
    userId: user.id,
    theme: theme,
    accent: body.accent !== undefined ? str_(body.accent, 'accent', { max: 20 }) : current.accent,
    customVars: body.customVars !== undefined
      ? sanitizeCustomVars_(body.customVars)
      : current.customVars,
    currency: body.currency !== undefined
      ? str_(body.currency, 'currency', { max: 8 }).toUpperCase()
      : current.currency,
    displayCurrency: body.displayCurrency !== undefined
      ? str_(body.displayCurrency, 'displayCurrency', { required: false, max: 8 }).toUpperCase()
      : current.displayCurrency,
    fxRate: body.fxRate !== undefined ? num_(body.fxRate, 'fxRate', { min: 0 }) : current.fxRate,
    fxRateUpdatedAt: body.fxRate !== undefined
      ? new Date().toISOString()
      : current.fxRateUpdatedAt,
    locale: body.locale !== undefined ? str_(body.locale, 'locale', { max: 12 }) : current.locale,
    monthlyIncome: body.monthlyIncome !== undefined
      ? num_(body.monthlyIncome, 'monthlyIncome', { min: 0 })
      : current.monthlyIncome,
    categories: body.categories !== undefined
      ? normalizeCategories_(body.categories)
      : current.categories,
    /* The library itself is only ever written through the themes.* handlers — a
       settings.save that happened to carry a stale copy must not roll it back. */
    customThemes: themeLibrary_(current),
    /* Selecting a built-in preset unlinks whatever library entry was worn, so
       the picker cannot show two things active at once. */
    activeCustomThemeId: theme === 'custom'
      ? (body.activeCustomThemeId !== undefined
          ? str_(body.activeCustomThemeId, 'activeCustomThemeId', { required: false, max: 40 })
          : current.activeCustomThemeId || '')
      : '',
    /* Not forced to '' outside the custom theme the way activeCustomThemeId is.
       That field is a reference into the library and would dangle; a typeface is
       a standalone scalar, so whether a preset keeps or clears it is the
       client's call, not a correctness constraint. */
    fontFamily: body.fontFamily !== undefined ? fontId_(body.fontFamily) : (current.fontFamily || '')
  };

  return persistSettings_(user.id, next);
}

/* =========================================================================
 * Theme library
 * -------------------------------------------------------------------------
 * Saved palettes live as a JSON array in Settings.customThemes — see the note
 * on that column for why there is no CustomThemes sheet.
 *
 * Activating an entry *materialises* it into the plain `theme: 'custom'` +
 * `customVars` fields the app has always used. That redundancy is the point:
 * the client's anti-FOUC boot script reads only those two, so a saved theme
 * paints before first paint on the next load without the boot script having to
 * learn what a library is.
 *
 * Every write here answers with the whole Settings row, so the client replaces
 * its settings in one round trip instead of writing and then re-reading.
 * ========================================================================= */

/** Plenty for a person, and keeps the cell far under the 50k character limit. */
var MAX_CUSTOM_THEMES = 24;

/**
 * The library as an array, whatever the cell actually held.
 *
 * coerce_('json') answers `{}` for an empty cell and for anything unparseable,
 * so an array is never guaranteed — every read goes through here.
 */
function themeLibrary_(settings) {
  var raw = settings && settings.customThemes;
  if (Object.prototype.toString.call(raw) !== '[object Array]') return [];

  var out = [];
  raw.forEach(function (entry) {
    if (!entry || typeof entry !== 'object') return;
    var id = String(entry.id || '').trim();
    if (!id) return;
    out.push({
      id: id,
      name: String(entry.name || 'Untitled').trim().slice(0, 40) || 'Untitled',
      colors: sanitizeCustomVars_(entry.colors),
      /* Tolerant, unlike the create/update path: a theme saved before fonts
         existed, or one naming a face since retired, must still open rather
         than 400 the whole library read. */
      fontFamily: FONTS.indexOf(String(entry.fontFamily || '')) === -1
        ? ''
        : String(entry.fontFamily),
      createdAt: String(entry.createdAt || ''),
      updatedAt: String(entry.updatedAt || '')
    });
  });
  return out;
}

function findTheme_(library, id) {
  for (var i = 0; i < library.length; i += 1) {
    if (library[i].id === id) return { theme: library[i], index: i };
  }
  return null;
}

/**
 * Copies a library entry into the fields that actually paint the app.
 *
 * `accent` is lifted out of the palette so the accent picker and the theme
 * agree; without it SettingsContext's inline --accent would override the
 * palette's own accent and every saved theme would wear the same blue.
 */
function wearTheme_(next, theme) {
  next.theme = 'custom';
  next.customVars = theme.colors;
  next.activeCustomThemeId = theme.id;
  next.fontFamily = theme.fontFamily || '';
  if (theme.colors['--accent']) next.accent = theme.colors['--accent'];
  return next;
}

/** The mutable half of a Settings row, ready to be patched and persisted. */
function settingsDraft_(user) {
  var current = getSettingsRow_(user.id) || defaultSettings_(user.id);
  return {
    userId: user.id,
    theme: current.theme,
    accent: current.accent,
    customVars: current.customVars,
    currency: current.currency,
    displayCurrency: current.displayCurrency,
    fxRate: current.fxRate,
    fxRateUpdatedAt: current.fxRateUpdatedAt,
    locale: current.locale,
    monthlyIncome: current.monthlyIncome,
    categories: current.categories,
    customThemes: themeLibrary_(current),
    activeCustomThemeId: current.activeCustomThemeId || '',
    fontFamily: current.fontFamily || ''
  };
}

function themesList_(user) {
  var current = getSettingsRow_(user.id) || defaultSettings_(user.id);
  return {
    themes: themeLibrary_(current),
    activeCustomThemeId: current.activeCustomThemeId || ''
  };
}

function themesCreate_(user, body) {
  var next = settingsDraft_(user);

  if (next.customThemes.length >= MAX_CUSTOM_THEMES) {
    throw bad_('You can keep up to ' + MAX_CUSTOM_THEMES + ' saved themes. Delete one first.');
  }

  var name = str_(body.name, 'name', { max: 40 });
  var colors = sanitizeCustomVars_(body.colors);
  if (!Object.keys(colors).length) throw bad_('A theme needs at least one colour');

  var now = new Date().toISOString();
  var theme = {
    id: uuid_(),
    name: name,
    colors: colors,
    fontFamily: fontId_(body.fontFamily),
    createdAt: now,
    updatedAt: now
  };
  next.customThemes.push(theme);

  // Saving a palette you have been previewing and *not* wearing it would be a
  // surprise, so activation is the default and is only opted out of explicitly.
  if (body.activate !== false) wearTheme_(next, theme);

  return persistSettings_(user.id, next);
}

function themesUpdate_(user, query, body) {
  var next = settingsDraft_(user);
  var found = findTheme_(next.customThemes, str_(query.id, 'id', { max: 40 }));
  if (!found) throw apiError_('Theme not found', 404, 'NOT_FOUND');

  var theme = found.theme;
  if (body.name !== undefined) theme.name = str_(body.name, 'name', { max: 40 });
  if (body.colors !== undefined) {
    var colors = sanitizeCustomVars_(body.colors);
    if (!Object.keys(colors).length) throw bad_('A theme needs at least one colour');
    theme.colors = colors;
  }
  if (body.fontFamily !== undefined) theme.fontFamily = fontId_(body.fontFamily);
  theme.updatedAt = new Date().toISOString();

  // Editing the theme you are wearing has to repaint it, or the screen would
  // keep the old colours until the next activate.
  if (body.activate === true || next.activeCustomThemeId === theme.id) wearTheme_(next, theme);

  return persistSettings_(user.id, next);
}

function themesDelete_(user, query) {
  var next = settingsDraft_(user);
  var found = findTheme_(next.customThemes, str_(query.id, 'id', { max: 40 }));
  if (!found) throw apiError_('Theme not found', 404, 'NOT_FOUND');

  next.customThemes.splice(found.index, 1);

  /* Deleting the theme you are wearing unlinks it but leaves the colours on
     screen. Snapping back to the stock palette mid-click would read as the app
     losing your work rather than as the list losing a row. */
  if (next.activeCustomThemeId === found.theme.id) next.activeCustomThemeId = '';

  return persistSettings_(user.id, next);
}

function themesActivate_(user, query) {
  var next = settingsDraft_(user);
  var found = findTheme_(next.customThemes, str_(query.id, 'id', { max: 40 }));
  if (!found) throw apiError_('Theme not found', 404, 'NOT_FOUND');

  wearTheme_(next, found.theme);
  return persistSettings_(user.id, next);
}

/* =========================================================================
 * Bill splits
 * -------------------------------------------------------------------------
 * WHY BOTH HALVES ARE WRITTEN SERVER-SIDE
 * -------------------------------------------------------------------------
 * Creating a split bill is two writes that must not come apart: an expense
 * Transaction for what was actually paid, and the BillSplits row that says who
 * owes what back. Done as two calls from the client, a failure between them
 * leaves either an expense nobody is tracking or a bill for money that never
 * left the wallet — and the user has no way to tell which.
 *
 * So both land in one handler, inside the script lock the router already
 * takes for every write. The same is true of a repayment: the income row and
 * the isPaid flag are one fact, not two.
 *
 * Each handler answers with every row it touched, so the client can reconcile
 * its optimistic patch against what the server actually decided rather than
 * guessing. That is the shape subscriptionsPay_ established.
 *
 * -------------------------------------------------------------------------
 * WHAT THE ARITHMETIC MEANS
 * -------------------------------------------------------------------------
 *   totalAmount          what left the wallet
 *   sum(splits)          what other people owe back
 *   totalAmount - sum    the payer's own share — never stored, always implied
 *
 * So the shares are allowed to sum to *less* than the total and usually do:
 * you were at the dinner too. They may never sum to more, which would mean
 * collecting more than was spent.
 * ========================================================================= */

var BILL_SPLIT_STATUSES = ['open', 'settled'];

/** Money comparisons need a tolerance; two decimal places is as fine as it gets. */
var SPLIT_EPSILON = 0.005;

/**
 * Validates the shares array and returns it normalised.
 *
 * `repaymentTxId` is preserved rather than recomputed: an edit that rewrites
 * the shares must not silently orphan the income rows already written for the
 * people who have paid.
 */
function parseSplits_(value, totalAmount) {
  var raw = Object.prototype.toString.call(value) === '[object Array]' ? value : [];
  if (!raw.length) throw bad_('Add at least one person to split with', 'NO_SPLITS');
  if (raw.length > 50) throw bad_('A bill can be split between at most 50 people', 'TOO_MANY_SPLITS');

  var seen = {};
  var sum = 0;

  var splits = raw.map(function (entry, index) {
    var personName = str_(entry && entry.personName, 'personName', { max: 60 });

    // Two "Nick"s on one bill is almost certainly a mistake, and it makes the
    // row impossible to address by name in the UI.
    var key = personName.toLowerCase();
    if (seen[key]) throw bad_('"' + personName + '" is on this bill twice', 'DUPLICATE_PERSON');
    seen[key] = true;

    var amount = num_(entry && entry.amount, 'amount', { min: 0 });
    if (!(amount > 0)) {
      throw bad_('Every share must be greater than zero — check ' + personName, 'ZERO_SHARE');
    }
    sum += amount;

    return {
      personName: personName,
      amount: money_(amount),
      isPaid: bool_(entry && entry.isPaid, false),
      repaymentTxId: str_(entry && entry.repaymentTxId, 'repaymentTxId', {
        required: false, max: 60
      }),
      index: index
    };
  });

  if (money_(sum) > money_(totalAmount) + SPLIT_EPSILON) {
    throw bad_(
      'The shares add up to ' + money_(sum) + ', which is more than the ' +
        money_(totalAmount) + ' bill',
      'SPLITS_EXCEED_TOTAL'
    );
  }

  return splits;
}

/** 'settled' once nobody owes anything. Derived, never taken from the client. */
function splitsStatus_(splits) {
  var outstanding = splits.filter(function (s) { return !s.isPaid; }).length;
  return outstanding === 0 ? 'settled' : 'open';
}

/** Adds the figures every screen would otherwise recompute identically. */
function decorateBillSplit_(row) {
  var splits = Object.prototype.toString.call(row.splitsJSON) === '[object Array]'
    ? row.splitsJSON
    : [];

  var owedTotal = 0;
  var recovered = 0;
  splits.forEach(function (s) {
    var amount = Number(s.amount) || 0;
    owedTotal += amount;
    if (s.isPaid) recovered += amount;
  });

  var total = Number(row.totalAmount) || 0;

  return {
    id: row.id,
    userId: row.userId,
    title: row.title,
    totalAmount: money_(total),
    walletId: row.walletId,
    note: row.note,
    splits: splits,
    status: row.status || splitsStatus_(splits),
    createdAt: row.createdAt,
    expenseTxId: row.expenseTxId,

    /* Everyone else's shares added up. */
    owedTotal: money_(owedTotal),
    recovered: money_(recovered),
    outstanding: money_(owedTotal - recovered),
    /* What the payer is genuinely out of pocket for — their own share of the
       bill. Implied by the arithmetic rather than stored, so it cannot drift. */
    ownShare: money_(total - owedTotal),
    /* Percent of what is owed that has come back. 100 when nobody owes
       anything, which reads better than 0 for a bill with no shares. */
    recoveredPercent: owedTotal > 0 ? money_((recovered / owedTotal) * 100) : 100
  };
}

function billSplitsList_(user, query) {
  var rows = userRows_('BillSplits', user.id);

  if (query && query.status) {
    var wanted = oneOf_(query.status, 'status', BILL_SPLIT_STATUSES);
    rows = rows.filter(function (r) { return (r.status || 'open') === wanted; });
  }

  // Newest first: an open bill is a thing you are chasing, and the one you
  // just created is the one you are most likely to act on.
  return rows
    .slice()
    .sort(function (a, b) { return String(b.createdAt).localeCompare(String(a.createdAt)); })
    .map(decorateBillSplit_);
}

function billSplitsGet_(user, query) {
  var row = findById_('BillSplits', str_(query.id, 'id'));
  if (!row || row.userId !== user.id) {
    throw apiError_('Bill split not found', 404, 'NOT_FOUND');
  }
  return decorateBillSplit_(row);
}

/**
 * Creates the bill AND the expense it represents.
 *
 * Order matters: the Transaction is written first so that if the sheet refuses
 * the BillSplits row, what survives is an ordinary expense the user can see and
 * delete on the Activity screen. The other order would leave a bill claiming
 * money that never moved, which is invisible and actively misleading.
 */
function billSplitsCreate_(user, body) {
  var title = str_(body.title, 'title', { max: 120 });
  var totalAmount = num_(body.totalAmount, 'totalAmount', { min: 0 });
  if (!(totalAmount > 0)) throw bad_('"totalAmount" must be greater than zero');

  var walletId = str_(body.walletId, 'walletId');
  var wallet = ownedWallet_(user.id, walletId, 'Wallet');
  if (wallet.mode === 'investment') {
    throw bad_(
      'A bill has to be paid from a spending wallet, not an investment one.',
      'WRONG_WALLET_MODE'
    );
  }

  var splits = parseSplits_(body.splits, totalAmount);
  var note = str_(body.note, 'note', { required: false, max: 300 });
  var date = isoDate_(body.date || toDateKey_(new Date()), 'date');
  var category = str_(body.category, 'category', { required: false, max: 60 }) || 'Shared';

  var now = new Date().toISOString();

  /* The whole bill is the expense, not just the payer's share: the money left
     the wallet in full, and each repayment brings part of it back as income.
     Recording only the payer's share here would make the wallet balance wrong
     for as long as anyone still owed. */
  var tx = {
    id: uuid_(),
    userId: user.id,
    walletId: walletId,
    toWalletId: '',
    type: 'expense',
    amount: money_(totalAmount),
    category: category,
    note: note || title,
    date: date,
    createdAt: now,
    installmentGroupId: '',
    installmentIndex: ''
  };
  insertRow_('Transactions', tx);

  var bill = {
    id: uuid_(),
    userId: user.id,
    title: title,
    totalAmount: money_(totalAmount),
    walletId: walletId,
    note: note,
    splitsJSON: splits.map(function (s) {
      return {
        personName: s.personName, amount: s.amount, isPaid: s.isPaid,
        repaymentTxId: s.repaymentTxId
      };
    }),
    status: splitsStatus_(splits),
    createdAt: now,
    expenseTxId: tx.id
  };
  insertRow_('BillSplits', bill);

  return { ok: true, billSplit: decorateBillSplit_(bill), transaction: tx };
}

/**
 * Marks one person paid and books the money back into the wallet.
 *
 * Addressed by array index rather than by name: names are user-typed, and an
 * edit that renames "Nick" to "Nicky" between the page painting and the button
 * being pressed would otherwise settle nobody, or — worse, with two similar
 * names — the wrong person.
 */
function billSplitsMarkPaid_(user, query, body) {
  var bill = findById_('BillSplits', str_(query.id, 'id'));
  if (!bill || bill.userId !== user.id) {
    throw apiError_('Bill split not found', 404, 'NOT_FOUND');
  }

  var splits = Object.prototype.toString.call(bill.splitsJSON) === '[object Array]'
    ? bill.splitsJSON.slice()
    : [];

  var index = Math.round(num_((body && body.index) !== undefined ? body.index : query.index,
                              'index', { min: 0, required: true }));
  var share = splits[index];
  if (!share) throw apiError_('That person is not on this bill', 404, 'SPLIT_NOT_FOUND');

  // Idempotent rather than an error: a double-tap on a slow connection should
  // not book the money back twice.
  if (share.isPaid) {
    return { ok: true, billSplit: decorateBillSplit_(bill), transaction: null, alreadyPaid: true };
  }

  var amount = num_(share.amount, 'amount', { min: 0 });
  if (!(amount > 0)) throw bad_('That share has no amount to collect', 'ZERO_SHARE');

  // Re-checked now rather than trusted from the row: the wallet may have been
  // archived or deleted since the bill was created.
  ownedWallet_(user.id, bill.walletId, 'Wallet');

  var tx = {
    id: uuid_(),
    userId: user.id,
    walletId: bill.walletId,
    toWalletId: '',
    /* Income, because the money genuinely arrives in the wallet. The pair nets
       out correctly over the bill's life: the full amount went out as expense,
       each share comes back as income, and what is left is the payer's own
       share — which is exactly what they spent. */
    type: 'income',
    amount: money_(amount),
    category: 'Reimbursement',
    note: share.personName + ' · ' + bill.title,
    date: isoDate_((body && body.date) || toDateKey_(new Date()), 'date'),
    createdAt: new Date().toISOString(),
    installmentGroupId: '',
    installmentIndex: ''
  };
  insertRow_('Transactions', tx);

  splits[index] = {
    personName: share.personName,
    amount: money_(amount),
    isPaid: true,
    repaymentTxId: tx.id
  };

  var updated = updateRow_('BillSplits', bill.id, {
    splitsJSON: splits,
    status: splitsStatus_(splits)
  });
  delete updated._row;

  return { ok: true, billSplit: decorateBillSplit_(updated), transaction: tx };
}

/**
 * Undoes a repayment.
 *
 * Exists because "Mark as paid" is one tap on the wrong row away from being
 * wrong, and the alternative correction — hunting the income row down on the
 * Activity screen and deleting it by hand — leaves the bill still showing
 * paid. The income row is removed here so the two cannot disagree.
 */
function billSplitsMarkUnpaid_(user, query, body) {
  var bill = findById_('BillSplits', str_(query.id, 'id'));
  if (!bill || bill.userId !== user.id) {
    throw apiError_('Bill split not found', 404, 'NOT_FOUND');
  }

  var splits = Object.prototype.toString.call(bill.splitsJSON) === '[object Array]'
    ? bill.splitsJSON.slice()
    : [];

  var index = Math.round(num_((body && body.index) !== undefined ? body.index : query.index,
                              'index', { min: 0, required: true }));
  var share = splits[index];
  if (!share) throw apiError_('That person is not on this bill', 404, 'SPLIT_NOT_FOUND');

  var removedTxId = str_(share.repaymentTxId, 'repaymentTxId', { required: false, max: 60 });
  if (removedTxId) {
    var tx = findById_('Transactions', removedTxId);
    // Only ever deletes a row this user owns, and only the one the share
    // itself points at — never a transaction found by matching amounts.
    if (tx && tx.userId === user.id) deleteRow_('Transactions', removedTxId);
  }

  splits[index] = {
    personName: share.personName,
    amount: money_(Number(share.amount) || 0),
    isPaid: false,
    repaymentTxId: ''
  };

  var updated = updateRow_('BillSplits', bill.id, {
    splitsJSON: splits,
    status: splitsStatus_(splits)
  });
  delete updated._row;

  return { ok: true, billSplit: decorateBillSplit_(updated), removedTransactionId: removedTxId };
}

/** Edits the parts of a bill that are safe to change after the fact. */
function billSplitsUpdate_(user, query, body) {
  var bill = findById_('BillSplits', str_(query.id, 'id'));
  if (!bill || bill.userId !== user.id) {
    throw apiError_('Bill split not found', 404, 'NOT_FOUND');
  }

  var patch = {};
  if (body.title !== undefined) patch.title = str_(body.title, 'title', { max: 120 });
  if (body.note !== undefined) patch.note = str_(body.note, 'note', { required: false, max: 300 });

  /* The shares can be rewritten, but the total and the wallet cannot: both are
     already recorded in an expense Transaction the user may have edited, and
     silently rewriting one side of that pair is how the wallet balance and the
     bill stop agreeing. Delete and recreate to change those. */
  if (body.splits !== undefined) {
    var splits = parseSplits_(body.splits, Number(bill.totalAmount) || 0);
    patch.splitsJSON = splits.map(function (s) {
      return {
        personName: s.personName, amount: s.amount, isPaid: s.isPaid,
        repaymentTxId: s.repaymentTxId
      };
    });
    patch.status = splitsStatus_(splits);
  }

  var updated = updateRow_('BillSplits', bill.id, patch);
  delete updated._row;
  return decorateBillSplit_(updated);
}

/**
 * Deletes the bill, and by default everything it wrote.
 *
 * `keepTransactions=true` leaves the ledger alone — for someone who wants the
 * spending history but is done tracking who owed what.
 */
function billSplitsDelete_(user, query) {
  var bill = findById_('BillSplits', str_(query.id, 'id'));
  if (!bill || bill.userId !== user.id) {
    throw apiError_('Bill split not found', 404, 'NOT_FOUND');
  }

  var keep = bool_(query.keepTransactions, false);
  var removed = 0;

  if (!keep) {
    var ids = {};
    if (bill.expenseTxId) ids[bill.expenseTxId] = true;
    (Object.prototype.toString.call(bill.splitsJSON) === '[object Array]' ? bill.splitsJSON : [])
      .forEach(function (s) { if (s && s.repaymentTxId) ids[s.repaymentTxId] = true; });

    removed = deleteWhere_('Transactions', function (t) {
      return t.userId === user.id && ids[t.id] === true;
    });
  }

  deleteRow_('BillSplits', bill.id);
  return { ok: true, removedTransactions: removed };
}

/* =========================================================================
 * Dashboard
 * ========================================================================= */

var TREND_MONTHS = 6;

function dashboardGet_(user, query) {
  var period = periodKey_(query.period, 'period', currentPeriod_());
  var settings = getSettingsRow_(user.id);

  var wallets = computeWalletBalances_(user.id, period).filter(function (w) {
    return !w.archived;
  });
  var transactions = userRows_('Transactions', user.id);
  var investments = userRows_('Investments', user.id);
  var monthTx = transactions.filter(function (t) { return inPeriod_(t.date, period); });

  var monthIncome = 0;
  var monthExpense = 0;
  monthTx.forEach(function (t) {
    if (t.type === 'income') monthIncome += t.amount;
    if (t.type === 'expense') monthExpense += t.amount;
  });
  monthIncome = money_(monthIncome);
  monthExpense = money_(monthExpense);

  /* ---- Cash, debt and the difference between them ----
     `liquidBalance` keeps its existing meaning to the decimal — every spending
     wallet, credit cards included — because the projection, the hero figure and
     the Sankey all read it and none of them should change. What is new is that
     the two halves are now reported separately as well.

     Net worth is unchanged and was already correct: a credit wallet's balance
     is negative, and summing it in subtracts the debt. `creditDebt` below just
     names the amount that was already being subtracted, so the dashboard can
     show it instead of leaving the user to infer it from a smaller total. */
  var cashBalance = 0;
  var creditDebt = 0;
  var creditLimit = 0;
  var liquidBalance = 0;
  var investmentCash = 0;
  var investedCost = 0;
  wallets.forEach(function (w) {
    if (w.mode === 'expense') {
      liquidBalance += w.balance;
      if (w.type === 'CREDIT') {
        // Positive = owed. A card in credit (overpaid) contributes nothing to
        // debt rather than a negative one, which would overstate headroom.
        creditDebt += Math.max(0, -w.balance);
        creditLimit += w.creditLimit;
      } else {
        cashBalance += w.balance;
      }
    } else {
      investmentCash += w.balance;
    }
    investedCost += w.investedCost;
  });
  cashBalance = money_(cashBalance);
  creditDebt = money_(creditDebt);
  creditLimit = money_(creditLimit);
  liquidBalance = money_(liquidBalance);
  investmentCash = money_(investmentCash);
  investedCost = money_(investedCost);

  var byCategory = {};
  monthTx.forEach(function (tx) {
    if (tx.type !== 'expense') return;
    var key = tx.category || 'Uncategorised';
    byCategory[key] = (byCategory[key] || 0) + tx.amount;
  });
  var categoryBreakdown = Object.keys(byCategory)
    .map(function (category) {
      return {
        category: category,
        amount: money_(byCategory[category]),
        share: monthExpense > 0 ? money_((byCategory[category] / monthExpense) * 100) : 0
      };
    })
    .sort(function (a, b) { return b.amount - a.amount; });

  var trend = [];
  for (var i = TREND_MONTHS - 1; i >= 0; i -= 1) {
    var key = shiftPeriod_(period, -i);
    var income = 0;
    var expense = 0;
    transactions.forEach(function (t) {
      if (!inPeriod_(t.date, key)) return;
      if (t.type === 'income') income += t.amount;
      if (t.type === 'expense') expense += t.amount;
    });
    trend.push({
      period: key,
      income: money_(income),
      expense: money_(expense),
      net: money_(income - expense)
    });
  }

  var recentTransactions = transactions
    .slice()
    .sort(function (a, b) {
      return String(b.date + b.createdAt).localeCompare(String(a.date + a.createdAt));
    })
    .slice(0, 8)
    .map(function (r) {
      var copy = {};
      for (var k in r) if (k !== '_row') copy[k] = r[k];
      return copy;
    });

  var openPositions = investments
    .filter(function (i) { return i.status === 'hold'; })
    .sort(function (a, b) {
      return b.quantity * b.buyPrice - a.quantity * a.buyPrice;
    })
    .map(decorateInvestment_);

  return {
    period: period,
    currency: (settings && settings.currency) || 'USD',
    netWorth: money_(liquidBalance + investmentCash + investedCost),
    liquidBalance: liquidBalance,
    /* Cash wallets only. */
    cashBalance: cashBalance,
    /* Positive = owed across every credit wallet. */
    creditDebt: creditDebt,
    creditLimit: creditLimit,
    /* What you could spend today and still clear every card: cash minus debt.
       Identical to `liquidBalance` by construction — named separately because
       "safe to spend" is the question the number answers, and because the two
       will stop being identical the day a credit wallet is not mode 'expense'. */
    safeToSpend: money_(cashBalance - creditDebt),
    creditUtilization: creditLimit > 0 ? money_((creditDebt / creditLimit) * 100) : 0,
    investedCost: investedCost,
    investmentCash: investmentCash,
    monthIncome: monthIncome,
    monthExpense: monthExpense,
    monthNet: money_(monthIncome - monthExpense),
    savingsRate: monthIncome > 0 ? money_(((monthIncome - monthExpense) / monthIncome) * 100) : 0,
    wallets: wallets,
    budgets: computeBudgetProgress_(user.id, period),
    recentTransactions: recentTransactions,
    openPositions: openPositions,
    categoryBreakdown: categoryBreakdown,
    trend: trend,
    positionCount: openPositions.length,
    walletCount: wallets.length
  };
}

function dashboardPeriods_(user) {
  var seen = {};
  seen[currentPeriod_()] = true;

  userRows_('Transactions', user.id).forEach(function (t) {
    if (t.date) seen[t.date.slice(0, 7)] = true;
  });
  userRows_('Budgets', user.id).forEach(function (b) {
    if (b.period) seen[periodOf_(b.period)] = true;
  });

  return Object.keys(seen).sort().reverse();
}

/* =========================================================================
 * Health
 * ========================================================================= */

function health_() {
  var rowCounts = {};
  Object.keys(SHEETS).forEach(function (name) {
    try {
      rowCounts[name] = readTable_(name).length;
    } catch (err) {
      rowCounts[name] = -1;
    }
  });

  return {
    ok: true,
    ready: true,
    dbPath: spreadsheet_().getUrl(),
    // Sheets writes are immediate, so these exist only to satisfy the client's
    // shape — there is no write buffer to be dirty and no file to be locked.
    dirty: false,
    lastFlushAt: new Date().toISOString(),
    lastError: null,
    fileLocked: false,
    rowCounts: rowCounts
  };
}

/* =========================================================================
 * One-time setup / diagnostics — run these from the Apps Script editor
 * ========================================================================= */

/** Verifies every sheet and header exists, and reports row counts. */
function setup() {
  var ss = spreadsheet_();
  var problems = [];

  Object.keys(SHEETS).forEach(function (name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) {
      problems.push('Missing sheet: ' + name);
      return;
    }
    var headers = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
      .getValues()[0]
      .map(function (h) { return String(h || '').trim().toLowerCase(); });

    SHEETS[name].columns.forEach(function (col) {
      if (headers.indexOf(col.header.toLowerCase()) === -1) {
        problems.push('Sheet "' + name + '" is missing column "' + col.header + '"');
      }
    });
  });

  ['SESSION_SECRET', 'ADMIN_SECRET'].forEach(function (key) {
    if (!PropertiesService.getScriptProperties().getProperty(key)) {
      problems.push('Script Property "' + key + '" is not set');
    }
  });

  if (problems.length) {
    Logger.log('SETUP PROBLEMS:\n - ' + problems.join('\n - '));
  } else {
    Logger.log('Setup OK. ' + JSON.stringify(health_().rowCounts));
  }
  return problems;
}

/**
 * Creates any sheet in SHEETS that the workbook does not have yet, with the
 * exact header row readTable_() expects, and adds any column missing from a
 * sheet that already exists.
 *
 * Run this once after pulling a version that adds a table — Subscriptions, for
 * instance. Existing data is never touched: it only ever appends.
 */
function createMissingSheets() {
  var ss = spreadsheet_();
  var created = [];
  var patched = [];

  Object.keys(SHEETS).forEach(function (name) {
    var def = SHEETS[name];
    var headers = def.columns.map(function (col) { return col.header; });
    var sheet = ss.getSheetByName(name);

    if (!sheet) {
      sheet = ss.insertSheet(name);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
      created.push(name);
      return;
    }

    var existing = sheet.getRange(1, 1, 1, Math.max(1, sheet.getLastColumn()))
      .getValues()[0]
      .map(function (h) { return String(h || '').trim().toLowerCase(); });

    var missing = headers.filter(function (header) {
      return existing.indexOf(header.toLowerCase()) === -1;
    });

    if (missing.length) {
      sheet.getRange(1, sheet.getLastColumn() + 1, 1, missing.length).setValues([missing]);
      patched.push(name + ' (+' + missing.join(', ') + ')');
    }
  });

  Logger.log(created.length ? 'Created: ' + created.join(', ') : 'No sheets needed creating.');
  if (patched.length) Logger.log('Added columns to: ' + patched.join('; '));
  return { created: created, patched: patched };
}

/**
 * Prints exactly what the Budgets sheet holds and why each row does or does not
 * match a period. Run from the Apps Script editor, then View -> Logs.
 *
 * The line to look at is RAW TYPE: "object" means Sheets parsed the text
 * "2026-08" into a date when it was written, which is what broke matching.
 */
function debugBudgets() {
  var period = currentPeriod_();
  var sheet = sheet_('Budgets');
  var values = sheet.getDataRange().getValues();
  var headers = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var col = headers.indexOf('period');

  Logger.log('Matching against period: ' + period);
  Logger.log('--- raw cells ---');
  for (var r = 1; r < values.length; r += 1) {
    var cell = values[r][col];
    Logger.log(
      'row ' + (r + 1) +
      ' | RAW TYPE: ' + (cell instanceof Date ? 'object (Date) <-- was parsed by Sheets' : typeof cell) +
      ' | RAW: ' + cell +
      ' | NORMALISED: "' + periodOf_(cell) + '"' +
      ' | MATCHES: ' + (periodOf_(cell) === period)
    );
  }

  var users = readTable_('Users');
  users.forEach(function (u) {
    var progress = computeBudgetProgress_(u.id, period);
    var tx = userRows_('Transactions', u.id).filter(function (t) { return inPeriod_(t.date, period); });
    Logger.log('--- ' + u.username + ' ---');
    Logger.log('  transactions in period: ' + tx.length +
               ' (expenses: ' + tx.filter(function (t) { return t.type === 'expense'; }).length + ')');
    Logger.log('  categories present: ' + JSON.stringify(tx.map(function (t) { return t.category; })));
    Logger.log('  budgets returned: ' + progress.length);
    progress.forEach(function (b) {
      Logger.log('    ' + b.scope + ' "' + b.targetId + '" limit=' + b.limit +
                 ' spent=' + b.spent + ' remaining=' + b.remaining + ' (' + b.percentUsed + '%)');
    });
  });
}

/**
 * One-shot cleanup: rewrites every Period cell as literal text.
 *
 * Not required for correctness -- periodOf_() already repairs these on read --
 * but it stops the column rendering as "Aug 1, 2026" in the sheet and makes the
 * stored value match what the API returns.
 */
function repairBudgetPeriods() {
  var sheet = sheet_('Budgets');
  var values = sheet.getDataRange().getValues();
  if (values.length < 2) { Logger.log('Budgets sheet is empty'); return 0; }

  var headers = values[0].map(function (h) { return String(h || '').trim().toLowerCase(); });
  var col = headers.indexOf('period');
  if (col < 0) { Logger.log('No Period column'); return 0; }

  var range = sheet.getRange(2, col + 1, values.length - 1, 1);
  range.setNumberFormat('@'); // plain text, so Sheets stops re-parsing on future writes

  var fixed = 0;
  var out = [];
  for (var r = 1; r < values.length; r += 1) {
    var cell = values[r][col];
    var normalised = periodOf_(cell);
    if (String(cell) !== normalised) fixed += 1;
    out.push([normalised]);
  }
  range.setValues(out);
  invalidate_('Budgets');

  Logger.log('Repaired ' + fixed + ' of ' + out.length + ' Period cells');
  return fixed;
}

/** Generates strong values for the two Script Properties. Run once, then copy
 *  the output into Project Settings → Script Properties. */
function generateSecrets() {
  var make = function () {
    return Utilities.base64EncodeWebSafe(
      Utilities.computeDigest(
        Utilities.DigestAlgorithm.SHA_256,
        Utilities.getUuid() + Date.now() + Math.random()
      )
    ).replace(/=+$/, '');
  };
  Logger.log('SESSION_SECRET = ' + make());
  Logger.log('ADMIN_SECRET   = ' + make());
}

/**
 * Re-hashes one account into the GAS password format. Edit the two constants,
 * run once, then delete what you typed. Needed for every account migrated from
 * the Node backend, whose scrypt hashes cannot be verified here.
 */
function migratePassword() {
  var USERNAME = 'porgz';
  var NEW_PASSWORD = '***********************';

  var user = readTable_('Users').filter(function (u) {
    return u.username === String(USERNAME).toLowerCase();
  })[0];
  if (!user) {
    Logger.log('No user named "' + USERNAME + '"');
    return;
  }

  var hashed = hashPassword_(NEW_PASSWORD);
  updateRow_('Users', user.id, { salt: hashed.salt, passwordHash: hashed.stored });
  Logger.log('Password updated for ' + USERNAME + '. Sign in with the new password.');
}

/* =========================================================================
 * Demo account seeder
 *
 * Builds a complete, self-consistent demo user so every screen has something
 * real to show: four months of transactions for the trend charts, a brokerage
 * wallet with four open positions and one closed one, and budgets deliberately
 * sized to land on all three status colours.
 *
 * Run seedDemoAccount() once from the editor, then sign in as demo / demo.
 * Every row goes through insertRow_(), so the schema, coercion and the
 * apostrophe guards on date and period cells are all applied for us.
 * ========================================================================= */

function seedDemoAccount() {
  var USERNAME = 'demo';
  var PASSWORD = 'demo';

  if (readTable_('Users').filter(function (u) { return u.username === USERNAME; })[0]) {
    Logger.log('A user named "' + USERNAME + '" already exists. ' +
               'Run deleteDemoAccount() first if you want to rebuild it.');
    return null;
  }

  var now = new Date();
  var nowIso = now.toISOString();

  /* ---------------------------------------------------------------- *
   * Dates. Offsets are months back from today; 0 is the current month.
   * ---------------------------------------------------------------- */

  function monthStart(offset) {
    return new Date(now.getFullYear(), now.getMonth() + offset, 1);
  }

  function periodAt(offset) {
    return toDateKey_(monthStart(offset)).slice(0, 7);
  }

  /**
   * A date key inside the given month. The current month is clamped to today,
   * so seeding on the 3rd never writes transactions dated in the future.
   */
  function dayAt(offset, wanted) {
    var start = monthStart(offset);
    var lastDay = new Date(start.getFullYear(), start.getMonth() + 1, 0).getDate();
    var latest = offset === 0 ? Math.min(now.getDate(), lastDay) : lastDay;
    var day = Math.min(Math.max(1, wanted), latest);
    return toDateKey_(new Date(start.getFullYear(), start.getMonth(), day));
  }

  /* ---------------------------------------------------------------- *
   * User + settings
   * ---------------------------------------------------------------- */

  var hashed = hashPassword_(PASSWORD);
  var userId = uuid_();

  insertRow_('Users', {
    id: userId,
    username: USERNAME,
    displayName: 'Demo User',
    salt: hashed.salt,
    passwordHash: hashed.stored,
    active: true,
    createdAt: monthStart(-3).toISOString()
  });

  var MONTHLY_INCOME = 65000;

  insertRow_('Settings', {
    userId: userId,
    theme: 'dark',
    accent: '#4f8cff',
    customVars: {},
    currency: 'THB',
    // Left blank so the app reports in THB only. Set this to 'USD' plus an
    // fxRate if you want the secondary-currency display on the dashboard.
    displayCurrency: '',
    fxRate: 1,
    fxRateUpdatedAt: '',
    locale: 'th-TH',
    // Percent budgets divide into this rather than into recorded income, which
    // keeps the numbers stable no matter which day of the month you seed on.
    monthlyIncome: MONTHLY_INCOME,
    categories: [
      'Salary', 'Bonus', 'Investment Income',
      'Rent', 'Groceries', 'Utilities', 'Transport', 'Health', 'Insurance',
      'Dining', 'Entertainment', 'Shopping', 'Subscriptions', 'Travel',
      'Education', 'Gifts', 'Fees', 'Save', 'Invest', 'Other'
    ],
    updatedAt: nowIso
  });

  /* ---------------------------------------------------------------- *
   * Wallets
   * ---------------------------------------------------------------- */

  var wallets = {
    bank:   { id: uuid_(), name: 'K-PLUS', mode: 'expense',    kind: 'bank',      opening: 50000, color: '#22c55e', icon: '\u{1F3E6}', note: 'Main salary account' },
    cash:   { id: uuid_(), name: 'Cash',   mode: 'expense',    kind: 'cash',      opening: 2000,  color: '#f59e0b', icon: '\u{1F4B5}', note: 'Wallet cash' },
    invest: { id: uuid_(), name: 'Dime!',  mode: 'investment', kind: 'brokerage', opening: 5000,  color: '#6366f1', icon: '\u{1F4C8}', note: 'US equities, settled in THB' }
  };

  ['bank', 'cash', 'invest'].forEach(function (key) {
    var w = wallets[key];
    insertRow_('Wallets', {
      id: w.id, userId: userId, name: w.name, mode: w.mode, kind: w.kind,
      currency: 'THB', openingBalance: w.opening, color: w.color, icon: w.icon,
      archived: false, note: w.note, createdAt: monthStart(-3).toISOString()
    });
  });

  /* ---------------------------------------------------------------- *
   * Transactions
   *
   * Columns: monthOffset, day, type, wallet, amount, category, note, toWallet
   *
   * Current-month expenses are sized against the budgets defined below:
   *   Groceries    5,200 of  8,000                 -> ok
   *   Dining       4,300 of  5,000                 -> warning
   *   Shopping     5,450 of  4,000                 -> over
   *   Cash wallet  1,870 of  2,500                 -> ok
   *   All spending 32,739 of 45,500 (70% of income) -> ok
   * ---------------------------------------------------------------- */

  var TX = [
    /* ---- current month ---- */
    [0,  1, 'income',   'bank', 65000, 'Salary',        'Monthly salary'],
    [0, 12, 'income',   'bank', 15000, 'Bonus',         'Mid-year performance bonus'],

    [0,  1, 'expense',  'bank', 12000, 'Rent',          'Condo rent'],
    [0,  4, 'expense',  'bank',  1850, 'Utilities',     'MEA electricity'],
    [0,  4, 'expense',  'bank',   599, 'Utilities',     'AIS Fibre'],
    [0,  3, 'expense',  'bank',  1450, 'Groceries',     'Big C weekly run'],
    [0,  9, 'expense',  'bank',   980, 'Groceries',     'Lotus top-up'],
    [0, 16, 'expense',  'bank',  1320, 'Groceries',     'Makro bulk buy'],
    [0, 23, 'expense',  'bank',  1450, 'Groceries',     'Villa Market'],
    [0,  2, 'expense',  'cash',   620, 'Dining',        'Som tam and gai yang'],
    [0,  7, 'expense',  'bank',  1180, 'Dining',        'Dinner with friends'],
    [0, 11, 'expense',  'cash',   450, 'Dining',        'Coffee and work'],
    [0, 18, 'expense',  'bank',   890, 'Dining',        'Sunday brunch'],
    [0, 24, 'expense',  'bank',  1160, 'Dining',        'Ramen night'],
    [0,  6, 'expense',  'bank',  3200, 'Shopping',      'Running shoes'],
    [0, 14, 'expense',  'bank',  1450, 'Shopping',      'Uniqlo restock'],
    [0, 21, 'expense',  'bank',   800, 'Shopping',      'Phone case and cable'],
    [0,  5, 'expense',  'cash',   420, 'Transport',     'BTS card top-up'],
    [0, 19, 'expense',  'cash',   380, 'Transport',     'Grab to the airport'],
    [0, 13, 'expense',  'bank',  1200, 'Health',        'Dental cleaning'],
    [0,  8, 'expense',  'bank',   350, 'Entertainment', 'Netflix and Spotify'],
    [0, 17, 'expense',  'bank',   990, 'Education',     'Udemy course'],

    [0,  2, 'transfer', 'bank',  3000, 'Other',         'Cash withdrawal', 'cash'],
    [0,  5, 'transfer', 'bank', 10000, 'Invest',        'Monthly DCA',     'invest'],

    /* ---- last month ---- */
    [-1,  1, 'income',   'bank', 62000, 'Salary',        'Monthly salary'],
    [-1,  1, 'expense',  'bank', 12000, 'Rent',          'Condo rent'],
    [-1,  4, 'expense',  'bank',  2300, 'Utilities',     'Electricity and internet'],
    [-1, 10, 'expense',  'bank',  6100, 'Groceries',     'Groceries for the month'],
    [-1, 14, 'expense',  'bank',  3800, 'Dining',        'Eating out'],
    [-1, 20, 'expense',  'bank',  2400, 'Shopping',      'Household bits'],
    [-1,  8, 'expense',  'bank',   350, 'Entertainment', 'Netflix and Spotify'],
    [-1, 22, 'expense',  'bank',   800, 'Health',        'Pharmacy'],
    [-1,  7, 'expense',  'cash',   900, 'Transport',     'BTS and Grab'],
    [-1,  2, 'transfer', 'bank',  2000, 'Other',         'Cash withdrawal', 'cash'],
    [-1,  5, 'transfer', 'bank', 12000, 'Invest',        'Monthly DCA',     'invest'],

    /* ---- two months ago: the expensive one, so the trend has a peak ---- */
    [-2,  1, 'income',   'bank', 62000, 'Salary',        'Monthly salary'],
    [-2,  1, 'expense',  'bank', 12000, 'Rent',          'Condo rent'],
    [-2,  4, 'expense',  'bank',  2600, 'Utilities',     'Electricity and internet'],
    [-2, 11, 'expense',  'bank',  5600, 'Groceries',     'Groceries for the month'],
    [-2, 15, 'expense',  'bank',  4900, 'Dining',        'Eating out'],
    [-2, 18, 'expense',  'bank',  6800, 'Shopping',      'New monitor'],
    [-2,  8, 'expense',  'bank',   350, 'Entertainment', 'Netflix and Spotify'],
    [-2, 25, 'expense',  'bank',  2500, 'Travel',        'Songkran trip'],
    [-2,  7, 'expense',  'cash',  1100, 'Transport',     'BTS and Grab'],
    [-2,  2, 'transfer', 'bank',  2000, 'Other',         'Cash withdrawal', 'cash'],
    [-2,  5, 'transfer', 'bank', 12000, 'Invest',        'Monthly DCA',     'invest'],

    /* ---- three months ago ---- */
    [-3,  1, 'income',   'bank', 62000, 'Salary',        'Monthly salary'],
    [-3, 20, 'income',   'bank', 20000, 'Bonus',         'Annual bonus'],
    [-3,  1, 'expense',  'bank', 12000, 'Rent',          'Condo rent'],
    [-3,  4, 'expense',  'bank',  2100, 'Utilities',     'Electricity and internet'],
    [-3, 12, 'expense',  'bank',  5900, 'Groceries',     'Groceries for the month'],
    [-3, 16, 'expense',  'bank',  3200, 'Dining',        'Eating out'],
    [-3, 19, 'expense',  'bank',  1900, 'Shopping',      'Clothes'],
    [-3,  8, 'expense',  'bank',   350, 'Entertainment', 'Netflix and Spotify'],
    [-3,  6, 'expense',  'cash',   850, 'Transport',     'BTS and Grab'],
    [-3,  2, 'transfer', 'bank',  2000, 'Other',         'Cash withdrawal', 'cash'],
    [-3,  5, 'transfer', 'bank', 15000, 'Invest',        'Opening the brokerage account', 'invest']
  ];

  TX.forEach(function (row) {
    insertRow_('Transactions', {
      id: uuid_(),
      userId: userId,
      walletId: wallets[row[3]].id,
      toWalletId: row[7] ? wallets[row[7]].id : '',
      type: row[2],
      amount: row[4],
      category: row[5],
      note: row[6],
      date: dayAt(row[0], row[1]),
      createdAt: nowIso
    });
  });

  /* ---------------------------------------------------------------- *
   * Investments
   *
   * buyPrice is per share in THB, the base currency — the same figure the buy
   * form produces once a USD price has been converted. The USD price it came
   * from is kept in the note so the arithmetic can be checked by eye.
   *
   * Columns: monthOffset, day, symbol, qty, thbPerShare, fees, tags, note
   * ---------------------------------------------------------------- */

  var HOLDINGS = [
    [-3, 15, 'NVDA',  2,  3500, 40, 'semis;ai',     'Bought at about $105 at 33.30 THB/USD'],
    [-2,  6, 'AAPL',  1,  6900, 30, 'bluechip',     'Bought at about $208 at 33.15 THB/USD'],
    [-2, 19, 'MSFT',  1, 14200, 45, 'bluechip;ai',  'Bought at about $428 at 33.18 THB/USD'],
    [-1,  9, 'GOOGL', 3,  5900, 35, 'bluechip;ads', 'Bought at about $178 at 33.15 THB/USD']
  ];

  HOLDINGS.forEach(function (row) {
    insertRow_('Investments', {
      id: uuid_(), userId: userId, walletId: wallets.invest.id,
      symbol: row[2], quantity: row[3], buyPrice: row[4], fees: row[5],
      buyDate: dayAt(row[0], row[1]),
      tags: row[6], status: 'hold', sellPrice: 0, sellDate: '',
      note: row[7], createdAt: nowIso
    });
  });

  // One closed position so the Investments page has realised PnL to show:
  // 2 x 7,800 + 50 fees = 15,650 cost, sold for 18,800 -> +3,150 realised.
  insertRow_('Investments', {
    id: uuid_(), userId: userId, walletId: wallets.invest.id,
    symbol: 'TSLA', quantity: 2, buyPrice: 7800, fees: 50,
    buyDate: dayAt(-3, 8),
    tags: 'ev;volatile', status: 'sold',
    sellPrice: 9400, sellDate: dayAt(-1, 20),
    note: 'Bought at about $236, sold at about $285. Realised +3,150 THB.',
    createdAt: nowIso
  });

  /* ---------------------------------------------------------------- *
   * Budgets
   *
   * Sized against the current-month spending above so the list shows one of
   * every status the UI can render.
   * ---------------------------------------------------------------- */

  var thisPeriod = periodAt(0);
  var lastPeriod = periodAt(-1);

  var BUDGETS = [
    // period,   scope,       targetId,    label,          mode,      value, note
    [thisPeriod, 'category', 'Groceries', 'Groceries',    'amount',   8000, 'Spent 5,200 — comfortably on track'],
    [thisPeriod, 'category', 'Dining',    'Dining',       'amount',   5000, 'Spent 4,300 — approaching the limit'],
    [thisPeriod, 'category', 'Shopping',  'Shopping',     'amount',   4000, 'Spent 5,450 — over budget'],
    [thisPeriod, 'wallet',   'cash',      'Cash',         'amount',   2500, 'Keeps pocket spending in check'],
    [thisPeriod, 'global',   '',          'All spending', 'percent',    70, '70% of monthly income'],
    // Last month too, so the period switcher and "Copy last month" have data.
    [lastPeriod, 'category', 'Groceries', 'Groceries',    'amount',   8000, ''],
    [lastPeriod, 'category', 'Dining',    'Dining',       'amount',   5000, '']
  ];

  BUDGETS.forEach(function (row) {
    var scope = row[1];
    insertRow_('Budgets', {
      id: uuid_(), userId: userId,
      period: row[0], scope: scope,
      // Wallet budgets point at a wallet id; category budgets at the name.
      targetId: scope === 'wallet' ? wallets[row[2]].id : row[2],
      targetLabel: row[3],
      mode: row[4], value: row[5], baseIncome: 0,
      note: row[6],
      createdAt: nowIso
    });
  });

  /* ---------------------------------------------------------------- *
   * Report what was built
   * ---------------------------------------------------------------- */

  var balances = computeWalletBalances_(userId, thisPeriod);
  var progress = computeBudgetProgress_(userId, thisPeriod);

  Logger.log('Seeded demo account — sign in as ' + USERNAME + ' / ' + PASSWORD);
  Logger.log('  transactions: ' + TX.length + '   investments: ' + (HOLDINGS.length + 1) +
             '   budgets: ' + BUDGETS.length);
  Logger.log('  wallets:');
  balances.forEach(function (w) {
    Logger.log('    ' + w.name + ': balance ' + w.balance +
               (w.investedCost ? ', invested ' + w.investedCost : ''));
  });
  Logger.log('  budgets for ' + thisPeriod + ':');
  progress.forEach(function (b) {
    Logger.log('    ' + b.targetLabel + ': ' + b.spent + ' / ' + b.limit +
               ' (' + b.percentUsed + '%) -> ' + b.status);
  });

  return { userId: userId, username: USERNAME, period: thisPeriod };
}

/**
 * Removes the demo user and everything belonging to it, so seedDemoAccount()
 * can be run again from clean. Touches nothing owned by any other account.
 */
function deleteDemoAccount() {
  var user = readTable_('Users').filter(function (u) { return u.username === 'demo'; })[0];
  if (!user) {
    Logger.log('No demo account to remove.');
    return 0;
  }

  var removed = 0;
  ['Transactions', 'Investments', 'Budgets', 'Wallets'].forEach(function (name) {
    removed += deleteWhere_(name, function (row) { return row.userId === user.id; });
  });
  removed += deleteWhere_('Settings', function (row) { return row.userId === user.id; });
  removed += deleteWhere_('Users', function (row) { return row.id === user.id; });

  Logger.log('Removed the demo account and ' + removed + ' rows.');
  return removed;
}
