import { formatMoney } from './format';
import type { MoneyFormatter } from '../state/SettingsContext';

/**
 * The same amounts, read in the broker's currency.
 *
 * ---------------------------------------------------------------------------
 * WHAT `base` MEANS, AND WHY IT DOES NOT CHANGE
 * ---------------------------------------------------------------------------
 * A `MoneyFormatter` is a function with members, and two of those members
 * answer different questions:
 *
 *   `display`  what the reader is looking at
 *   `base`     what the workbook stores
 *
 * Only the first one changes here. The second is read by the sell form to
 * label the field someone types a price into — a field that always writes
 * base-currency numbers. Re-pointing `base` at the broker's currency made that
 * form say "price per share (USD)" while still saving the number as THB, which
 * is how a cost basis ends up wrong by a factor of 34 with nothing in the
 * ledger to explain it. It also turned the rate caption into "USD/USD".
 *
 * So this converts what is shown and nothing else.
 */
export function quoteFormatter(
  baseMoney: MoneyFormatter,
  /** Base-currency units per one unit of the quote currency, e.g. 33.61. */
  rate: number,
  quoteCurrency: string,
  locale: string,
): MoneyFormatter {
  /* A zero or negative rate would divide every figure into nonsense or
     Infinity. The caller is expected to check, and this refuses anyway rather
     than put `$Infinity` on a portfolio screen. */
  if (!(rate > 0)) return baseMoney;

  const converted = ((value, options) =>
    formatMoney(value / rate, quoteCurrency, locale, options)) as MoneyFormatter;

  converted.convert = (value: number) => value / rate;
  converted.display = quoteCurrency;
  /* Deliberately the books' currency — see the note above. */
  converted.base = baseMoney.base;
  converted.rate = 1 / rate;
  converted.converting = true;
  /* Also deliberately the original: "format this in the base currency" must
     keep meaning that whichever currency is on screen. */
  converted.formatBase = baseMoney.formatBase;

  return converted;
}
