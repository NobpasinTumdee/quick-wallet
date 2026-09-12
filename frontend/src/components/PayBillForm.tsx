/**
 * Pay a card bill.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS WRITES A TRANSFER AND NOT AN EXPENSE
 * ---------------------------------------------------------------------------
 * The money left the bank account, so the temptation is to record an expense.
 * That would count the same spending twice: once when the coffee was charged to
 * the card, and again when the card was paid. The month's expense total would
 * roughly double for anyone who puts most of their spending on a card, and
 * every budget would blow through on payday rather than when they actually
 * spent anything.
 *
 * A transfer is the truthful shape — money moved between two accounts you own —
 * and the existing ledger already excludes transfers from income and expense
 * everywhere. So this reuses the transfer path exactly as it is, and the
 * double-counting problem never arises rather than being corrected for.
 */

import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { CardState } from '../lib/creditMath';
import { formatDate, todayKey } from '../lib/format';
import { useMoneyFormatter } from '../state/SettingsContext';
import { WalletBalance } from '../types';
import {
  Alert,
  Button,
  DecimalInput,
  Field,
  Input,
  Modal,
  Segmented,
  Select,
  decimalToInput,
  parseDecimal,
} from './ui';

/**
 * The three amounts worth offering as one tap.
 *
 * `statement` is first and is the default because it is the only one with a
 * deadline attached — it is what the bank asked for. `full` clears the unbilled
 * charges too, which avoids interest on anyone who revolves; `custom` exists
 * because part-payments are normal and a minimum payment is a real thing this
 * app does not know the rate of.
 */
type Preset = 'statement' | 'full' | 'custom';

export interface PayBillPayload {
  fromWalletId: string;
  amount: number;
  date: string;
  note: string;
}

