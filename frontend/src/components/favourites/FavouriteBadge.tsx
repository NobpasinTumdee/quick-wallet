import { ArrowDown, ArrowLeftRight, ArrowUp } from 'lucide-react';

import type { Favourite } from '../../lib/favourites';
import { cx } from '../../lib/format';
import { Icon } from '../Icon';

/** The favourite's emoji (or its type's arrow) on its theme colour. Decorative. */
export function FavouriteBadge({ fav, className }: { fav: Favourite; className?: string }) {
  return (
    <span className={cx('fav-badge', `fav-c-${fav.color}`, className)} aria-hidden="true">
      {fav.emoji ? (
        <span className="fav-badge-emoji">{fav.emoji}</span>
      ) : (
        <Icon icon={fav.type === 'income' ? ArrowUp : fav.type === 'transfer' ? ArrowLeftRight : ArrowDown} size="sm" />
      )}
    </span>
  );
}
