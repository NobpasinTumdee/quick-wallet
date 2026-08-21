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
      { key: 'createdAt', header: 'Created At', type: 'date' }
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
      { key: 'createdAt', header: 'Created At', type: 'date' }
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
      { key: 'updatedAt', header: 'Updated At', type: 'date' }
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

    'auth.users': function () { return authUsers_(); },
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

    'settings.get': function () { return settingsGet_(requireAuth_(token)); },
    'settings.save': function () { return settingsSave_(requireAuth_(token), body); },

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
    updatedAt: new Date().toISOString()
  };
}

/* ---- auth actions ---- */

function authUsers_() {
  var users = readTable_('Users')
    .filter(function (u) { return u.active !== false; })
    .map(function (u) {
      return { id: u.id, username: u.username, displayName: u.displayName };
    });
  return { users: users, needsSetup: users.length === 0 };
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
 * Wallet balance = opening + income - expense + transfers in - transfers out,
 * then investment wallets additionally convert cash into holdings on buy and
 * back into cash on sell.
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
  var wallet = {
    id: uuid_(),
    userId: user.id,
    name: name,
    mode: mode,
    kind: oneOf_(body.kind, 'kind', WALLET_KINDS, mode === 'investment' ? 'brokerage' : 'cash'),
    currency: (str_(body.currency, 'currency', { required: false, max: 8 }) || 'USD').toUpperCase(),
    openingBalance: num_(body.openingBalance, 'openingBalance', {}),
    color: str_(body.color, 'color', { required: false, max: 20 }) || '#4f8cff',
    icon: str_(body.icon, 'icon', { required: false, max: 8 }) ||
      (mode === 'investment' ? '📈' : '💳'),
    archived: false,
    note: str_(body.note, 'note', { required: false, max: 300 }),
    createdAt: new Date().toISOString()
  };

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
    date: isoDate_(body.date || toDateKey_(new Date()), 'date')
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
    createdAt: new Date().toISOString()
  };
  insertRow_('Transactions', tx);
  return tx;
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

function investmentsList_(user, query) {
  var rows = userRows_('Investments', user.id);

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
 * Settings
 * ========================================================================= */

var THEMES = ['light', 'dark', 'custom'];

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
    return existing;
  }
  return insertRow_('Settings', defaultSettings_(user.id));
}

function settingsSave_(user, body) {
  var current = getSettingsRow_(user.id) || defaultSettings_(user.id);

  var next = {
    userId: user.id,
    theme: body.theme !== undefined ? oneOf_(body.theme, 'theme', THEMES) : current.theme,
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
    updatedAt: new Date().toISOString()
  };

  var saved = findById_('Settings', user.id)
    ? updateRow_('Settings', user.id, next)
    : insertRow_('Settings', next);

  delete saved._row;
  return saved;
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

  var liquidBalance = 0;
  var investmentCash = 0;
  var investedCost = 0;
  wallets.forEach(function (w) {
    if (w.mode === 'expense') liquidBalance += w.balance;
    else investmentCash += w.balance;
    investedCost += w.investedCost;
  });
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
