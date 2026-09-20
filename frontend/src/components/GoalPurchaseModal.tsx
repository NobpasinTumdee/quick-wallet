import { AlertTriangle, ShoppingBag, Wallet as WalletIcon } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { Alert, Button, Field, Input, Modal, Select } from './ui';
import { todayKey } from '../lib/format';
import { useMoneyFormatter } from '../state/SettingsContext';
import { Goal, WalletBalance } from '../types';

/**
 * "Which wallet will you use to pay for this?"
 *
 * ---------------------------------------------------------------------------
 * WHY A WHOLE DIALOG FOR ONE DROPDOWN
 * ---------------------------------------------------------------------------
 * This is the only button in the goals screen that spends real money, and it
 * cannot be undone by editing a row: it writes an expense and closes the goal.
 * A one-tap Buy would be the same gesture as Fund with a permanent consequence
 * behind it. So the money is named, the wallet is chosen deliberately, and the
 * balance after the purchase is shown before the button is pressed.
 *
 * The wallet list carries balances for the same reason the debt payment modal
 * does: choosing where the money comes from is a decision, and it cannot be
 * made from names alone.
 *
 * ---------------------------------------------------------------------------
 * WHAT IT WARNS ABOUT AND WHAT IT BLOCKS
 * ---------------------------------------------------------------------------
 * Overdrawing is warned about, never blocked — a card or an overdraft is a real
 * way to buy something, and this app records what happened rather than policing
 * what may. The only hard stop is having no wallet to pay from, which is not a
 * warning but a missing prerequisite.
 */
export function GoalPurchaseModal({
  goal,
  wallets,
  walletId,
  onWalletId,
  date,
  onDate,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  goal: Goal | null;
  /** Spending wallets only — the server refuses investment wallets. */
  wallets: WalletBalance[];
  walletId: string;
  onWalletId: (id: string) => void;
  date: string;
  onDate: (date: string) => void;
  busy: boolean;
  error: string | null;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();

  if (!goal) return null;

  const price = goal.targetAmount;
  const wallet = wallets.find((w) => w.id === walletId) ?? null;
  const after = wallet ? Math.round((wallet.balance - price) * 100) / 100 : null;
  /* What the envelope never got to. The purchase still goes through; the
     difference simply comes out of the wallet like any other spending. */
  const shortfall = Math.max(0, Math.round((price - goal.savedAmount) * 100) / 100);
  const canSubmit = Boolean(walletId) && !busy && wallets.length > 0;

  return (
    <Modal
      open
      onClose={onClose}
      width={440}
      title={t('goals.purchaseTitle', { title: goal.title })}
      footer={
        <>
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="primary" loading={busy} disabled={!canSubmit} onClick={onConfirm}>
            <Icon icon={ShoppingBag} size="sm" />
            {t('goals.purchaseConfirm', { amount: money(price) })}
          </Button>
        </>
      }
    >
      <div className="stack goal-buy-modal">
        {/* The figure the dialog is about, stated once at the top so it is
            never something the reader has to remember from the card. */}
        <p className="goal-buy-price">
          <span>{t('goals.purchasePrice')}</span>
          <strong>{money(price)}</strong>
        </p>

        {error && <Alert tone="error">{error}</Alert>}

        {wallets.length === 0 ? (
          <Alert tone="warning">{t('goals.purchaseNoWallet')}</Alert>
        ) : (
          <>
            <Field label={t('goals.purchaseFrom')} hint={t('goals.purchaseFromHint')}>
              <Select value={walletId} onChange={(event) => onWalletId(event.target.value)}>
                {wallets.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name} · {money(w.balance)}
                  </option>
                ))}
              </Select>
            </Field>

            <Field label={t('goals.purchaseDate')}>
              <Input
                type="date"
                value={date || todayKey()}
                onChange={(event) => onDate(event.target.value)}
              />
            </Field>

            <div className="goal-buy-preview">
              {after !== null && wallet && (
                <p className="goal-buy-after">
                  <Icon icon={WalletIcon} size="sm" />
                  {t('goals.purchaseAfter', { wallet: wallet.name, amount: money(after) })}
                </p>
              )}

              {shortfall > 0 && (
                <p className="goal-buy-warn">
                  <Icon icon={AlertTriangle} size="sm" />
                  {t('goals.purchaseShortfall', { amount: money(shortfall) })}
                </p>
              )}

              {after !== null && after < 0 && wallet && (
                <p className="goal-buy-warn">
                  <Icon icon={AlertTriangle} size="sm" />
                  {t('goals.purchaseOverdraw', {
                    wallet: wallet.name,
                    balance: money(wallet.balance),
                  })}
                </p>
              )}

              <p className="goal-buy-note">{t('goals.purchaseEffect')}</p>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
