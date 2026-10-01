import { ArrowDownLeft } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { Alert, Button, Field, Input, Modal, Select } from './ui';
import { todayKey } from '../lib/format';
import { walletIconText } from '../lib/walletIcons';
import { useMoneyFormatter } from '../state/SettingsContext';
import { BillSplit, BillSplitShare, WalletBalance } from '../types';

/**
 * "Where did this land?"
 *
 * ---------------------------------------------------------------------------
 * WHY MARKING A SHARE PAID STOPPED BEING ONE CLICK
 * ---------------------------------------------------------------------------
 * It used to book the repayment straight back into the wallet that paid the
 * bill, which is wrong often enough to matter: a dinner put on a credit card
 * is handed back in cash, and a bill paid from the joint account is repaid by
 * transfer to a personal one. Every one of those produced a card or an account
 * holding money it never received.
 *
 * The app cannot infer it, so it asks — once, with the answer already filled
 * in. The cost is one tap on a flow that happens a few times per bill; the
 * thing it buys is wallet balances that are true.
 *
 * ---------------------------------------------------------------------------
 * WHAT IS PRE-SELECTED
 * ---------------------------------------------------------------------------
 * The bill's own default when it has one — a subscription stamps it onto every
 * bill it raises, so a shared Netflix never asks twice. Otherwise the wallet
 * that paid, which is what this app did before the choice existed and is right
 * whenever the money simply goes back where it came from.
 */
export function RepaymentModal({
  bill,
  share,
  wallets,
  busy,
  error,
  onConfirm,
  onCancel,
}: {
  /** The bill the share belongs to, or null when nothing is being settled. */
  bill: BillSplit | null;
  share: BillSplitShare | null;
  /** Spending wallets only — a reimbursement is cash arriving. */
  wallets: WalletBalance[];
  busy?: boolean;
  error?: string | null;
  onConfirm: (receivingWalletId: string, date: string) => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();

  const [walletId, setWalletId] = useState('');
  const [date, setDate] = useState(todayKey);

  /* Re-seeded whenever a different share opens the dialog, so the previous
     answer never carries over to the next person on the bill. */
  useEffect(() => {
    if (!bill) return;
    const fallback = bill.defaultRepaymentWalletId || bill.walletId;
    /* Only offer a wallet that still exists: one deleted since the bill was
       created would otherwise be pre-selected and fail on confirm. */
    const known = wallets.some((wallet) => wallet.id === fallback);
    setWalletId(known ? fallback : (wallets[0]?.id ?? ''));
    setDate(todayKey());
  }, [bill, share, wallets]);

  if (!bill || !share) return null;

  return (
    <Modal
      open
      onClose={onCancel}
      width={420}
      title={t('split.repaymentTitle')}
      footer={
        <>
          <Button onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!walletId || busy}
            onClick={() => onConfirm(walletId, date)}
          >
            {t('split.repaymentConfirm')}
          </Button>
        </>
      }
    >
      <div className="stack repayment">
        {/* Who and how much, stated before the question is asked. */}
        <p className="repayment-headline">
          <span className="repayment-avatar" aria-hidden="true">
            <Icon icon={ArrowDownLeft} size="sm" />
          </span>
          <span>
            <strong>{share.personName}</strong>
            <small>{bill.title}</small>
          </span>
          <strong className="repayment-amount">{money(share.amount)}</strong>
        </p>

        {error && <Alert tone="error">{error}</Alert>}

        {wallets.length === 0 ? (
          <Alert tone="warning">{t('split.needWallet')}</Alert>
        ) : (
          <>
            <Field label={t('split.receiveInto')} hint={t('split.receiveIntoHint')}>
              <Select value={walletId} onChange={(event) => setWalletId(event.target.value)}>
                {wallets.map((wallet) => (
                  <option key={wallet.id} value={wallet.id}>
                    {walletIconText(wallet.icon)} {wallet.name} · {money(wallet.balance)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('split.repaymentDate')}>
              <Input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
            </Field>
          </>
        )}
      </div>
    </Modal>
  );
}
