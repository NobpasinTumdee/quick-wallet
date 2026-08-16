import { FormEvent, useEffect, useRef, useState } from 'react';

import { todayKey } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Transaction, TransactionType, WalletBalance } from '../types';
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

export interface TransactionPayload {
  walletId: string;
  toWalletId: string;
  type: TransactionType;
  amount: number;
  category: string;
  note: string;
  date: string;
}

/** `amount` stays a raw string while typing; see DecimalInput. */
type FormState = Omit<TransactionPayload, 'amount'> & { amount: string };

function initialState(wallets: WalletBalance[], transaction?: Transaction): FormState {
  const firstSpendable = wallets.find((w) => w.mode === 'expense' && !w.archived);
  return {
    walletId: transaction?.walletId ?? firstSpendable?.id ?? wallets[0]?.id ?? '',
    toWalletId: transaction?.toWalletId ?? '',
    type: transaction?.type ?? 'expense',
    amount: decimalToInput(transaction?.amount),
    category: transaction?.category ?? '',
    note: transaction?.note ?? '',
    date: transaction?.date || todayKey(),
  };
}

/** Record an expense, income, or a transfer between two wallets. */
export function TransactionForm({
  open,
  wallets,
  transaction,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  wallets: WalletBalance[];
  transaction?: Transaction;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: TransactionPayload) => Promise<void>;
}) {
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const [form, setForm] = useState<FormState>(() => initialState(wallets, transaction));
  const [localError, setLocalError] = useState<string | null>(null);

  /* Only on open / a different record — see the note in InvestmentForm. */
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;

  useEffect(() => {
    if (open) {
      setForm(initialState(walletsRef.current, transaction));
      setLocalError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction?.id]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const amount = parseDecimal(form.amount);

  // Only expense-mode wallets can hold income/expense rows; transfers can touch any.
  const sourceOptions = form.type === 'transfer' ? wallets : wallets.filter((w) => w.mode === 'expense');
  const targetOptions = wallets.filter((w) => w.id !== form.walletId);

  function setType(type: TransactionType) {
    setForm((prev) => {
      const stillValid =
        type === 'transfer' || wallets.find((w) => w.id === prev.walletId)?.mode === 'expense';
      return {
        ...prev,
        type,
        walletId: stillValid ? prev.walletId : (sourceOptions[0]?.id ?? prev.walletId),
        toWalletId: type === 'transfer' ? prev.toWalletId : '',
        category: type === 'transfer' ? '' : prev.category,
      };
    });
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!form.walletId) {
      setLocalError('Pick a wallet');
      return;
    }
    if (amount <= 0) {
      setLocalError('Amount must be greater than zero');
      return;
    }
    if (form.type === 'transfer' && !form.toWalletId) {
      setLocalError('Pick a destination wallet');
      return;
    }
    if (form.type !== 'transfer' && !form.category) {
      setLocalError('Pick a category');
      return;
    }
    setLocalError(null);
    try {
      await onSubmit({ ...form, amount });
    } catch {
      /* parent shows `error` */
    }
  }

  return (
    <Modal
      open={open}
      title={transaction ? 'Edit transaction' : 'New transaction'}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {transaction ? 'Save' : 'Add'}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        <div className="span-2">
          <Segmented<TransactionType>
            value={form.type}
            ariaLabel="Transaction type"
            onChange={setType}
            options={[
              { value: 'expense', label: '↓ Expense' },
              { value: 'income', label: '↑ Income' },
              { value: 'transfer', label: '⇄ Transfer' },
            ]}
          />
        </div>

        <Field label={form.type === 'transfer' ? 'From wallet' : 'Wallet'}>
          <Select value={form.walletId} onChange={(e) => patch('walletId', e.target.value)} required>
            {sourceOptions.length === 0 && <option value="">No eligible wallet</option>}
            {sourceOptions.map((wallet) => (
              <option key={wallet.id} value={wallet.id}>
                {wallet.icon} {wallet.name}
              </option>
            ))}
          </Select>
        </Field>

        {form.type === 'transfer' ? (
          <Field label="To wallet">
            <Select value={form.toWalletId} onChange={(e) => patch('toWalletId', e.target.value)} required>
              <option value="">Select…</option>
              {targetOptions.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {wallet.icon} {wallet.name}
                  {wallet.mode === 'investment' ? ' (investment)' : ''}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <Field label="Category">
            <Select value={form.category} onChange={(e) => patch('category', e.target.value)} required>
              <option value="">Select…</option>
              {settings.categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          label={`Amount (${money.base})`}
          hint={money.converting && amount > 0 ? `≈ ${money(amount)}` : undefined}
        >
          <DecimalInput
            value={form.amount}
            onChange={(raw) => patch('amount', raw)}
            placeholder="0.00"
            required
            autoFocus
          />
        </Field>

        <Field label="Date">
          <Input type="date" value={form.date} onChange={(e) => patch('date', e.target.value)} required />
        </Field>

        <Field label="Note" className="span-2">
          <Textarea
            value={form.note}
            onChange={(e) => patch('note', e.target.value)}
            maxLength={300}
            placeholder="Optional"
          />
        </Field>

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
