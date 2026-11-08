import { Banknote, CreditCard, Landmark, LucideIcon, Shapes, Smartphone, TrendingUp } from 'lucide-react';
import { useTranslation } from 'react-i18next';

import { cx } from '../lib/format';
import { TranslationKey } from '../locales';
import { WalletKind } from '../types';
import { Icon } from './Icon';

const KIND_ICON: Record<WalletKind, LucideIcon> = {
  cash: Banknote,
  bank: Landmark,
  ewallet: Smartphone,
  credit: CreditCard,
  brokerage: TrendingUp,
  other: Shapes,
};

/* The same names the wallet form offers. */
const KIND_LABEL: Record<WalletKind, TranslationKey> = {
  cash: 'forms.kindCash',
  bank: 'forms.kindBank',
  ewallet: 'forms.kindEwallet',
  credit: 'forms.kindCredit',
  brokerage: 'forms.kindBrokerage',
  other: 'forms.kindOther',
};

/**
 * The small header over one kind's wallets: icon, kind name, how many, and
 * (when given) the group's subtotal on the right. The name truncates before
 * anything else gives way, so the count and the figure always stay whole.
 */
export function WalletKindHeader({
  kind,
  count,
  total,
  className,
}: {
  kind: WalletKind;
  count: number;
  /** Already formatted, exactly like the mode total above it. */
  total?: string;
  className?: string;
}) {
  const { t } = useTranslation();
  const label = t(KIND_LABEL[kind]);
  return (
    <h3 className={cx('wallet-kind-head', className)}>
      <span className="wallet-kind-icon" aria-hidden="true">
        <Icon icon={KIND_ICON[kind]} size="sm" />
      </span>
      <span className="wallet-kind-name truncate" title={label}>
        {label}
      </span>
      <span className="wallet-kind-count" aria-hidden="true">
        {count}
      </span>
      <span className="sr-only">{t('wallets.kindCount', { count })}</span>
      {total !== undefined && <span className="wallet-kind-total">{total}</span>}
    </h3>
  );
}
