import { bankForIcon } from '../lib/walletIcons';
import { cx } from '../lib/format';

/**
 * A wallet's icon, whichever kind it is.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LOGO SITS ON A WHITE TILE
 * ---------------------------------------------------------------------------
 * Bank logos are drawn for their own brand backgrounds: several are white
 * marks on a transparent field, which vanish completely on Cocoa or Midnight,
 * and the rest are dark marks that vanish on Matcha. There is no theme-aware
 * way to place an arbitrary PNG.
 *
 * So a bank logo always gets the same white tile, in every theme — the
 * convention every banking app uses, and the only one where all twenty-one
 * marks stay legible. The tile is the logo's background, not the app's: it is
 * small, round and reads as part of the mark.
 *
 * Emoji icons keep the surface tint they have always had; they carry their own
 * colour and need no help.
 *
 * ---------------------------------------------------------------------------
 * `contain`, NOT `cover`
 * ---------------------------------------------------------------------------
 * `cover` crops to fill, which on a logo shaves the edges off the mark — and
 * on the wordmarks in this set (HSBC, CIMB) that removes letters. `contain`
 * fits the whole mark inside the tile, which is what a logo requires. The
 * sources are square, so in practice the only visible difference is exactly
 * that cropping.
 */
export function WalletIconRenderer({
  icon,
  color,
  size = 'md',
  className,
}: {
  /** The stored value: an emoji, or `bank:SYMBOL`. */
  icon: string | null | undefined;
  /** The wallet's own colour, used for the emoji tile as before. */
  color?: string;
  size?: 'sm' | 'md' | 'lg';
  className?: string;
}) {
  const bank = bankForIcon(icon);

  if (bank) {
    return (
      <span className={cx('wallet-icon', `wallet-icon--${size}`, 'is-bank', className)}>
        <img
          src={bank.logo}
          /* Empty alt and aria-hidden: every place this renders already names
             the wallet next to it, so announcing "Kasikorn Bank logo" would
             read the same thing twice. The title carries it for a pointer. */
          alt=""
          aria-hidden="true"
          title={bank.nameEN}
          loading="lazy"
          draggable={false}
        />
      </span>
    );
  }

  /* The emoji path, unchanged from what every screen did inline before: the
     wallet's colour at low opacity behind its own glyph. */
  return (
    <span
      className={cx('wallet-icon', `wallet-icon--${size}`, className)}
      style={color ? { background: `${color}1f`, color } : undefined}
      aria-hidden="true"
    >
      {String(icon ?? '').trim() || '💳'}
    </span>
  );
}
