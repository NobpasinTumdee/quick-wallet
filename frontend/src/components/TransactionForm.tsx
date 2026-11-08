import { useTranslation } from 'react-i18next';

import { FormEvent, useEffect, useRef, useState } from 'react';

import { todayKey } from '../lib/format';
import { checkOverdraft } from '../lib/overdraft';
import { getRecentAmounts, recentKey, rememberAmount } from '../lib/numberPad';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { Transaction, TransactionType, WalletBalance } from '../types';
import { OverdraftWarningModal } from './OverdraftWarningModal';
import { ReceiptScanner } from './ReceiptScanner';
import { ReceiptScan } from '../hooks/useReceiptScanner';
import { WalletPicker } from './WalletPicker';
import { useOptionalFavourites } from '../state/FavouritesContext';
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

function initialState(
  wallets: WalletBalance[],
  transaction?: Transaction,
  prefill?: Partial<TransactionPayload>,
): FormState {
  const firstSpendable = wallets.find((w) => w.mode === 'expense' && !w.archived);
  return {
    walletId: transaction?.walletId ?? prefill?.walletId ?? firstSpendable?.id ?? wallets[0]?.id ?? '',
    toWalletId: transaction?.toWalletId ?? prefill?.toWalletId ?? '',
    type: transaction?.type ?? prefill?.type ?? 'expense',
    amount: decimalToInput(transaction?.amount ?? prefill?.amount),
    category: transaction?.category ?? prefill?.category ?? '',
    note: transaction?.note ?? prefill?.note ?? '',
    date: transaction?.date || prefill?.date || todayKey(),
  };
}

