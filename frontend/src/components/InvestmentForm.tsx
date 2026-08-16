import { FormEvent, useEffect, useState } from 'react';

import { todayKey } from '../lib/format';
import { useMoneyFormatter } from '../state/SettingsContext';
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
  buyPrice: number;
  fees: number;
  buyDate: string;
  tags: string;
  status: InvestmentStatus;
  sellPrice: number;
  sellDate: string;
  note: string;
}

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
}

const SUGGESTED_TAGS = ['growth', 'dividend', 'core', 'speculative', 'long-term', 'etf'];

function initialState(wallets: WalletBalance[], investment?: Investment): FormState {
  return {
    walletId: investment?.walletId ?? wallets[0]?.id ?? '',
    symbol: investment?.symbol ?? '',
    quantity: decimalToInput(investment?.quantity),
    buyPrice: decimalToInput(investment?.buyPrice),
    fees: decimalToInput(investment?.fees),
    buyDate: investment?.buyDate || todayKey(),
    tags: investment?.tags ?? '',
    status: investment?.status ?? 'hold',
    sellPrice: decimalToInput(investment?.sellPrice),
    sellDate: investment?.sellDate ?? '',
    note: investment?.note ?? '',
  };
}

/** Add or edit a stock position. Cost basis is stored; live P&L is derived from
 *  the stock API on the Investments screen. */
export function InvestmentForm({
  open,
  wallets,
  investment,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  /** Investment-mode wallets only. */
  wallets: WalletBalance[];
  investment?: Investment;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: InvestmentPayload) => Promise<void>;
}) {
  const money = useMoneyFormatter();
  const [form, setForm] = useState<FormState>(() => initialState(wallets, investment));
  const [localError, setLocalError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      setForm(initialState(wallets, investment));
      setLocalError(null);
    }
  }, [open, investment, wallets]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const quantity = parseDecimal(form.quantity);
  const buyPrice = parseDecimal(form.buyPrice);
  const fees = parseDecimal(form.fees);
  const sellPrice = parseDecimal(form.sellPrice);
  const costBasis = quantity * buyPrice + fees;

  function toggleTag(tag: string) {
    const tags = form.tags
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean);
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
    if (form.status === 'sold' && sellPrice <= 0) {
      setLocalError('A sold position needs a sell price');
      return;
    }
    setLocalError(null);
    try {
      await onSubmit({
        ...form,
        symbol: form.symbol.trim().toUpperCase(),
        quantity,
        buyPrice,
        fees,
        sellPrice,
      });
    } catch {
      /* parent shows `error` */
    }
  }

  const activeTags = form.tags.split(',').map((t) => t.trim().toLowerCase());

  return (
    <Modal
      open={open}
      title={investment ? `Edit ${investment.symbol}` : 'New position'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {investment ? 'Save' : 'Add position'}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <Field label="Investment wallet" className="span-2">
          <Select value={form.walletId} onChange={(e) => patch('walletId', e.target.value)} required>
            {wallets.length === 0 && <option value="">No investment wallet yet</option>}
            {wallets.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.icon} {wallet.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Symbol" hint="Ticker as the stock API expects it, e.g. AAPL.">
          <Input
            value={form.symbol}
            onChange={(e) => patch('symbol', e.target.value.toUpperCase())}
            placeholder="AAPL"
            maxLength={20}
            required
            autoFocus
          />
        </Field>

        <Field label="Quantity" hint="Fractional shares are fine — enter as many decimals as you need.">
          <DecimalInput
            value={form.quantity}
            onChange={(raw) => patch('quantity', raw)}
            placeholder="0.00000000"
            required
          />
        </Field>

        <Field
          label={`Buy price (${money.base})`}
          hint="Any number of decimal places."
        >
          <DecimalInput
            value={form.buyPrice}
            onChange={(raw) => patch('buyPrice', raw)}
            placeholder="0.00"
            required
          />
        </Field>

        <Field label="Fees" hint="Commission, included in the cost basis.">
          <DecimalInput value={form.fees} onChange={(raw) => patch('fees', raw)} placeholder="0.00" />
        </Field>

        <Field label="Buy date">
          <Input type="date" value={form.buyDate} onChange={(e) => patch('buyDate', e.target.value)} required />
        </Field>

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

        {form.status === 'sold' && (
          <>
            <Field label={`Sell price (${money.base})`}>
              <DecimalInput
                value={form.sellPrice}
                onChange={(raw) => patch('sellPrice', raw)}
                placeholder="0.00"
                required
              />
            </Field>
            <Field label="Sell date">
              <Input type="date" value={form.sellDate} onChange={(e) => patch('sellDate', e.target.value)} />
            </Field>
          </>
        )}

        <Field label="Tags" className="span-2" hint="Comma separated. Used for grouping and filters.">
          <Input
            value={form.tags}
            onChange={(e) => patch('tags', e.target.value)}
            placeholder="growth, core"
          />
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

        <div className="span-2">
          <Alert tone="info" title="Cost basis">
            {form.quantity || 0} × {money.formatBase(buyPrice)}
            {fees > 0 && ` + ${money.formatBase(fees)} fees`} ={' '}
            <strong>{money.formatBase(costBasis)}</strong>
            {money.converting && <> · {money(costBasis)} at your saved rate</>}
          </Alert>
        </div>

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
