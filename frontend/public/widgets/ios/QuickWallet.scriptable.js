// Variables used by Scriptable.
// These must be at the very top of the file. Do not edit.
// icon-color: blue; icon-glyph: wallet;

/*
 * Quick Wallet — home-screen and lock-screen widget for Scriptable (iOS).
 *
 * Setup (full guide: docs/widgets/README-th.md):
 *   1. Paste this whole file into a new Scriptable script.
 *   2. Fill in API_URL and APP_URL below (the app's "Copy script" button
 *      fills them for you).
 *   3. Run the script once inside Scriptable and paste your token when asked.
 *      It is kept in the iOS Keychain, not in this file.
 *   4. Add a Scriptable widget, choose this script, and optionally set a
 *      Parameter, for example:
 *        layout=medium-grid; lang=th
 *        layout=medium-list; wallets=KBank,Cash; hide=1
 *        layout=large; buttons=shortcut
 *
 * Layouts: small-total, small-wallets, medium-grid, medium-list, large, and
 * the lock-screen sizes (inline, rectangular, circular), picked automatically
 * from the widget size when no layout is given.
 */

const API_URL = ''; // Your Apps Script web app URL, ending in /exec
const APP_URL = ''; // Your Quick Wallet address, e.g. https://example.netlify.app/
const TOKEN = ''; // Leave empty: the token is asked for once and kept in the Keychain

const KEYCHAIN_KEY = 'quickwallet.widget.token';
const CACHE_FILE = 'quickwallet-widget-cache.json';
const REFRESH_MINUTES = 20;

// <shared:SHORTCUT_NAMES>
const SHORTCUT_NAMES = {
  expense: 'Quick Wallet: รายจ่าย',
  income: 'Quick Wallet: รายรับ',
  transfer: 'Quick Wallet: โอน',
};
// </shared:SHORTCUT_NAMES>

// <shared:parseWidgetParameter>
const WIDGET_LAYOUTS = ['small-total', 'small-wallets', 'medium-grid', 'medium-list', 'large'];

function parseWidgetParameter(text) {
  const out = {};
  String(text === null || text === undefined ? '' : text)
    .split(/[;&\n]/)
    .forEach((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return;
      const key = part.slice(0, eq).trim().toLowerCase();
      const value = part.slice(eq + 1).trim();
      if (key === 'layout') {
        const layout = value.toLowerCase();
        if (WIDGET_LAYOUTS.includes(layout)) out.layout = layout;
      } else if (key === 'wallets') {
        const list = value.split(',').map((s) => s.trim()).filter(Boolean);
        if (list.length) out.wallets = list.slice(0, 12);
      } else if (key === 'hide') {
        out.hide = /^(1|true|yes|on)$/i.test(value);
      } else if (key === 'lang') {
        const lang = value.toLowerCase();
        if (lang === 'th' || lang === 'en') out.lang = lang;
      } else if (key === 'buttons') {
        const mode = value.toLowerCase();
        if (mode === 'app' || mode === 'shortcut') out.buttons = mode;
      }
    });
  return out;
}
// </shared:parseWidgetParameter>

/* ---------------------------------------------------------------- */
/* Text                                                              */
/* ---------------------------------------------------------------- */

const TEXT = {
  th: {
    total: 'ยอดรวม',
    updated: 'อัปเดต',
    stale: 'ข้อมูลเก่า',
    expense: 'จ่าย',
    income: 'รับ',
    transfer: 'โอน',
    atCost: 'ต้นทุนหุ้น',
    setup: 'แตะเพื่อตั้งค่า Quick Wallet',
    noData: 'ยังไม่มีข้อมูล',
    askToken: 'วางโทเคนวิดเจ็ต',
    askTokenBody: 'คัดลอกโทเคนจากแอป: ตั้งค่า → วิดเจ็ตและทางลัด',
    save: 'บันทึก',
    cancel: 'ยกเลิก',
    menu: 'Quick Wallet วิดเจ็ต',
    previewAll: 'ดูตัวอย่างทุกแบบ',
    changeToken: 'เปลี่ยนโทเคน',
    clearCache: 'ล้างแคช',
    missingConfig: 'ใส่ API_URL และ APP_URL ที่ด้านบนของสคริปต์ก่อน',
  },
  en: {
    total: 'Total',
    updated: 'Updated',
    stale: 'Stale',
    expense: 'Expense',
    income: 'Income',
    transfer: 'Transfer',
    atCost: 'stocks at cost',
    setup: 'Tap to set up Quick Wallet',
    noData: 'No data yet',
    askToken: 'Paste your widget token',
    askTokenBody: 'Copy it in the app: Settings → Widgets & shortcuts',
    save: 'Save',
    cancel: 'Cancel',
    menu: 'Quick Wallet widget',
    previewAll: 'Preview every layout',
    changeToken: 'Change token',
    clearCache: 'Clear cache',
    missingConfig: 'Fill in API_URL and APP_URL at the top of the script first',
  },
};

