import { FormEvent, useEffect, useRef, useState } from 'react';

import { formatMoney, formatNumber, todayKey } from '../lib/format';
import { Holding, projectAverageCost } from '../lib/positions';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Investment, InvestmentStatus, WalletBalance } from '../types';
import {
  Alert,
  Button,
  DecimalInput,
  Field,
  Input,
  Modal,
  Segmented,
  Select,
  Textarea,
  decimalToInput,
  parseDecimal,
} from './ui';

export interface InvestmentPayload {
  walletId: string;
  symbol: string;
  quantity: number;
  /** ALWAYS in the bookkeeping currency — the form converts before submitting. */
  buyPrice: number;
  fees: number;
  buyDate: string;
  tags: string;
  status: InvestmentStatus;
  sellPrice: number;
  sellDate: string;
  note: string;
}

/** Which currency the user is typing prices in. The payload is unaffected. */
type EntryMode = 'base' | 'quote';

/**
 * Numeric fields live in state as raw strings so a half-typed decimal
 * ("0.", "1.0000") survives re-renders. They're parsed once, on submit.
 */
interface FormState {
  walletId: string;
  symbol: string;
  quantity: string;
  buyPrice: string;
  fees: string;
  buyDate: string;
  tags: string;
  status: InvestmentStatus;
  sellPrice: string;
  sellDate: string;
  note: string;
  /** Not submitted — drives the conversion below. */
  entryMode: EntryMode;
  /** Optional: exact amount debited by the bank, in the bookkeeping currency. */
  totalOverride: string;
}

const SUGGESTED_TAGS = ['growth', 'dividend', 'core', 'speculative', 'long-term', 'etf'];

function initialState(
  wallets: WalletBalance[],
  investment?: Investment,
  addTo?: Holding | null,
): FormState {
  return {
    // Adding to a position pins both — a "new buy" of AAPL in the ISA is not a
    // new buy of AAPL in the taxable account, and letting either drift would
    // silently create a second holding instead of a second lot.
    walletId: investment?.walletId ?? addTo?.walletId ?? wallets[0]?.id ?? '',
    symbol: investment?.symbol ?? addTo?.symbol ?? '',
    quantity: decimalToInput(investment?.quantity),
    buyPrice: decimalToInput(investment?.buyPrice),
    fees: decimalToInput(investment?.fees),
    buyDate: investment?.buyDate || todayKey(),
    tags: investment?.tags ?? '',
    status: investment?.status ?? 'hold',
    sellPrice: decimalToInput(investment?.sellPrice),
    sellDate: investment?.sellDate ?? '',
    note: investment?.note ?? '',
    // Stored values are already in base currency, so editing starts there.
    entryMode: 'base',
    totalOverride: '',
  };
}

/**
 * Add / edit a stock position.
 *
 * The database is strictly single-currency: `buyPrice` is always in the
 * bookkeeping currency so wallet deductions and net worth stay consistent. But
 * brokerages quote US stocks in USD, and typing a USD figure into a THB field
 * is what produced the +3000% P&L. So this form is a converter: enter prices in
 * whichever currency you're reading them in, and it submits base currency.
 */