/** Record an expense, income, or a transfer between two wallets. */
export function TransactionForm({
  open,
  wallets,
  transaction,
  prefill,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  wallets: WalletBalance[];
  transaction?: Transaction;
  /**
   * Seeds a *new* entry — what the inbox hands over when an item is converted.
   * Unlike `transaction` it does not put the form into edit mode: the heading
   * still says "New transaction", because that is what is about to happen.
   * Fields it omits keep their usual defaults, and every one stays editable.
   */
  prefill?: Partial<TransactionPayload>;
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: TransactionPayload) => Promise<void>;
}) {
  const { t } = useTranslation();
  const { settings } = useSettings();
  const money = useMoneyFormatter();
  const [form, setForm] = useState<FormState>(() => initialState(wallets, transaction, prefill));
  /**
   * Applies whatever the scan could read.
   *
   * Only fields the scan actually returned are touched, and only the amount and
   * date are overwritten outright — the note is *appended to* rather than
   * replaced, because a user who typed "dinner with Mai" before scanning should
   * not lose it to a merchant name. Type, wallet and category are never touched:
   * a receipt cannot know which of your wallets paid.
   */
  function applyScan(scan: ReceiptScan) {
    setForm((prev) => ({
      ...prev,
      amount: scan.amount !== undefined ? String(scan.amount) : prev.amount,
      date: scan.date || prev.date,
      note: scan.note
        ? prev.note.trim()
          ? `${prev.note.trim()} · ${scan.note}`
          : scan.note
        : prev.note,
    }));
  }
  const [localError, setLocalError] = useState<string | null>(null);
  /**
   * Set when the entry would overdraw its wallet and the user has not yet
   * said to go ahead.
   *
   * The payload is held rather than re-read on confirm: the dialog is modal,
   * but a receipt scan or a background wallet refresh could still land between
   * asking and answering, and the user must be asked about the numbers they
   * were shown — not about whatever the form says a second later.
   */
  const [pending, setPending] = useState<TransactionPayload | null>(null);
  /* "Save as favourite" (a new entry) / "Make favourite" (an existing one):
     opens the favourite editor, filled in from what is in the form now. */
  const favourites = useOptionalFavourites();

  /* Only on open / a different record — see the note in InvestmentForm. */
  const walletsRef = useRef(wallets);
  walletsRef.current = wallets;

  /* Reseeded on open, and on a different prefill — converting one inbox item
     and then another without unmounting in between has to refill the fields
     rather than show the first one's amount. */
  const prefillKey = prefill ? JSON.stringify(prefill) : '';
  useEffect(() => {
    if (open) {
      setForm(initialState(walletsRef.current, transaction, prefill));
      setLocalError(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, transaction?.id, prefillKey]);

  const patch = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((prev) => ({ ...prev, [key]: value }));

  const amount = parseDecimal(form.amount);

  /* The wallet this entry takes money out of, and whether that leaves it
     short. An edit hands its own stored row over so the amount already
     deducted is not counted a second time — see `checkOverdraft`. */
  const sourceWallet = wallets.find((w) => w.id === form.walletId) ?? null;
  const overdraft = checkOverdraft({
    wallet: sourceWallet,
    type: form.type,
    amount,
    previous: transaction ?? null,
  });

  // Only expense-mode wallets can hold income/expense rows; transfers can touch any.
  const sourceOptions = form.type === 'transfer' ? wallets : wallets.filter((w) => w.mode === 'expense');
  const targetOptions = wallets.filter((w) => w.id !== form.walletId);

  /* Up to four amounts last used for this category (or this From → To pair)
     on this device, offered as chips on the number pad. New entries only:
     an edit is correcting a figure, not repeating one. */
  const recentFor = transaction ? null : recentKey(form.type, form);
  const recents = getRecentAmounts(recentFor);

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
      setLocalError(t('forms.pickWallet'));
      return;
    }
    if (amount <= 0) {
      setLocalError(t('forms.amountPositive'));
      return;
    }
    if (form.type === 'transfer' && !form.toWalletId) {
      setLocalError(t('forms.pickDestination'));
      return;
    }
    if (form.type !== 'transfer' && !form.category) {
      setLocalError(t('forms.pickCategory'));
      return;
    }
    setLocalError(null);

    const payload: TransactionPayload = { ...form, amount };

    /* Held back for confirmation rather than blocked: logging a past month, or
       money a friend fronted, legitimately takes a wallet negative, and an app
       that records what happened cannot refuse to record it. */
    if (overdraft.warn) {
      setPending(payload);
      return;
    }

    await send(payload);
  }

  async function send(payload: TransactionPayload) {
    try {
      await onSubmit(payload);
      rememberAmount(transaction ? null : recentKey(payload.type, payload), payload.amount);
      setPending(null);
    } catch {
      /* parent shows `error`; the sheet stays open with the entry intact */
      setPending(null);
    }
  }

  return (
    <Modal
      open={open}
      title={transaction ? t('forms.editTransaction') : t('forms.newTransaction')}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {transaction ? t('common.save') : t('common.add')}
          </Button>
        </>
      }
    >
      <form className="form-grid" onSubmit={submit}>
        {/* First in the form, because it fills the fields below it — putting it
            after them would ask the user to type and then be overwritten. Only
            offered for new rows: re-scanning an existing transaction would
            silently rewrite figures that are already reconciled. */}
        {!transaction && (
          <div className="span-2">
            <ReceiptScanner onFilled={applyScan} disabled={busy} />
          </div>
        )}

        {/* Where an existing row came from, when a widget or shortcut added it. */}
        {transaction?.source?.startsWith('widget:') && (
          <p className="span-2 field-hint">
            {t('widgets.addedFrom', { name: transaction.source.slice('widget:'.length) })}
          </p>
        )}

        <div className="span-2">
          <Segmented<TransactionType>
            value={form.type}
            ariaLabel={t('forms.transactionType')}
            onChange={setType}
            options={[
              { value: 'expense', label: `↓ ${t('forms.typeExpense')}` },
              { value: 'income', label: `↑ ${t('forms.typeIncome')}` },
              { value: 'transfer', label: `⇄ ${t('forms.typeTransfer')}` },
            ]}
          />
        </div>

        <Field label={t('forms.fromWallet')}>
          <WalletPicker
            wallets={sourceOptions}
            value={form.walletId}
            onChange={(id) =>
              setForm((prev) => ({ ...prev, walletId: id, toWalletId: prev.toWalletId === id ? '' : prev.toWalletId }))
            }
            placeholder={t('forms.noEligibleWallet')}
            required
          />
        </Field>

        {form.type === 'transfer' ? (
          <Field label={t('forms.toWallet')}>
            <WalletPicker
              wallets={targetOptions}
              value={form.toWalletId}
              onChange={(id) => patch('toWalletId', id)}
              placeholder={t('forms.selectPlaceholder')}
              required
            />
          </Field>
        ) : (
          <Field label={t('common.category')}>
            <Select value={form.category} onChange={(e) => patch('category', e.target.value)} required>
              <option value="">{t('forms.selectPlaceholder')}</option>
              {settings.categories.map((category) => (
                <option key={category} value={category}>
                  {category}
                </option>
              ))}
            </Select>
          </Field>
        )}

        <Field
          label={t('forms.amountIn', { currency: money.base })}
          hint={money.converting && amount > 0 ? t('forms.approxAmount', { amount: money(amount) }) : undefined}
        >
          <DecimalInput
            value={form.amount}
            onChange={(raw) => patch('amount', raw)}
            placeholder="0.00"
            required
            autoFocus
            recents={recents}
          />
        </Field>

        <Field label={t('common.date')}>
          <Input type="date" value={form.date} onChange={(e) => patch('date', e.target.value)} required />
        </Field>

        <Field label={t('common.note')} className="span-2">
          <Textarea
            value={form.note}
            onChange={(e) => patch('note', e.target.value)}
            maxLength={300}
            placeholder={t('common.optional')}
          />
        </Field>

        {favourites && (
          <div className="span-2 tx-form-fav">
            <Button
              size="sm"
              variant="ghost"
              onClick={() =>
                favourites.makeFromTransaction({ ...form, amount: amount > 0 ? amount : null })
              }
            >
              ☆ {transaction ? t('favourites.makeFavourite') : t('favourites.saveAsFavourite')}
            </Button>
          </div>
        )}

        {(localError || error) && (
          <div className="span-2">
            <Alert tone="error">{localError || error}</Alert>
          </div>
        )}

        <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
      </form>

      {/* Over the form, not instead of it: cancelling returns to the entry
          exactly as it was so the amount or the wallet can be corrected. */}
      <OverdraftWarningModal
        open={pending !== null}
        wallet={sourceWallet}
        amount={pending?.amount ?? amount}
        check={overdraft}
        busy={busy}
        onConfirm={() => {
          const payload = pending;
          if (payload) void send(payload);
        }}
        onCancel={() => setPending(null)}
      />
    </Modal>
  );
}