/* ---------------------------------------------------------------- */
/* Colours: close to the app's default palette, light and dark       */
/* ---------------------------------------------------------------- */

const C = {
  bg: Color.dynamic(new Color('#f4f6fb'), new Color('#0d1220')),
  card: Color.dynamic(new Color('#ffffff'), new Color('#161d31')),
  text: Color.dynamic(new Color('#121826'), new Color('#eef2fb')),
  muted: Color.dynamic(new Color('#5b6478'), new Color('#9aa5bd')),
  accent: Color.dynamic(new Color('#2f6fe0'), new Color('#4f8cff')),
  negative: Color.dynamic(new Color('#c62a32'), new Color('#ff6b70')),
  positive: Color.dynamic(new Color('#14804a'), new Color('#3ddc84')),
  warning: Color.dynamic(new Color('#a35c00'), new Color('#f5b041')),
};

/* ---------------------------------------------------------------- */
/* Data                                                              */
/* ---------------------------------------------------------------- */

function cachePath() {
  const fm = FileManager.local();
  return fm.joinPath(fm.documentsDirectory(), CACHE_FILE);
}

function readCache() {
  try {
    const fm = FileManager.local();
    const path = cachePath();
    if (!fm.fileExists(path)) return null;
    return JSON.parse(fm.readString(path));
  } catch (err) {
    return null;
  }
}

function writeCache(data) {
  try {
    FileManager.local().writeString(cachePath(), JSON.stringify(data));
  } catch (err) {
    /* A full disk only costs the offline fallback. */
  }
}

function getToken() {
  if (TOKEN) return TOKEN;
  return Keychain.contains(KEYCHAIN_KEY) ? Keychain.get(KEYCHAIN_KEY) : '';
}

async function askForToken(t) {
  const alert = new Alert();
  alert.title = t.askToken;
  alert.message = t.askTokenBody;
  alert.addSecureTextField('qw_…', '');
  alert.addAction(t.save);
  alert.addCancelAction(t.cancel);
  const choice = await alert.presentAlert();
  if (choice === -1) return '';
  const value = alert.textFieldValue(0).trim();
  if (value) Keychain.set(KEYCHAIN_KEY, value);
  return value;
}

/** Reads through POST, so the token stays out of URLs and logs. */
async function fetchWidget(token, lang) {
  const req = new Request(API_URL);
  req.method = 'POST';
  req.timeoutInterval = 20;
  req.headers = { 'Content-Type': 'text/plain;charset=utf-8' };
  req.body = JSON.stringify({ action: 'widget', method: 'GET', token, query: lang ? { lang } : {} });
  const data = await req.loadJSON();
  if (!data || data.ok !== true) {
    const err = new Error((data && data.error) || 'Request failed');
    err.code = data && data.code;
    throw err;
  }
  return data;
}

async function loadData(lang) {
  const token = getToken();
  if (!API_URL || !token) return { data: readCache(), stale: true, setup: true };
  try {
    const data = await fetchWidget(token, lang);
    writeCache(data);
    return { data, stale: false, setup: false };
  } catch (err) {
    /* Offline or an error: the last good figures, marked stale — never blank. */
    return { data: readCache(), stale: true, setup: err && err.code === 'TOKEN_INVALID', error: err };
  }
}

/* ---------------------------------------------------------------- */
/* Links                                                             */
/* ---------------------------------------------------------------- */