export function PayBillForm({
  open,
  card,
  wallets,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  open: boolean;
  card: CardState | null;
  /** CASH wallets only — paying a card from a card is not a thing. */
  wallets: WalletBalance[];
  busy?: boolean;
  error?: string | null;
  onClose: () => void;
  onSubmit: (payload: PayBillPayload) => Promise<void>;
}) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();

  const [preset, setPreset] = useState<Preset>('statement');
  const [fromWalletId, setFromWalletId] = useState('');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(todayKey());
  const [note, setNote] = useState('');
  const [localError, setLocalError] = useState<string | null>(null);

  const statementBalance = card?.statementBalance ?? 0;
  const currentBalance = Math.max(0, card?.currentBalance ?? 0);

  /* Reset per opening, not per render: a background refresh rebuilding the card
     object mid-edit must not wipe what the user has typed. Same rule the wallet
     form follows. */
  useEffect(() => {
    if (!open || !card) return;

    // Default to the statement if there is one, otherwise to the whole balance
    // — a card with no cycle set has no statement to owe.
    const startPreset: Preset = statementBalance > 0 ? 'statement' : 'full';
    setPreset(startPreset);
    setAmount(decimalToInput(startPreset === 'statement' ? statementBalance : currentBalance));
    setDate(todayKey());
    setNote('');
    setLocalError(null);
    // Biggest balance first: paying a bill from the account that can cover it
    // is the overwhelmingly common case, and it saves a tap.
    setFromWalletId(
      [...wallets].sort((a, b) => b.balance - a.balance)[0]?.id ?? '',
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, card?.wallet.id]);

  if (!card) return null;

  function choosePreset(next: Preset) {
    setPreset(next);
    if (next === 'statement') setAmount(decimalToInput(statementBalance));
    if (next === 'full') setAmount(decimalToInput(currentBalance));
  }

  const value = parseDecimal(amount);
  const source = wallets.find((w) => w.id === fromWalletId);
  // A warning, not a block: overdrafts happen, and the app should not refuse to
  // record something the user's bank already let them do.
  const overdraws = Boolean(source) && value > source!.balance;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!fromWalletId) {
      setLocalError(t('forms.chooseSourceWallet'));
      return;
    }
    if (!(value > 0)) {
      setLocalError(t('forms.amountGreaterThanZero'));
      return;
    }
    setLocalError(null);
    try {
      await onSubmit({ fromWalletId, amount: value, date, note: note.trim() });
    } catch {
      // The parent surfaces the API message via `error`; keep the sheet open.
    }
  }

  const remaining = currentBalance - value;

  return (
    <Modal
      open={open}
      title={t('forms.payCard', { name: card.wallet.name })}
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" onClick={submit} loading={busy}>
            {t('forms.payAmount', { amount: money(value) })}
          </Button>
        </>
      }
    >
      {wallets.length === 0 ? (
        <Alert tone="warning" title={t('forms.nowhereToPayFrom')}>
          {t('forms.nowhereToPayFromBody')}
        </Alert>
      ) : (
        <form className="form-grid" onSubmit={submit}>
          <div className="span-2 paybill-summary">
            <div className="metric">
              <span className="section-label">{t('cards.statementBalance')}</span>
              <span className="metric-value">{money(statementBalance)}</span>
              <span className="metric-hint">
                {card.paymentDueDate
                  ? t('cards.dueOn', { date: formatDate(card.paymentDueDate) })
                  : t('forms.noDueDateSet')}
              </span>
            </div>
            <div className="metric">
              <span className="section-label">{t('forms.unbilledSince')}</span>
              <span className="metric-value">{money(card.unbilledBalance)}</span>
              <span className="metric-hint">
                {card.lastStatementDate
                  ? formatDate(card.lastStatementDate)
                  : t('forms.noStatementDaySet')}
              </span>
            </div>
          </div>

          <div className="span-2">
            <Field label={t('forms.howMuch')}>
              <Segmented<Preset>
                value={preset}
                onChange={choosePreset}
                ariaLabel={t('forms.paymentAmount')}
                options={[
                  { value: 'statement', label: t('forms.presetStatement', { amount: money(statementBalance, { compact: true }) }) },
                  { value: 'full', label: t('forms.presetFull', { amount: money(currentBalance, { compact: true }) }) },
                  { value: 'custom', label: t('forms.presetCustom') },
                ]}
              />
            </Field>
          </div>

          <Field
            label={t('common.amount')}
            hint={
              remaining > 0.005
                ? t('forms.stillOwed', { amount: money(remaining) })
                : remaining < -0.005
                  ? t('forms.endsInCredit', { amount: money(-remaining) })
                  : t('forms.clearsExactly')
            }
          >
            <DecimalInput
              value={amount}
              onChange={(raw) => {
                setAmount(raw);
                setPreset('custom');
              }}
              placeholder="0.00"
            />
          </Field>

          <Field
            label={t('forms.payFrom')}
            error={overdraws ? t('forms.onlyHolds', { name: source?.name ?? '', amount: money(source?.balance ?? 0) }) : undefined}
          >
            <Select value={fromWalletId} onChange={(e) => setFromWalletId(e.target.value)}>
              {wallets.map((wallet) => (
                <option key={wallet.id} value={wallet.id}>
                  {t('forms.walletOption', { icon: wallet.icon, name: wallet.name, amount: money(wallet.balance) })}
                </option>
              ))}
            </Select>
          </Field>

          <Field label={t('common.date')}>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>

          <Field label={t('common.note')} hint={t('common.optional')}>
            <Input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder={t('forms.billPaymentNote', { name: card.wallet.name })}
              maxLength={300}
            />
          </Field>

          <div className="span-2">
            <Alert tone="info">
              {t('forms.transferNotice')}
            </Alert>
          </div>

          {(localError || error) && (
            <div className="span-2">
              <Alert tone="error">{localError || error}</Alert>
            </div>
          )}

          <button type="submit" hidden aria-hidden="true" tabIndex={-1} />
        </form>
      )}
    </Modal>
  );
}
