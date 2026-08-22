import { FormEvent, useEffect, useState } from 'react';

import { advanceDueDate, todayKey } from '../hooks/useSubscriptions';
import { formatDate } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Subscription, SubscriptionFrequency, WalletBalance } from '../types';
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

export interface SubscriptionPayload {
  name: string;
  amount: number;
  walletId: string;
  category: string;
  frequency: SubscriptionFrequency;
  nextDueDate: string;
  note: string;
}

/** `amount` stays a raw string while typing; see DecimalInput. */
type FormState = Omit<SubscriptionPayload, 'amount'> & { amount: string };

function initialState(subscription?: Subscription, firstWalletId = ''): FormState {
  return {
    name: subscription?.name ?? '',
    amount: decimalToInput(subscription?.amount),
    walletId: subscription?.walletId ?? firstWalletId,
    category: subscription?.category ?? '',
    frequency: subscription?.frequency ?? 'monthly',
    nextDueDate: subscription?.nextDueDate ?? todayKey(),
    note: subscription?.note ?? '',
  };
}

export function SubscriptionForm({
  open,
  subscription,
  wallets,
  categories,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  subscription?: Subscription;
  wallets: WalletBalance[];
  categories: string[];
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: SubscriptionPayload) => void;
}) {
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const [form, setForm] = useState<FormState>(() => initialState(subscription, wallets[0]?.id));
  const [touched, setTouched] = useState(false);

  /* Deps are `open` and the record id only. `wallets` is filtered fresh on
     every render of the page, so depending on the array itself would reset the
     form mid-typing on any background revalidation. */
  useEffect(() => {
    if (!open) return;
    setForm(initialState(subscription, wallets[0]?.id));
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subscription?.id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const amount = parseDecimal(form.amount);
  const nameError = touched && !form.name.trim() ? 'Give it a name' : undefined;
  const walletError = touched && !form.walletId ? 'Pick a wallet' : undefined;
  const amountError = touched && !(amount > 0) ? 'Enter an amount above zero' : undefined;
  const valid = Boolean(form.name.trim() && form.walletId && amount > 0 && form.nextDueDate);

  function submit(event: FormEvent) {
    event.preventDefault();
    setTouched(true);
    if (!valid) return;
    onSubmit({
      name: form.name.trim(),
      amount,
      walletId: form.walletId,
      category: form.category.trim(),
      frequency: form.frequency,
      nextDueDate: form.nextDueDate,
      note: form.note.trim(),
    });
  }

  const wallet = wallets.find((w) => w.id === form.walletId);
  const following = form.nextDueDate ? advanceDueDate(form.nextDueDate, form.frequency) : '';

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={subscription ? 'Edit subscription' : 'New subscription'}
    >
      <form className="form-grid" onSubmit={submit}>
        <Field label="Name" error={nameError} className="span-2">
          <Input
            value={form.name}
            onChange={(e) => set('name', e.target.value)}
            placeholder="Netflix, rent, insurance…"
            autoFocus
          />
        </Field>

        <Field label={`Amount (${money.base})`} error={amountError}>
          <DecimalInput value={form.amount} onChange={(raw) => set('amount', raw)} placeholder="0.00" />
        </Field>

        <Field label="Frequency">
          <Segmented<SubscriptionFrequency>
            value={form.frequency}
            ariaLabel="Frequency"
            onChange={(value) => set('frequency', value)}
            options={[
              { value: 'weekly', label: 'Weekly' },
              { value: 'monthly', label: 'Monthly' },
              { value: 'yearly', label: 'Yearly' },
            ]}
          />
        </Field>

        <Field label="Deduct from" error={walletError} hint={wallet ? `Balance ${money(wallet.balance)}` : undefined}>
          <Select value={form.walletId} onChange={(e) => set('walletId', e.target.value)}>
            <option value="">Select a wallet…</option>
            {wallets.map((w) => (
              <option key={w.id} value={w.id}>
                {w.icon} {w.name}
              </option>
            ))}
          </Select>
        </Field>

        <Field label="Category" hint="Used on the expense, so budgets pick it up">
          <Input
            value={form.category}
            onChange={(e) => set('category', e.target.value)}
            list="subscription-categories"
            placeholder="Entertainment"
          />
          <datalist id="subscription-categories">
            {categories.map((category) => (
              <option key={category} value={category} />
            ))}
          </datalist>
        </Field>

        <Field
          label="Next due date"
          className="span-2"
          hint={
            following
              ? `After you confirm that payment, the next one falls on ${formatDate(following, settings.locale)}.`
              : undefined
          }
        >
          <Input
            type="date"
            value={form.nextDueDate}
            onChange={(e) => set('nextDueDate', e.target.value)}
          />
        </Field>

        <Field label="Note" className="span-2">
          <Textarea
            value={form.note}
            onChange={(e) => set('note', e.target.value)}
            rows={2}
            placeholder="Optional"
          />
        </Field>

        {error && (
          <div className="span-2">
            <Alert tone="error">{error}</Alert>
          </div>
        )}

        <div className="span-2 form-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="primary" disabled={touched && !valid}>
            {subscription ? 'Save changes' : 'Add subscription'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