function actionUrl(type, param) {
  if (param.buttons === 'shortcut') {
    return 'shortcuts://run-shortcut?name=' + encodeURIComponent(SHORTCUT_NAMES[type]);
  }
  if (!APP_URL) return '';
  const sep = APP_URL.indexOf('?') === -1 ? '?' : '&';
  return APP_URL + sep + 'quick=' + type;
}

/* ---------------------------------------------------------------- */
/* Helpers                                                           */
/* ---------------------------------------------------------------- */

function pickWallets(data, param, max) {
  let list = (data && data.wallets) || [];
  if (param.wallets && param.wallets.length) {
    const wanted = param.wallets.map((w) => w.toLowerCase());
    const picked = [];
    wanted.forEach((key) => {
      const hit = list.find((w) => w.id.toLowerCase() === key || String(w.name).toLowerCase() === key);
      if (hit && picked.indexOf(hit) === -1) picked.push(hit);
    });
    list = picked;
  }
  return list.slice(0, max);
}

function masked(param, data) {
  return param.hide === true || (data && data.hideAmounts === true);
}

function amountText(value, param, data) {
  return masked(param, data) ? '•••' : value;
}

function timeLabel(data) {
  if (!data || !data.updatedAt) return '';
  const df = new DateFormatter();
  df.useNoDateStyle();
  df.useShortTimeStyle();
  return df.string(new Date(data.updatedAt));
}

function addText(stack, text, font, color, opts) {
  const el = stack.addText(String(text === undefined || text === null ? '' : text));
  el.font = font;
  el.textColor = color;
  el.lineLimit = (opts && opts.lines) || 1;
  if (opts && opts.scale) el.minimumScaleFactor = opts.scale;
  if (opts && opts.align === 'right') el.rightAlignText();
  return el;
}

function header(widget, t, state) {
  const row = widget.addStack();
  row.centerAlignContent();
  addText(row, 'Quick Wallet', Font.semiboldSystemFont(11), C.accent);
  row.addSpacer();
  if (state.stale) addText(row, t.stale, Font.mediumSystemFont(10), C.warning);
}

function totalBlock(widget, data, param, t, size, useShort) {
  const label = data && data.totalNote ? data.totalNote : t.total;
  addText(widget, label, Font.mediumSystemFont(11), C.muted, { scale: 0.8 });
  const value = data ? amountText(useShort ? data.totalShort : data.totalText, param, data) : '—';
  addText(widget, value, Font.boldRoundedSystemFont(size), C.text, { scale: 0.5 });
}

function walletRow(stack, w, param, data, useShort) {
  const row = stack.addStack();
  row.centerAlignContent();
  addText(row, w.name, Font.systemFont(12), C.muted, { scale: 0.8 });
  row.addSpacer();
  const value = amountText(useShort ? w.short : w.text, param, data);
  addText(row, value, Font.semiboldRoundedSystemFont(12), w.negative && !masked(param, data) ? C.negative : C.text, {
    scale: 0.6,
    align: 'right',
  });
}

function walletCell(stack, w, param, data) {
  const cell = stack.addStack();
  cell.layoutVertically();
  addText(cell, w.name, Font.systemFont(11), C.muted, { scale: 0.8 });
  addText(cell, amountText(w.short, param, data), Font.semiboldRoundedSystemFont(14),
    w.negative && !masked(param, data) ? C.negative : C.text, { scale: 0.6 });
}

function buttonsRow(widget, param, t) {
  const row = widget.addStack();
  row.spacing = 6;
  [
    ['expense', '−', t.expense, C.negative],
    ['income', '+', t.income, C.positive],
    ['transfer', '⇄', t.transfer, C.accent],
  ].forEach(([type, glyph, label, color]) => {
    const btn = row.addStack();
    btn.backgroundColor = C.card;
    btn.cornerRadius = 10;
    btn.setPadding(6, 8, 6, 8);
    btn.centerAlignContent();
    const url = actionUrl(type, param);
    if (url) btn.url = url;
    addText(btn, glyph + ' ', Font.boldSystemFont(13), color);
    addText(btn, label, Font.mediumSystemFont(12), C.text, { scale: 0.7 });
    if (type !== 'transfer') row.addSpacer();
  });
}

function footer(widget, data, t) {
  const time = timeLabel(data);
  if (time) addText(widget, t.updated + ' ' + time, Font.systemFont(9), C.muted);
}

