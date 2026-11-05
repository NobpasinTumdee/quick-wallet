/**
 * Everything the Widgets & shortcuts screen fills in for the user: the widget
 * read URL, quick-entry links, the Scriptable widget parameter, KWGT formulas
 * and the shortcut request body.
 *
 * Pure and free of imports so the Node tests load it directly. Two pieces are
 * copied into the Scriptable script, which cannot import anything:
 * `parseWidgetParameter` and `SHORTCUT_NAMES`. They sit between
 * `// <shared:…>` markers there, and frontend/tests/widgetSetup.test.mjs fails
 * if the copies ever behave differently.
 */

export type WidgetAction = 'expense' | 'income' | 'transfer';

/** What the Apple Shortcuts in the guide are called. `buttons=shortcut` runs these. */
export const SHORTCUT_NAMES: Record<WidgetAction, string> = {
  expense: 'Quick Wallet: รายจ่าย',
  income: 'Quick Wallet: รายรับ',
  transfer: 'Quick Wallet: โอน',
};

export const WIDGET_LAYOUTS = [
  'small-total',
  'small-wallets',
  'medium-grid',
  'medium-list',
  'large',
] as const;
export type WidgetLayout = (typeof WIDGET_LAYOUTS)[number];

export interface WidgetParameter {
  layout?: WidgetLayout;
  /** Wallet ids or names, in the order to show them. */
  wallets?: string[];
  hide?: boolean;
  lang?: 'th' | 'en';
  /** `app` opens the form (default); `shortcut` runs the Apple Shortcut. */
  buttons?: 'app' | 'shortcut';
}

/**
 * Reads `layout=medium-grid; wallets=id1,id2; hide=1; lang=th; buttons=shortcut`.
 * Separators `;` or `&`, keys case-insensitive, unknown keys and bad values
 * ignored — a typo in a widget parameter must never blank the widget.
 */
export function parseWidgetParameter(text: string | null | undefined): WidgetParameter {
  const out: WidgetParameter = {};
  String(text ?? '')
    .split(/[;&\n]/)
    .forEach((part) => {
      const eq = part.indexOf('=');
      if (eq < 0) return;
      const key = part.slice(0, eq).trim().toLowerCase();
      const value = part.slice(eq + 1).trim();
      if (key === 'layout') {
        const layout = value.toLowerCase();
        if ((WIDGET_LAYOUTS as readonly string[]).includes(layout)) out.layout = layout as WidgetLayout;
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

/** The inverse, for the setup screen's "copy parameter" boxes. */
export function buildWidgetParameter(param: WidgetParameter): string {
  const parts: string[] = [];
  if (param.layout) parts.push(`layout=${param.layout}`);
  if (param.wallets?.length) parts.push(`wallets=${param.wallets.join(',')}`);
  if (param.hide) parts.push('hide=1');
  if (param.lang) parts.push(`lang=${param.lang}`);
  if (param.buttons === 'shortcut') parts.push('buttons=shortcut');
  return parts.join('; ');
}

/** The app's own address without query or hash: what deep links start from. */
export function appBaseUrl(href: string): string {
  const url = new URL(href);
  return `${url.origin}${url.pathname}`;
}

/** The GET read URL. KWGT needs it, because `$wg$` can only send GET requests. */
export function widgetReadUrl(apiUrl: string, secret: string, lang?: 'th' | 'en'): string {
  const params = new URLSearchParams({ action: 'widget', token: secret });
  if (lang) params.set('lang', lang);
  return `${apiUrl}?${params.toString()}`;
}

/** Opens the app's quick-entry form, prefilled. */
export function quickLinkUrl(appUrl: string, type: WidgetAction, walletId?: string, toWalletId?: string): string {
  const params = new URLSearchParams({ quick: type });
  if (walletId) params.set('wallet', walletId);
  if (type === 'transfer' && toWalletId) params.set('to', toWalletId);
  return `${appUrl}?${params.toString()}`;
}

/** Runs an Apple Shortcut by name. */
export function shortcutRunUrl(name: string): string {
  return `shortcuts://run-shortcut?name=${encodeURIComponent(name)}`;
}

export interface KwgtFormula {
  id: string;
  formula: string;
}

/**
 * KWGT text formulas. They read the global variable `url`, which holds the
 * read URL, so the token is typed once. Wallet slots 1–8 always exist in the
 * reply (empty when unused).
 */
export function kwgtFormulas(slots = 4): KwgtFormula[] {
  const wg = (path: string) => `$wg(gv(url), json, .flat.${path})$`;
  const list: KwgtFormula[] = [
    { id: 'total', formula: wg('total') },
    { id: 'totalShort', formula: wg('totalShort') },
    { id: 'totalNote', formula: wg('totalNote') },
    { id: 'updated', formula: wg('updated') },
  ];
  for (let i = 1; i <= slots; i += 1) {
    list.push({ id: `w${i}name`, formula: wg(`w${i}name`) });
    list.push({ id: `w${i}text`, formula: wg(`w${i}text`) });
    list.push({
      id: `w${i}color`,
      formula: `$if(wg(gv(url), json, .flat.w${i}neg) = 1, #FFE5484D, #FFFFFFFF)$`,
    });
  }
  return list;
}

/**
 * The JSON body a shortcut sends to `widget.add`. `placeholders` are the
 * shortcut's own variables, written in whatever syntax that app uses.
 */
export function shortcutBody(
  secret: string,
  type: WidgetAction,
  placeholders: { amount: string; walletId: string; toWalletId?: string; note?: string; clientId: string },
): string {
  const body: Record<string, string> = {
    action: 'widget.add',
    token: secret,
    type,
    amount: placeholders.amount,
    walletId: placeholders.walletId,
  };
  if (type === 'transfer' && placeholders.toWalletId) body.toWalletId = placeholders.toWalletId;
  if (placeholders.note) body.note = placeholders.note;
  body.clientId = placeholders.clientId;
  return JSON.stringify(body, null, 2);
}

/** A value written into the script as a single-quoted JavaScript string. */
function jsString(value: string): string {
  const escaped = value.replace(/\\/g, '\\\\').replace(/'/g, "\\'").replace(/\r?\n/g, '');
  return `'${escaped}'`;
}

/**
 * The Scriptable script with API_URL and APP_URL filled in. The token is
 * never written into the file: the script asks for it once and keeps it in
 * the iOS Keychain.
 */
export function fillScriptConfig(source: string, apiUrl: string, appUrl: string): string {
  return source
    .replace(/^const API_URL = '[^'\n]*';/m, () => `const API_URL = ${jsString(apiUrl)};`)
    .replace(/^const APP_URL = '[^'\n]*';/m, () => `const APP_URL = ${jsString(appUrl)};`);
}
