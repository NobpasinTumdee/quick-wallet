/**
 * The number pad's arithmetic: digits, one decimal point per number, and `+`
 * / `−` between numbers — enough to add up a receipt ("120+45"), nothing
 * more. Kept as the text that was keyed so it can be shown back exactly; the
 * form only ever receives the result, as the same plain string DecimalInput
 * has always produced ("165", "12.5"), so nothing downstream changes.
 *
 * Internally the minus is ASCII "-"; the pad shows it as "−".
 */

export type PadKey = '0' | '1' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '00' | '.' | '+' | '-' | 'back' | 'clear';

export type PadOptions = {
  /** Most digits after the point: 2 for money, more for share counts. */
  decimals: number;
  /** A leading − makes the number negative (an overdrawn opening balance). */
  allowNegative: boolean;
  /** The largest result accepted. */
  max: number;
};

export type PadError = 'negative' | 'tooLarge' | 'invalid';

export type PadResult = {
  /** The result, or null while there is nothing to evaluate. */
  value: number | null;
  error: PadError | null;
  /** The text holds a + or − between numbers, so a result line is worth showing. */
  isSum: boolean;
};

export const MONEY_MAX = 999_999_999.99;
const MAX_TERMS = 20;
const MAX_INT_DIGITS = 12;

/** The number being typed: everything after the last operator. */
function lastTerm(expr: string): string {
  const body = expr.startsWith('-') ? expr.slice(1) : expr;
  const parts = body.split(/[+-]/);
  return parts[parts.length - 1];
}

function endsWithOperator(expr: string): boolean {
  return /[+-]$/.test(expr);
}

/** One key applied to the text. Keys that would make it malformed are ignored. */
export function applyPadKey(expr: string, key: PadKey, options: PadOptions): string {
  if (key === 'clear') return '';
  if (key === 'back') return expr.slice(0, -1);

  const term = lastTerm(expr);

  if (key === '+' || key === '-') {
    if (!expr) return key === '-' && options.allowNegative ? '-' : '';
    if (expr === '-') return expr;
    const terms = (expr.startsWith('-') ? expr.slice(1) : expr).split(/[+-]/).length;
    let base = expr.endsWith('.') ? expr.slice(0, -1) : expr;
    if (endsWithOperator(base)) base = base.slice(0, -1);
    else if (terms >= MAX_TERMS) return expr;
    return base + key;
  }

  if (key === '.') {
    if (options.decimals <= 0 || term.includes('.')) return expr;
    return expr + (term === '' ? '0.' : '.');
  }

  /* Digits, and 00. */
  const [whole, fraction] = term.split('.');
  if (fraction !== undefined) {
    const room = options.decimals - fraction.length;
    if (room <= 0) return expr;
    return expr + key.slice(0, room);
  }
  if (term === '' && key === '00') return `${expr}0`;
  /* No leading zeros: "0" then "5" is "5". */
  if (whole === '0') return key === '00' ? expr : expr.slice(0, -1) + key;
  if (whole.length + key.length > MAX_INT_DIGITS) return expr;
  return expr + key;
}

/**
 * The result of the text. A trailing operator or point is ignored ("120+"
 * reads as 120) so the result line does not flicker while typing.
 */
export function evaluatePad(expr: string, options: PadOptions): PadResult {
  let text = expr;
  while (/[+\-.]$/.test(text) && text !== '-') text = text.slice(0, -1);
  if (text === '' || text === '-') return { value: null, error: null, isSum: false };

  const negativeStart = text.startsWith('-');
  const body = negativeStart ? text.slice(1) : text;
  const tokens = body.split(/([+-])/);
  const isSum = tokens.length > 1;

  let total = 0;
  let sign = negativeStart ? -1 : 1;
  for (const token of tokens) {
    if (token === '+') sign = 1;
    else if (token === '-') sign = -1;
    else {
      if (!/^\d+(\.\d*)?$/.test(token)) return { value: null, error: 'invalid', isSum };
      total += sign * Number(token);
    }
  }
  const factor = 10 ** Math.min(options.decimals, 10);
  const value = Math.round(total * factor) / factor;

  /* Below zero is only a value where the field takes negatives (an
     overdrawn opening balance); anywhere else it is a mistake to show. */
  if (value < 0 && !options.allowNegative) return { value, error: 'negative', isSum };
  if (Math.abs(value) > options.max) return { value, error: 'tooLarge', isSum };
  return { value, error: null, isSum };
}

/** The result as the plain string a form stores: no exponent, no trailing zeros. */
export function padValueToRaw(value: number, decimals: number): string {
  if (!Number.isFinite(value)) return '';
  const fixed = value.toFixed(Math.min(decimals, 10));
  return fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
}

/** What a form already holds, as text the pad can continue from. */
export function rawToPad(raw: string, options: PadOptions): string {
  const clean = String(raw ?? '').trim().replace(/,/g, '');
  if (!clean || !/^-?\d*(\.\d*)?$/.test(clean)) return '';
  const negative = clean.startsWith('-') && options.allowNegative;
  let digits = clean.replace(/^-/, '');
  const [whole, fraction] = digits.split('.');
  const trimmedWhole = whole.replace(/^0+(?=\d)/, '');
  digits = fraction !== undefined && options.decimals > 0 ? `${trimmedWhole || '0'}.${fraction.slice(0, options.decimals)}` : trimmedWhole;
  return (negative ? '-' : '') + digits;
}

/** Pasted text as pad text: "฿1,234.50" → "1234.5", "120 + 45" → "120+45". */
export function pastedToPad(text: string, options: PadOptions): string | null {
  const compact = text.replace(/[\s,]/g, '').replace(/[−–]/g, '-').replace(/[^\d.+-]/g, '');
  if (!compact || !/\d/.test(compact)) return null;
  let expr = '';
  for (const ch of compact) expr = applyPadKey(expr, ch as PadKey, options);
  return expr || null;
}

/**
 * The keyed text as it is shown: each number grouped by thousands for the
 * locale, the minus as a real minus sign, spaces round operators.
 */
export function formatPadText(expr: string, locale: string): string {
  const group = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const decimal = new Intl.NumberFormat(locale).formatToParts(1.5).find((p) => p.type === 'decimal')?.value ?? '.';
  const negativeStart = expr.startsWith('-');
  const body = negativeStart ? expr.slice(1) : expr;
  const out = body
    .split(/([+-])/)
    .map((token) => {
      if (token === '+') return ' + ';
      if (token === '-') return ' − ';
      if (!token) return '';
      const [whole, fraction] = token.split('.');
      const grouped = whole ? group.format(Number(whole)) : '0';
      return fraction !== undefined ? `${grouped}${decimal}${fraction}` : grouped;
    })
    .join('');
  return (negativeStart ? '−' : '') + out;
}
