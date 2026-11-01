import { Check, ChevronDown } from 'lucide-react';
import { ReactNode, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { cx, formatCompactAmount } from '../lib/format';
import { useMoneyFormatter, useSettings } from '../state/SettingsContext';
import { WalletBalance } from '../types';
import { Icon } from './Icon';
import { Modal } from './ui';
import { WalletIconRenderer } from './WalletIconRenderer';

/**
 * A wallet select that shows what each wallet holds.
 *
 * A native `<select>` can only show one line of plain text per option, so the
 * balance used to be squeezed into the name ("Cash · ฿1,234.00") where it
 * showed at all, and could not be aligned, coloured or kept from being cut.
 * This is a button that looks like the select it replaces — logo, name, and
 * the balance on the right — opening a sheet on the shared Modal (so Back and
 * Escape close it like any other) with one row per wallet.
 *
 * The balance is the same one the Wallets page shows, in the display
 * currency. A credit card's is what is owed, so it reads as a negative, in
 * the negative colour. The name truncates; the amount never does — and on the
 * narrowest phones the closed box switches it to the short form (12.3k).
 *
 * A visually hidden input carries the value for the form: `required` still
 * blocks a submit, and the number pad's "Next" still finds it unfilled.
 */
export function WalletPicker({
  wallets,
  value,
  onChange,
  emptyLabel,
  placeholder,
  disabled,
  required,
  label,
  className,
  'aria-label': ariaLabel,
}: {
  wallets: WalletBalance[];
  value: string;
  onChange: (walletId: string) => void;
  /** Offers "" as a real choice — "All wallets", "Same wallet". */
  emptyLabel?: string;
  /** Shown while nothing is picked and "" is not a choice. */
  placeholder?: string;
  disabled?: boolean;
  required?: boolean;
  /** The sheet's title. Defaults to the field's own label. */
  label?: ReactNode;
  className?: string;
  'aria-label'?: string;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const listId = useId();

  const selected = wallets.find((wallet) => wallet.id === value) ?? null;
  const title =
    label ?? ariaLabel ?? buttonRef.current?.closest('label')?.querySelector('.field-label')?.textContent ?? t('walletPicker.title');

  function pick(walletId: string) {
    onChange(walletId);
    setOpen(false);
    /* Back on the box, so the keyboard user carries on from here. */
    window.setTimeout(() => buttonRef.current?.focus({ preventScroll: true }), 0);
  }

  return (
    <div className={cx('wallet-picker', className)}>
      <button
        ref={buttonRef}
        type="button"
        className={cx('control', 'wallet-picker-btn', !selected && 'is-placeholder')}
        disabled={disabled}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={ariaLabel}
        onClick={() => setOpen(true)}
      >
        {selected ? (
          <WalletLine wallet={selected} variant="closed" />
        ) : (
          <span className="wallet-picker-name">{emptyLabel ?? placeholder ?? t('walletPicker.placeholder')}</span>
        )}
        <Icon icon={ChevronDown} size="sm" className="wallet-picker-chevron" />
      </button>

      <input
        className="wallet-picker-value"
        value={value}
        required={required}
        tabIndex={-1}
        aria-hidden="true"
        data-wallet-picker-value=""
        onChange={() => undefined}
        /* The browser points at an empty required field by focusing it; send
           that to the box the user can actually see. */
        onInvalid={() => buttonRef.current?.focus()}
      />

      <Modal open={open} title={title} onClose={() => setOpen(false)} width={440}>
        <div className="wallet-picker-list" role="listbox" id={listId} aria-label={typeof title === 'string' ? title : undefined}>
          {emptyLabel !== undefined && (
            <button
              type="button"
              role="option"
              aria-selected={value === ''}
              className={cx('wallet-picker-option', value === '' && 'is-selected')}
              onClick={() => pick('')}
            >
              <span className="wallet-picker-name">{emptyLabel}</span>
              {value === '' && <Icon icon={Check} size="sm" className="wallet-picker-check" />}
            </button>
          )}
          {wallets.length === 0 && emptyLabel === undefined && (
            <p className="wallet-picker-empty">{t('forms.noEligibleWallet')}</p>
          )}
          {wallets.map((wallet) => (
            <button
              key={wallet.id}
              type="button"
              role="option"
              aria-selected={wallet.id === value}
              className={cx('wallet-picker-option', wallet.id === value && 'is-selected')}
              onClick={() => pick(wallet.id)}
            >
              <WalletLine wallet={wallet} variant="option" />
              {wallet.id === value && <Icon icon={Check} size="sm" className="wallet-picker-check" />}
            </button>
          ))}
        </div>
      </Modal>
    </div>
  );
}

/** Logo, name (and kind), and the balance — the one row both states share. */
function WalletLine({ wallet, variant }: { wallet: WalletBalance; variant: 'closed' | 'option' }) {
  const { t } = useTranslation();
  const money = useMoneyFormatter();
  const { settings } = useSettings();
  const balance = Number(wallet.balance) || 0;
  const kind =
    wallet.mode === 'investment'
      ? t('walletPicker.investment')
      : wallet.type === 'CREDIT'
        ? t('walletPicker.credit')
        : '';

  return (
    <>
      <WalletIconRenderer icon={wallet.icon} color={wallet.color} size="sm" className="wallet-picker-icon" />
      <span className="wallet-picker-text">
        <span className="wallet-picker-name">{wallet.name}</span>
        {variant === 'option' && kind && <span className="wallet-picker-kind">{kind}</span>}
      </span>
      <span className={cx('wallet-picker-amount', balance < 0 && 'text-negative')}>
        <span className="wallet-picker-amount-full">{money(balance)}</span>
        {variant === 'closed' && (
          <span className="wallet-picker-amount-short" aria-hidden="true">
            {formatCompactAmount(money.convert(balance), settings.locale)}
          </span>
        )}
      </span>
    </>
  );
}
