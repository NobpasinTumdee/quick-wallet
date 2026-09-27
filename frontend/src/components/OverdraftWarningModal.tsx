import { AlertTriangle } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { Icon } from './Icon';
import { Button, Modal } from './ui';
import { OverdraftCheck } from '../lib/overdraft';
import { useMoneyFormatter } from '../state/SettingsContext';
import { WalletBalance } from '../types';

/**
 * "That is more than this wallet holds."
 *
 * ---------------------------------------------------------------------------
 * WHY IT ASKS RATHER THAN REFUSES
 * ---------------------------------------------------------------------------
 * Plenty of real entries legitimately overdraw a wallet: logging last month's
 * spending before last month's income, tracking money a friend fronted, or
 * simply recording what the bank actually did. An app whose job is to record
 * what happened cannot refuse to record something that happened.
 *
 * So the dialog states the arithmetic and gets out of the way. Cancel is the
 * default action and the safe one; proceeding is one deliberate click.
 *
 * ---------------------------------------------------------------------------
 * WHY THE NUMBERS ARE SHOWN
 * ---------------------------------------------------------------------------
 * "Insufficient balance" alone leaves the reader to work out whether they
 * mistyped 5,000 for 500 or are genuinely 200 short. The balance, the amount
 * and the resulting figure are all on screen, because the entire decision is
 * whether that resulting figure is the one they meant.
 */
export function OverdraftWarningModal({
  open,
  wallet,
  amount,
  check,
  busy,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  wallet: WalletBalance | null;
  amount: number;
  check: OverdraftCheck;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();

  if (!open || !wallet) return null;

  const creditLimit = check.reason === 'credit-limit';

  return (
    <Modal
      open
      onClose={onCancel}
      width={420}
      title={creditLimit ? t('forms.overCreditLimitTitle') : t('forms.overdraftTitle')}
      footer={
        <>
          {/* Cancel first and unstyled-as-primary: it is the safe way out, and
              the one that should catch a mistyped amount. */}
          <Button onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button variant="danger" onClick={onConfirm} loading={busy}>
            {t('forms.overdraftProceed')}
          </Button>
        </>
      }
    >
      <div className="stack overdraft">
        <div className="overdraft-warning">
          <Icon icon={AlertTriangle} />
          <p>
            {creditLimit
              ? t('forms.overCreditLimitBody', {
                  wallet: wallet.name,
                  amount: money(check.shortfall),
                })
              : t('forms.overdraftBody')}
          </p>
        </div>

        {/* The three figures the decision turns on, in the order they happen. */}
        <dl className="overdraft-sums">
          <div>
            <dt>{t('forms.overdraftBalance', { wallet: wallet.name })}</dt>
            <dd>{money(wallet.balance)}</dd>
          </div>
          <div>
            <dt>{t('forms.overdraftAmount')}</dt>
            <dd>−{money(amount)}</dd>
          </div>
          <div className="is-result">
            <dt>{t('forms.overdraftAfter')}</dt>
            <dd className={check.balanceAfter < 0 ? 'text-negative' : undefined}>
              {money(check.balanceAfter)}
            </dd>
          </div>
        </dl>
      </div>
    </Modal>
  );
}