function baseWidget(param) {
  const widget = new ListWidget();
  widget.backgroundColor = C.bg;
  widget.setPadding(12, 14, 12, 14);
  widget.refreshAfterDate = new Date(Date.now() + REFRESH_MINUTES * 60 * 1000);
  const url = actionUrl('expense', param);
  if (url) widget.url = url;
  return widget;
}

/* ---------------------------------------------------------------- */
/* Layouts                                                           */
/* ---------------------------------------------------------------- */

function buildSetup(t) {
  const widget = new ListWidget();
  widget.backgroundColor = C.bg;
  addText(widget, 'Quick Wallet', Font.semiboldSystemFont(12), C.accent);
  widget.addSpacer(6);
  addText(widget, API_URL ? t.setup : t.missingConfig, Font.systemFont(12), C.text, { lines: 3 });
  return widget;
}

const LAYOUTS = {
  'small-total'(state, param, t) {
    const widget = baseWidget(param);
    header(widget, t, state);
    widget.addSpacer();
    totalBlock(widget, state.data, param, t, 26, false);
    widget.addSpacer();
    footer(widget, state.data, t);
    return widget;
  },

  'small-wallets'(state, param, t) {
    const widget = baseWidget(param);
    header(widget, t, state);
    widget.addSpacer(4);
    totalBlock(widget, state.data, param, t, 20, true);
    widget.addSpacer(6);
    pickWallets(state.data, param, 3).forEach((w) => {
      walletRow(widget, w, param, state.data, true);
      widget.addSpacer(2);
    });
    widget.addSpacer();
    footer(widget, state.data, t);
    return widget;
  },

  'medium-grid'(state, param, t) {
    const widget = baseWidget(param);
    header(widget, t, state);
    widget.addSpacer(2);
    const top = widget.addStack();
    const left = top.addStack();
    left.layoutVertically();
    totalBlock(left, state.data, param, t, 22, false);
    footer(left, state.data, t);
    top.addSpacer(10);
    const grid = top.addStack();
    grid.layoutVertically();
    grid.spacing = 4;
    const wallets = pickWallets(state.data, param, 4);
    for (let i = 0; i < wallets.length; i += 2) {
      const row = grid.addStack();
      row.spacing = 8;
      walletCell(row, wallets[i], param, state.data);
      if (wallets[i + 1]) walletCell(row, wallets[i + 1], param, state.data);
    }
    widget.addSpacer();
    buttonsRow(widget, param, t);
    return widget;
  },

  'medium-list'(state, param, t) {
    const widget = baseWidget(param);
    header(widget, t, state);
    widget.addSpacer(2);
    const top = widget.addStack();
    const left = top.addStack();
    left.layoutVertically();
    left.size = new Size(120, 0);
    totalBlock(left, state.data, param, t, 20, true);
    left.addSpacer();
    footer(left, state.data, t);
    top.addSpacer(10);
    const list = top.addStack();
    list.layoutVertically();
    list.spacing = 3;
    pickWallets(state.data, param, 5).forEach((w) => walletRow(list, w, param, state.data, true));
    return widget;
  },

  large(state, param, t) {
    const widget = baseWidget(param);
    header(widget, t, state);
    widget.addSpacer(6);
    totalBlock(widget, state.data, param, t, 30, false);
    footer(widget, state.data, t);
    widget.addSpacer(10);
    const wallets = pickWallets(state.data, param, 8);
    if (!wallets.length) addText(widget, t.noData, Font.systemFont(12), C.muted);
    wallets.forEach((w) => {
      walletRow(widget, w, param, state.data, false);
      widget.addSpacer(5);
    });
    widget.addSpacer();
    buttonsRow(widget, param, t);
    return widget;
  },

  /* Lock screen. One tap target each; colours come from the system. */
  accessoryInline(state, param, t) {
    const widget = new ListWidget();
    const d = state.data;
    const value = d ? amountText(d.totalShort, param, d) : '—';
    const note = d && d.totalNote ? ' · ' + t.atCost : '';
    widget.addText('QW ' + value + note + (state.stale ? ' ·!' : ''));
    const url = actionUrl('expense', param);
    if (url) widget.url = url;
    return widget;
  },

  accessoryRectangular(state, param, t) {
    const widget = new ListWidget();
    const d = state.data;
    const head = widget.addText((d && d.totalNote ? d.totalNote : t.total) + (state.stale ? ' · ' + t.stale : ''));
    head.font = Font.mediumSystemFont(11);
    head.lineLimit = 1;
    head.minimumScaleFactor = 0.7;
    const total = widget.addText(d ? amountText(d.totalText, param, d) : '—');
    total.font = Font.boldRoundedSystemFont(16);
    total.lineLimit = 1;
    total.minimumScaleFactor = 0.5;
    pickWallets(d, param, 2).forEach((w) => {
      const line = widget.addText(w.name + '  ' + amountText(w.short, param, d));
      line.font = Font.systemFont(11);
      line.lineLimit = 1;
      line.minimumScaleFactor = 0.7;
    });
    const url = actionUrl('expense', param);
    if (url) widget.url = url;
    return widget;
  },

  accessoryCircular(state, param, t) {
    const widget = new ListWidget();
    const d = state.data;
    const value = widget.addText(d ? amountText(d.totalShort, param, d) : '—');
    value.font = Font.boldRoundedSystemFont(14);
    value.minimumScaleFactor = 0.5;
    value.lineLimit = 1;
    value.centerAlignText();
    const sub = widget.addText(d && d.totalNote ? t.atCost : state.stale ? t.stale : 'QW');
    sub.font = Font.systemFont(8);
    sub.lineLimit = 1;
    sub.minimumScaleFactor = 0.6;
    sub.centerAlignText();
    const url = actionUrl('expense', param);
    if (url) widget.url = url;
    return widget;
  },
};

