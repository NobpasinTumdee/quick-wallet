/**
 * The card face: a glass panel tinted with the wallet's own colour, carrying
 * what is owed and how much of the limit that is.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE ARE NO DIGITS IN THE MASKED NUMBER
 * ---------------------------------------------------------------------------
 * A real card shows "•••• 4821", and the obvious move is to derive four digits
 * from the wallet id so every card gets a stable-looking tail. It is also the
 * wrong move: those digits would look exactly like a real card number in an app
 * whose entire job is to be trusted about money, and the first time someone
 * compared them to the plastic in their hand they would be reading a number
 * this app invented. The dots are texture; the slot that would carry a real
 * number instead carries the billing cycle, which is information the user
 * actually needs and cannot get anywhere else on the screen.
 */

import { CardState, utilizationTone } from '../lib/creditMath';
import { cx, formatPercent, ordinal } from '../lib/format';
import { useMoneyFormatter } from '../state/SettingsContext';
import { Badge } from './ui';

export function VirtualCard({
  card,
  onClick,
}: {
  card: CardState;
  onClick?: () => void;
}) {
  const money = useMoneyFormatter();
  const { wallet } = card;
  const tone = utilizationTone(card.utilization);

  /* The wallet's colour drives the whole face through two custom properties,
     so a user who recolours a card in the wallet form recolours this without
     the stylesheet knowing any card names. */
  const style = {
    '--card-tint': wallet.color,
    // Clamped so an over-limit card fills the bar rather than overflowing it.
    '--card-fill': `${Math.min(100, Math.max(0, card.utilization))}%`,
  } as React.CSSProperties;

  const Element = onClick ? 'button' : 'div';

  return (
    <Element
      type={onClick ? 'button' : undefined}
      className={cx('vcard', `vcard--${tone}`, onClick && 'vcard--interactive')}
      style={style}
      onClick={onClick}
    >
      <div className="vcard-sheen" aria-hidden="true" />

      <header className="vcard-head">
        <span className="vcard-icon" aria-hidden="true">
          {wallet.icon || '💳'}
        </span>
        {card.overdue ? (
          <Badge tone="negative">Overdue</Badge>
        ) : card.dueSoon ? (
          <Badge tone="warning">Due soon</Badge>
        ) : wallet.cashbackRate > 0 ? (
          <Badge tone="accent">{formatPercent(wallet.cashbackRate, 1)} back</Badge>
        ) : null}
      </header>

      <div className="vcard-number" aria-hidden="true">
        <span>••••</span>
        <span>••••</span>
        <span>••••</span>
        <span>••••</span>
      </div>

      <div className="vcard-owed">
        <span className="vcard-owed-label">Owed</span>
        {/* Always positive: computeCardState flipped the ledger's sign once so
            nothing downstream has to think about it. */}
        <span className="vcard-owed-value">{money(Math.max(0, card.currentBalance))}</span>
      </div>

      {card.hasLimit && (
        <div className="vcard-meter">
          <div className="vcard-meter-track">
            <div className="vcard-meter-fill" />
          </div>
          <div className="vcard-meter-legend">
            <span>{formatPercent(card.utilization, 0)} used</span>
            <span>{money(wallet.creditLimit, { compact: true })} limit</span>
          </div>
        </div>
      )}

      <footer className="vcard-foot">
        <span className="vcard-name truncate">{wallet.name}</span>
        {wallet.statementDate > 0 && wallet.dueDate > 0 ? (
          <span className="vcard-cycle">
            <span className="vcard-cycle-label">closes / due</span>
            <span className="vcard-cycle-value">
              {ordinal(wallet.statementDate)} / {ordinal(wallet.dueDate)}
            </span>
          </span>
        ) : (
          <span className="vcard-cycle">
            <span className="vcard-cycle-label">cycle</span>
            <span className="vcard-cycle-value">not set</span>
          </span>
        )}
      </footer>
    </Element>
  );
}