export function InvestmentForm({
  open,
  wallets,
  investment,
  addTo,
  quoteCurrency = 'USD',
  fxRate = 1,
  fxAvailable = false,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Investment-mode wallets only. */
  wallets: WalletBalance[];
  investment?: Investment;
  /**
   * The holding this purchase is being added to, when the user pressed "Buy
   * more" on an existing position rather than "New position".
   *
   * It does two things: pins the symbol and wallet so the lot lands in the
   * right holding, and turns on the blended-average preview — the number a
   * dollar-cost-averaging buy is actually judged against.
   */
  addTo?: Holding | null;
  /** Currency the broker quotes in, e.g. USD. */
  quoteCurrency?: string;
  /** Multiplier from `quoteCurrency` into the bookkeeping currency. */
  fxRate?: number;
  /** False when no live rate could be resolved — USD entry is then unsafe. */
  fxAvailable?: boolean;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: InvestmentPayload) => Promise<void>;
}) {
  const money = useMoneyFormatter();
  const { settings } = useSettings();
  const locale = settings.locale;
  const [form, setForm] = useState<FormState>(() => initialState(wallets, investment, addTo));
  const [localError, setLocalError] = useState<string | null>(null);

  /* Reset only when the sheet opens, or when it opens onto a different record.
     `wallets` and `investment` are rebuilt on every background revalidation, so
     depending on their identity would wipe a half-typed form under the user. */
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;

  const addToRef = useRef(addTo);
  addToRef.current = addTo;

  useEffect(() => {
    if (open) {
      setForm(initialState(walletsRef.current, investment, addToRef.current));
      setLocalError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, investment?.id, addTo?.key]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  /* Prices are stored in the wallet's currency, not the market's. */
  const selectedWallet = wallets.find((w) => w.id === form.walletId);
  const entryCurrency = (selectedWallet?.currency || money.base).toUpperCase();
  const mismatchedWallet = entryCurrency !== money.base.toUpperCase();

  const quote = quoteCurrency.toUpperCase();
  const canConvert = fxAvailable && fxRate > 0 && quote !== entryCurrency;
  const inQuote = form.entryMode === 'quote' && canConvert;

  const quantity = parseDecimal(form.quantity);
  const fees = parseDecimal(form.fees);
  const totalOverride = parseDecimal(form.totalOverride);
  const enteredBuy = parseDecimal(form.buyPrice);
  const enteredSell = parseDecimal(form.sellPrice);

  /* ---- The calculator -------------------------------------------------
     Three ways to arrive at the per-share price actually stored:
       1. exact total debited (wins — it already includes the broker's spread)
       2. a quote-currency price, converted at the current rate
       3. a base-currency price, used as-is                                */
  const usingOverride = totalOverride > 0 && quantity > 0;

  const buyPriceBase = usingOverride
    ? Math.max(0, (totalOverride - fees) / quantity)
    : inQuote
      ? enteredBuy * fxRate
      : enteredBuy;

  const sellPriceBase = inQuote ? enteredSell * fxRate : enteredSell;

  const costBasis = usingOverride ? totalOverride : buyPriceBase * quantity + fees;
  /** What the same figures look like back in the broker's currency. */
  const buyPriceInQuote = canConvert && fxRate > 0 ? buyPriceBase / fxRate : 0;

  /* When the user gave both a quote-currency price and the exact amount debited,
     the difference between them IS the broker's FX spread. Comparing the two
     yields the rate they were really charged, which is the useful number. */
  const quoteTotal = inQuote && enteredBuy > 0 ? enteredBuy * quantity : 0;
  const effectiveRate =
    usingOverride && quoteTotal > 0 ? (costBasis - fees) / quoteTotal : 0;
  const spreadPercent =
    effectiveRate > 0 && fxRate > 0 ? ((effectiveRate - fxRate) / fxRate) * 100 : 0;

  /* ---- Where this buy leaves the average ----
     Only meaningful when topping up an existing holding. A DCA purchase is
     judged against the blended average, not the price paid: buying under the
     average pulls it down, which is the entire point of averaging in. */
  const projected = projectAverageCost(addTo, quantity, buyPriceBase, usingOverride ? 0 : fees);
  const averageFalls = projected.delta < 0;

  /** Switching the unit converts what's already typed, like any unit toggle. */
  function switchEntryMode(next: EntryMode) {
    if (next === form.entryMode || !canConvert) return;
    const convert = (raw: string) => {
      const value = parseDecimal(raw);
      if (!value) return raw;
      const converted = next === 'quote' ? value / fxRate : value * fxRate;
      return String(Number(converted.toFixed(6)));
    };
    setForm((prev) => ({
      ...prev,
      entryMode: next,
      buyPrice: convert(prev.buyPrice),
      sellPrice: convert(prev.sellPrice),
    }));
  }

  function toggleTag(tag: string) {
    const tags = form.tags.split(',').map((t) => t.trim()).filter(Boolean);
    const next = tags.includes(tag) ? tags.filter((t) => t !== tag) : [...tags, tag];
    patch('tags', next.join(', '));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.walletId) {
      setLocalError('Create an investment-mode wallet first');
      return;
    }
    if (!form.symbol.trim()) {
      setLocalError('Enter a ticker symbol');
      return;
    }
    if (quantity <= 0) {
      setLocalError('Quantity must be greater than zero');
      return;
    }
    if (usingOverride && totalOverride <= fees) {
      setLocalError(`Total debited must be more than the ${formatMoney(fees, entryCurrency, locale)} in fees`);
      return;
    }
    if (!usingOverride && buyPriceBase <= 0) {
      setLocalError('Enter a buy price, or the exact total debited');
      return;
    }
    if (form.status === 'sold' && sellPriceBase <= 0) {
      setLocalError('A sold position needs a sell price');
      return;
    }
    setLocalError(null);

    try {
      // Everything leaving this form is in the bookkeeping currency.
      await onSubmit({
        walletId: form.walletId,
        symbol: form.symbol.trim().toUpperCase(),
        quantity,
        buyPrice: buyPriceBase,
        fees,
        buyDate: form.buyDate,
        tags: form.tags,
        status: form.status,
        sellPrice: sellPriceBase,
        sellDate: form.sellDate,
        note: form.note,
      });
    } catch {
      /* parent shows `error` */
    }
  }

  const activeTags = form.tags.split(',').map((t) => t.trim().toLowerCase());
  const priceUnit = inQuote ? quote : entryCurrency;

  return (
    <Modal
      open={open}
      title={
        investment
          ? `Edit ${investment.symbol}`
          : addTo
            ? `Buy more ${addTo.symbol}`
            : 'New position'
      }
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {investment ? 'Save' : addTo ? 'Add purchase' : 'Add position'}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <Field
          label="Investment wallet"
          className="span-2"
          hint={addTo ? 'Fixed: this purchase joins the position held in this wallet.' : undefined}
        >
          <Select
            value={form.walletId}
            onChange={(e) => patch('walletId', e.target.value)}
            disabled={Boolean(addTo)}
            required
          >
            {wallets.length === 0 && <option value="">No investment wallet yet</option>}
            {wallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.icon} {wallet.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Symbol"
          hint={
            addTo
              ? `Adding a ${addTo.lots.length === 1 ? '2nd' : `${addTo.lots.length + 1}th`} purchase to this position.`
              : 'Ticker as the stock API expects it, e.g. AAPL.'
          }
        >
          <Input
            value={form.symbol}
            onChange={(e) => patch('symbol', e.target.value.toUpperCase())}
            placeholder="AAPL"
            maxLength={20}
            /* Editable here would move the lot to a different holding, which is
               never what "buy more" means. */
            readOnly={Boolean(addTo)}
            required
            /* Focus the first field the user actually has to fill in. */
            autoFocus={!addTo}
          />
        </Field>

        <Field label="Quantity" hint="Fractional shares are fine.">
          <DecimalInput
            value={form.quantity}
            onChange={(raw) => patch('quantity', raw)}
            placeholder="0.00000000"
            required
            autoFocus={Boolean(addTo)}
          />
        </Field>

        {/* ---- Price, in whichever currency you're reading it ---- */}
        <Field
          label={`Buy price per share (${priceUnit})`}
          className="span-2"
          hint={
            inQuote
              ? `Type the price exactly as your broker shows it, in ${quote}.`
              : `Type the price already converted to ${entryCurrency}.`
          }
        >
          <div className="field-with-unit">
            <DecimalInput
              value={form.buyPrice}
              onChange={(raw) => patch('buyPrice', raw)}
              placeholder="0.00"
              disabled={usingOverride}
            />
            <Segmented<EntryMode>
              value={form.entryMode}
              ariaLabel="Price entry currency"
              onChange={switchEntryMode}
              options={[
                { value: 'quote', label: quote },
                { value: 'base', label: entryCurrency },
              ]}
            />
          </div>
        </Field>

        {!canConvert && quote !== entryCurrency && (
          <div className="span-2">
            <Alert tone="warning" title={`${quote} entry unavailable`}>
              No live {quote} → {entryCurrency} rate right now, so the form can't convert safely.
              Enter the price in {entryCurrency}, or use the exact total debited below.
            </Alert>
          </div>
        )}

        <Field label={`Fees (${entryCurrency})`} hint="Commission, included in the cost basis.">
          <DecimalInput value={form.fees} onChange={(raw) => patch('fees', raw)} placeholder="0.00" />
        </Field>

        <Field label="Buy date">
          <Input type="date" value={form.buyDate} onChange={(e) => patch('buyDate', e.target.value)} required />
        </Field>

        {/* ---- The escape hatch for broker FX spreads ---- */}
        <Field
          label={`Exact total debited (${entryCurrency})`}
          className="span-2"
          hint={
            usingOverride
              ? 'Overriding the price above — the per-share cost is derived from this.'
              : `Optional. Brokers add a hidden FX spread, so the amount your bank actually debited is usually a little more than price × quantity. Enter it and the ${entryCurrency} cost per share is worked out from it.`
          }
        >
          <DecimalInput
            value={form.totalOverride}
            onChange={(raw) => patch('totalOverride', raw)}
            placeholder="Leave blank to use the price above"
          />
        </Field>

        {/* A "buy more" is a purchase by definition — offering to record it as
            already sold would only be a way to file it in the wrong place. */}
        {!addTo && (
        <Field label="Status">
          <Segmented<InvestmentStatus>
            value={form.status}
            ariaLabel="Position status"
            onChange={(status) =>
              setForm((prev) => ({
                ...prev,
                status,
                sellDate: status === 'sold' && !prev.sellDate ? todayKey() : prev.sellDate,
              }))
            }
            options={[
              { value: 'hold', label: 'Holding' },
              { value: 'sold', label: 'Sold' },
            ]}
          />
        </Field>
        )}

        {form.status === 'sold' && (
          <Field
            label={`Sell price per share (${priceUnit})`}
            hint={inQuote ? `In ${quote}, converted on save.` : undefined}
          >
            <DecimalInput
              value={form.sellPrice}
              onChange={(raw) => patch('sellPrice', raw)}
              placeholder="0.00"
              required
            />
          </Field>
        )}

        {form.status === 'sold' && (
          <Field label="Sell date" className="span-2">
            <Input type="date" value={form.sellDate} onChange={(e) => patch('sellDate', e.target.value)} />
          </Field>
        )}

        <Field label="Tags" className="span-2" hint="Comma separated. Used for grouping and filters.">
          <Input value={form.tags} onChange={(e) => patch('tags', e.target.value)} placeholder="growth, core" />
        </Field>

        <div className="span-2 tag-row">
          {SUGGESTED_TAGS.map((tag) => (
            <button
              key={tag}
              type="button"
              className={`user-chip${activeTags.includes(tag) ? ' is-active' : ''}`}
              onClick={() => toggleTag(tag)}
            >
              {tag}
            </button>
          ))}
        </div>

        <Field label="Note" className="span-2">
          <Textarea value={form.note} onChange={(e) => patch('note', e.target.value)} maxLength={300} />
        </Field>

        {/* ---- Live preview of exactly what will be saved ---- */}
        <div className="span-2">
          <div className="calc-preview">
            <div className="calc-row">
              <span className="section-label">Saved as</span>
              <span className="calc-value">
                {formatMoney(buyPriceBase, entryCurrency, locale)}
                <span className="text-faint"> / share</span>
              </span>
            </div>

            <div className="calc-row calc-row--total">
              <span className="section-label">
                {usingOverride ? 'Debited from wallet' : 'Total deducted from wallet'}
              </span>
              <span className="calc-value calc-value--strong">
                ≈ {formatMoney(costBasis, entryCurrency, locale)}
              </span>
            </div>

            {/* The DCA readout. Shown only when there is an existing average to
                move, because "your new average is the price you just paid" is
                not information. */}
            {addTo && addTo.quantity > 0 && (
              <>
                <div className="calc-row calc-row--average">
                  <span className="section-label">Average cost after this buy</span>
                  <span className="calc-value">
                    <span className="calc-was">
                      {formatMoney(projected.previousAvgCost, entryCurrency, locale)}
                    </span>
                    <span className="calc-arrow" aria-hidden="true">
                      →
                    </span>
                    <strong className="calc-value--strong">
                      {formatMoney(projected.avgCost, entryCurrency, locale)}
                    </strong>
                  </span>
                </div>

                <p className="calc-note">
                  {formatNumber(addTo.quantity, 8, locale)} →{' '}
                  <strong>{formatNumber(projected.quantity, 8, locale)}</strong> shares
                  {projected.delta !== 0 && (
                    <>
                      {' · '}
                      <strong className={averageFalls ? 'text-positive' : 'text-negative'}>
                        {averageFalls ? '↓' : '↑'}{' '}
                        {formatMoney(Math.abs(projected.delta), entryCurrency, locale)} /share
                      </strong>{' '}
                      {averageFalls
                        ? '— you are buying below your average.'
                        : '— you are buying above your average.'}
                    </>
                  )}
                </p>
              </>
            )}

            <p className="calc-note">
              {quantity > 0 ? formatNumber(quantity, 8, locale) : '0'} ×{' '}
              {formatMoney(buyPriceBase, entryCurrency, locale)}
              {fees > 0 && ` + ${formatMoney(fees, entryCurrency, locale)} fees`}
              {canConvert && (
                <>
                  {' · '}
                  {formatMoney(buyPriceInQuote, quote, locale)} / share at {fxRate.toFixed(4)}
                </>
              )}
            </p>

            {/* Only meaningful when both a quote price and the real debit are
                known — then the gap between them is the broker's spread. */}
            {effectiveRate > 0 && (
              <p className="calc-note">
                You were charged an effective rate of <strong>{effectiveRate.toFixed(4)}</strong> vs
                today's market {fxRate.toFixed(4)}
                {Math.abs(spreadPercent) >= 0.01 && (
                  <>
                    {' '}
                    — a spread of{' '}
                    <strong className={spreadPercent > 0 ? 'text-negative' : 'text-positive'}>
                      {spreadPercent > 0 ? '+' : ''}
                      {spreadPercent.toFixed(2)}%
                    </strong>
                  </>
                )}
                .
              </p>
            )}
          </div>
        </div>

        {mismatchedWallet && (
          <div className="span-2">
            <Alert tone="warning" title={`This wallet is in ${entryCurrency}`}>
              Your books are in {money.base.toUpperCase()}. Amounts here are stored as {entryCurrency}{' '}
              but totalled as {money.base.toUpperCase()} elsewhere — they are not converted between
              wallets.
            </Alert>
          </div>
        )}

        {(localError || error) && (
          <div className="span-2">
            <Alert tone="error">{localError || error}</Alert>
          </div>
        )}

        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}
