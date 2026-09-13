import { AlertTriangle, Wallet as WalletIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { overdrawsWallet, paymentSplit, projectedMonthlyInterest } from '../lib/debtMath';
import { todayKey } from '../lib/format';
import { useMoneyFormatter } from '../state/SettingsContext';
import { Debt, WalletBalance } from '../types';
import { Icon } from './Icon';
import { Alert, Button, DecimalInput, Field, Input, Modal, Select, parseDecimal } from './ui';

/**
 * Recording a payment against a debt.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS SHOWS ITS WORKING
 * ---------------------------------------------------------------------------
 * Every other write in this app is reversible by editing a row. This one moves
 * real money out of a wallet and changes a balance the user is judged on, and
 * the arithmetic behind it is not obvious: most of a small payment on a
 * high-APR debt goes to interest, and a payment below the monthly interest
 * moves the balance the wrong way.
 *
 * So the split is shown live as the amount is typed, before the button is
 * pressed. A number that appears after the fact is a receipt; the same number
 * shown beforehand is a decision.
 *
 * ---------------------------------------------------------------------------
 * WHY NOTHING HERE BLOCKS
 * ---------------------------------------------------------------------------
 * Overdrawing the wallet, paying more than is owed, paying less than the
 * interest — all three are warned about and all three are allowed. Every one is
 * a real thing people do, and this app records what happened rather than
 * policing what may. The only hard stop is a payment of zero, which is not a
 * payment.
 */
export function DebtPaymentModal({
  debt,
  wallets,
  busy,
  error,
  onClose,
  onSubmit,
}: {
  debt: Debt | null;
  /** Spending wallets only — the server refuses investment wallets. */
  wallets: WalletBalance[];
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (input: { amount: number; walletId: string; date: string; note: string }) => void;
}) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();

  const [amount, setAmount] = useState('');
  const [walletId, setWalletId] = useState('');
  const [date, setDate] = useState(todayKey);
  const [note, setNote] = useState('');

  /* Re-seeded whenever a different debt opens the modal, rather than in an
     effect: keying the state off the debt id means no stale amount survives
     from the last debt the user looked at, and no extra render to clear it. */
  const [seededFor, setSeededFor] = useState<string | null>(null);
  if (debt && seededFor !== debt.id) {
    setSeededFor(debt.id);
    setAmount(debt.minimumPayment > 0 ? String(debt.minimumPayment) : '');
    setWalletId(wallets[0]?.id ?? '');
    setDate(todayKey());
    setNote('');
  }

  const parsed = parseDecimal(amount);
  const wallet = wallets.find((w) => w.id === walletId) ?? null;

  const preview = useMemo(() => {
    if (!debt || !(parsed > 0)) return null;
    const split = paymentSplit(debt, parsed);
    return {
      ...split,
      remaining: Math.max(0, Math.round((debt.currentBalance - parsed) * 100) / 100),
      overpaid: Math.max(0, Math.round((parsed - debt.currentBalance) * 100) / 100),
      overdraws: wallet ? overdrawsWallet(wallet.balance, parsed) : false,
    };
  }, [debt, parsed, wallet]);

  if (!debt) return null;

  const canSubmit = parsed > 0 && Boolean(walletId) && !busy;

  return (
    <Modal
      open
      onClose={onClose}
      title={t('debt.payTitle', { title: debt.title })}
    >
      <form
        className="stack debt-pay"
        onSubmit={(event) => {
          event.preventDefault();
          if (!canSubmit) return;
          onSubmit({ amount: parsed, walletId, date, note: note.trim() });
        }}
      >
        {/* The figure the whole dialog is about, stated once at the top so it
            is never something the reader has to remember from the card. */}
        <p className="debt-pay-outstanding">
          <span>{t('debt.outstanding')}</span>
          <strong>{money(debt.currentBalance)}</strong>
        </p>

        {error && <Alert tone="error">{error}</Alert>}

        {wallets.length === 0 ? (
          <Alert tone="warning">{t('debt.payNoWallet')}</Alert>
        ) : (
          <>
            <Field label={t('debt.payAmount')}>
              <DecimalInput value={amount} onChange={setAmount} autoFocus />
            </Field>

            {/* Two shortcuts, because they are the two amounts anyone actually
                pays: the minimum, and the whole thing. */}
            <div className="cluster debt-pay-presets">
              {debt.minimumPayment > 0 && (
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setAmount(String(debt.minimumPayment))}
                >
                  {t('debt.payMinimum', { amount: money(debt.minimumPayment) })}
                </Button>
              )}
              <Button
                type="button"
                size="sm"
                onClick={() => setAmount(String(debt.currentBalance))}
              >
                {t('debt.payFull', { amount: money(debt.currentBalance) })}
              </Button>
            </div>

            <Field label={t('debt.payFrom')} hint={t('debt.payFromHint')}>
              <Select value={walletId} onChange={(event) => setWalletId(event.target.value)}>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · {money(w.balance)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('debt.payDate')}>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>

            <Field label={t('debt.payNote')} hint={t('common.optional')}>
              <Input
                value={note}
                onChange={(event) => setNote(event.target.value)}
                placeholder={debt.title}
                maxLength={300}
              />
            </Field>

            {/* ---- The working ---- */}
            {preview && (
              <div className="debt-pay-preview">
                {preview.shortfall ? (
                  /* The one case where the payment makes things worse. Said
                     plainly, not as a tint on a number. */
                  <p className="debt-pay-warn">
                    <Icon icon={AlertTriangle} size="sm" />
                    {t('debt.paySplitShortfall', {
                      amount: money(
                        projectedMonthlyInterest(debt.currentBalance, debt.interestRateApr),
                      ),
                    })}
                  </p>
                ) : (
                  <p className="debt-pay-split">
                    {t('debt.paySplit', {
                      interest: money(preview.interest),
                      principal: money(preview.principal),
                    })}
                  </p>
                )}

                <p className="debt-pay-after">
                  {t('debt.payAfter', { amount: money(preview.remaining) })}
                </p>

                {preview.overpaid > 0 && (
                  <p className="debt-pay-note">
                    {t('debt.payOverpay', { amount: money(preview.overpaid) })}
                  </p>
                )}

                {preview.overdraws && wallet && (
                  <p className="debt-pay-warn">
                    <Icon icon={WalletIcon} size="sm" />
                    {t('debt.payOverdraw', {
                      wallet: wallet.name,
                      balance: money(wallet.balance),
                    })}
                  </p>
                )}
              </div>
            )}

            <div className="cluster" style={{ justifyContent: 'flex-end' }}>
              <Button type="button" variant="ghost" onClick={onClose} disabled={busy}>
                {t('common.cancel')}
              </Button>
              <Button type="submit" variant="primary" disabled={!canSubmit}>
                {busy ? t('common.loading') : t('debt.payConfirm')}
              </Button>
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}
