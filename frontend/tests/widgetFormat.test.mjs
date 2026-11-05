/*
 * The widget's figures are formatted in Code.gs (widgetFormatMoney_,
 * widgetCompactAmount_), the app's in src/lib/format.ts (formatMoney,
 * formatCompactAmount). They must agree, or the widget and Home would show
 * the same balance two different ways. This runs both on the same table and
 * fails on any difference, listing every one.
 *
 * Run: npm test   (node --test tests/)
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';

import { formatCompactAmount, formatMoney } from '../src/lib/format.ts';

const here = dirname(fileURLToPath(import.meta.url));
/* QW_CODE_GS points the test at another copy, e.g. to prove it catches a drift. */
const gsPath = process.env.QW_CODE_GS || resolve(here, '../../google-apps-script/Code.gs');

function loadGs() {
  const context = vm.createContext({ console });
  vm.runInContext(readFileSync(gsPath, 'utf8'), context, { filename: 'Code.gs' });
  assert.equal(typeof context.widgetFormatMoney_, 'function', 'Code.gs has no widgetFormatMoney_');
  assert.equal(typeof context.widgetCompactAmount_, 'function', 'Code.gs has no widgetCompactAmount_');
  return context;
}

const VALUES = [
  0, 0.004, 0.005, 0.4, 0.5, 1, 9.99, 12.5, 99.995, 499.5, 950, 999, 999.4, 999.5, 1000, 1049,
  1050, 1234.567, 9949, 9950, 9999, 10000, 10499, 10500, 12345.67, 48250, 99999, 125000,
  999499, 999500, 999999, 1000000, 1500000, 9949999, 9950000, 123456789, 999999999,
  1000000000, 1500000000, 12345678901, Number.NaN, Number.POSITIVE_INFINITY,
];
const SIGNED = VALUES.flatMap((v) => (Number.isFinite(v) && v !== 0 ? [v, -v] : [v]));
const LOCALES = ['en-US', 'th-TH', 'de-DE', 'ja-JP'];
const CURRENCIES = ['THB', 'USD', 'EUR', 'JPY', 'NOT_A_CODE'];
const MONEY_OPTIONS = [{}, { compact: true }, { signed: true }, { compact: true, signed: true }];

function report(mismatches) {
  if (!mismatches.length) return;
  const shown = mismatches.slice(0, 40).map((m) => `  ${m}`).join('\n');
  assert.fail(
    `Code.gs and src/lib/format.ts format ${mismatches.length} value(s) differently.\n` +
      `The widget would show different figures from the app. Change both together.\n${shown}`,
  );
}

test('compact amounts: Code.gs matches formatCompactAmount', () => {
  const gs = loadGs();
  const mismatches = [];
  for (const locale of LOCALES) {
    for (const value of SIGNED) {
      const app = formatCompactAmount(value, locale);
      const widget = gs.widgetCompactAmount_(value, locale);
      if (app !== widget) mismatches.push(`${locale} ${value}: app "${app}" vs widget "${widget}"`);
    }
  }
  report(mismatches);
});

test('money: Code.gs matches formatMoney', () => {
  const gs = loadGs();
  const mismatches = [];
  for (const locale of LOCALES) {
    for (const currency of CURRENCIES) {
      for (const options of MONEY_OPTIONS) {
        for (const value of SIGNED) {
          const app = formatMoney(value, currency, locale, options);
          const widget = gs.widgetFormatMoney_(value, currency, locale, options);
          if (app !== widget) {
            mismatches.push(`${locale} ${currency} ${JSON.stringify(options)} ${value}: "${app}" vs "${widget}"`);
          }
        }
      }
    }
  }
  report(mismatches);
});

test('spot checks the widget relies on', () => {
  const gs = loadGs();
  assert.equal(gs.widgetCompactAmount_(48250, 'en-US'), '48k');
  assert.equal(gs.widgetCompactAmount_(-3400, 'th-TH'), '-3.4k');
  assert.equal(gs.widgetCompactAmount_(999999, 'en-US'), '1M');
  assert.equal(gs.widgetFormatMoney_(32000, 'THB', 'th-TH'), formatMoney(32000, 'THB', 'th-TH'));
});
