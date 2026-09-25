import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SubscriptionSplitEditor } from './SubscriptionSplitEditor';
import { advanceDueDate, todayKey } from '../hooks/useSubscriptions';
import { SplitDraft, summariseSplits, toPayload } from '../lib/splitMath';
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
  /** Paying this should also raise a shared bill from `splitDetails`. */
  isShared: boolean;
  /** The template. Always sent, so turning sharing off clears it server-side. */
  splitDetails: { personName: string; amount: number }[];
}

/** `amount` stays a raw string while typing; see DecimalInput. */
type FormState = Omit<SubscriptionPayload, 'amount' | 'splitDetails'> & { amount: string };

/** The stored template as form rows, with the ids the editor keys on. */
function toDrafts(subscription?: Subscription): SplitDraft[] {
  return (subscription?.splitDetails ?? []).map((share, index) => ({
    id: `s-${index}-${share.personName}`,
    personName: share.personName,
    amount: share.amount > 0 ? String(share.amount) : '',
  }));
}

function initialState(subscription?: Subscription, firstWalletId = ''): FormState {
  return {
    name: subscription?.name ?? '',
    amount: decimalToInput(subscription?.amount),
    walletId: subscription?.walletId ?? firstWalletId,
    category: subscription?.category ?? '',
    frequency: subscription?.frequency ?? 'monthly',
    nextDueDate: subscription?.nextDueDate ?? todayKey(),
    note: subscription?.note ?? '',
    isShared: subscription?.isShared ?? false,
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
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const [form, setForm] = useState<FormState>(() => initialState(subscription, wallets[0]?.id));
  const [people, setPeople] = useState<SplitDraft[]>(() => toDrafts(subscription));
  const [touched, setTouched] = useState(false);

  /* Deps are `open` and the record id only. `wallets` is filtered fresh on
     every render of the page, so depending on the array itself would reset the
     form mid-typing on any background revalidation. */
  useEffect(() => {
    if (!open) return;
    setForm(initialState(subscription, wallets[0]?.id));
    setPeople(toDrafts(subscription));
    setTouched(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, subscription?.id]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((previous) => ({ ...previous, [key]: value }));

  const amount = parseDecimal(form.amount);
  const nameError = touched && !form.name.trim() ? 'Give it a name' : undefined;
  const walletError = touched && !form.walletId ? 'Pick a wallet' : undefined;
  const amountError = touched && !(amount > 0) ? 'Enter an amount above zero' : undefined;
  /* The split can be wrong in one way that matters: shares adding up to more
     than the subscription. Everything else — a blank row, a name with no
     amount — is simply dropped by `toPayload`, the same as on the bill form. */
  const splitSummary = summariseSplits(people, amount);
  const splitBlocked = form.isShared && splitSummary.exceedsTotal;
  const valid = Boolean(
    form.name.trim() && form.walletId && amount > 0 && form.nextDueDate && !splitBlocked,
  );

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
      isShared: form.isShared,
      /* Sent even when sharing is off, and empty in that case: the server
         stores what it is given, so leaving a stale template behind would
         have it spring back the next time the toggle is flipped on. */
      splitDetails: form.isShared ? toPayload(people) : [],
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

        {/* ---- Shared subscription ----
            A switch rather than a checkbox: it turns a whole section on, and
            the section below is its consequence. */}
        <div className="span-2 sub-share">
          <label className="sub-share-toggle">
            <input
              type="checkbox"
              role="switch"
              checked={form.isShared}
              aria-describedby="sub-share-hint"
              onChange={(e) => set('isShared', e.target.checked)}
            />
            <span className="sub-share-track" aria-hidden="true" />
            <span className="sub-share-label">
              <strong>{t('recurring.shareToggle')}</strong>
              <small id="sub-share-hint">{t('recurring.shareHint')}</small>
            </span>
          </label>

          {form.isShared && (
            <SubscriptionSplitEditor people={people} onChange={setPeople} total={amount} />
          )}
        </div>

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