const FAMILY_DEFAULT = {
  small: 'small-total',
  medium: 'medium-grid',
  large: 'large',
  extraLarge: 'large',
  accessoryInline: 'accessoryInline',
  accessoryRectangular: 'accessoryRectangular',
  accessoryCircular: 'accessoryCircular',
};

function build(state, param, t, layout) {
  if (state.setup && !state.data) return buildSetup(t);
  return (LAYOUTS[layout] || LAYOUTS['small-total'])(state, param, t);
}

/* ---------------------------------------------------------------- */
/* Main                                                              */
/* ---------------------------------------------------------------- */

async function main() {
  const param = parseWidgetParameter(args.widgetParameter);
  const lang = param.lang || (Device.language().indexOf('th') === 0 ? 'th' : 'en');
  const t = TEXT[lang];

  if (config.runsInWidget) {
    const family = config.widgetFamily || 'small';
    const isAccessory = family.indexOf('accessory') === 0;
    const layout = isAccessory ? family : param.layout || FAMILY_DEFAULT[family] || 'small-total';
    const state = await loadData(lang);
    Script.setWidget(build(state, param, t, layout));
    Script.complete();
    return;
  }

  /* Inside the Scriptable app: set up, then preview. */
  if (!API_URL || !APP_URL) {
    const alert = new Alert();
    alert.title = 'Quick Wallet';
    alert.message = t.missingConfig;
    alert.addAction('OK');
    await alert.presentAlert();
    return;
  }
  if (!getToken()) await askForToken(t);

  const menu = new Alert();
  menu.title = t.menu;
  menu.addAction(t.previewAll);
  menu.addAction(t.changeToken);
  menu.addAction(t.clearCache);
  menu.addCancelAction(t.cancel);
  const choice = await menu.presentSheet();

  if (choice === 1) {
    await askForToken(t);
    return;
  }
  if (choice === 2) {
    const fm = FileManager.local();
    if (fm.fileExists(cachePath())) fm.remove(cachePath());
    return;
  }
  if (choice !== 0) return;

  const state = await loadData(lang);
  const previews = [
    ['small-total', 'presentSmall'],
    ['small-wallets', 'presentSmall'],
    ['medium-grid', 'presentMedium'],
    ['medium-list', 'presentMedium'],
    ['large', 'presentLarge'],
    ['accessoryInline', 'presentAccessoryInline'],
    ['accessoryRectangular', 'presentAccessoryRectangular'],
    ['accessoryCircular', 'presentAccessoryCircular'],
  ];
  for (const [layout, present] of previews) {
    const widget = build(state, param, t, layout);
    if (typeof widget[present] === 'function') await widget[present]();
  }
  Script.complete();
}

await main();
