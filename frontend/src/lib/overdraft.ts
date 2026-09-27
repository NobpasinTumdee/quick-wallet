import { Transaction, TransactionType, WalletBalance } from '../types';

/**
 * Would this entry take a wallet below what it holds?
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT `amount > wallet.balance`
 * ---------------------------------------------------------------------------
 * Three cases turn the obvious one-liner into a warning people learn to click
 * through, which is worse than no warning at all:
 *
 *   A credit card is *meant* to go negative. Its balance is what you owe, so
 *   every single purchase on it "exceeds the balance". Warning each time would
 *   train the user to dismiss the dialog, and the one time it mattered — going
 *   past the credit limit — it would be dismissed too. So a card is checked
 *   against its limit instead, and only when a limit is set.
 *
 *   Editing an existing entry double-counts. The wallet's balance already has
 *   the old amount taken out of it, so comparing the new amount against it
 *   asks "can I afford this twice?". A ฿100 wallet holding a ฿50 expense that
 *   is being corrected to ฿60 has ฿150 available to the edit, not ฿100.
 *
 *   A transfer drains its source exactly like an expense. Checking only
 *   `type === 'expense'` would let the most common way to empty a wallet
 *   through without a word.
 *
 * Income never triggers this, and neither does the *destination* of a
 * transfer: money arriving cannot overdraw anything.
 */

export type OverdraftReason =
  /** A cash, bank or e-wallet balance would go below zero. */
  | 'cash'
  /** A credit card would go past its stated limit. */
  | 'credit-limit';

export interface OverdraftCheck {
  /** True when the user should be asked to confirm. */
  warn: boolean;
  reason: OverdraftReason | null;
  /** What the wallet would hold afterwards. Negative for an overdrawn cash wallet. */
  balanceAfter: number;
  /** How far past the limit — zero when there is no breach. */
  shortfall: number;
}

const NONE: OverdraftCheck = { warn: false, reason: null, balanceAfter: 0, shortfall: 0 };

export interface OverdraftInput {
  wallet: WalletBalance | null | undefined;
  type: TransactionType;
  amount: number;
  /**
   * The row being edited, when this is an edit.
   *
   * Its amount is added back before the check, because the wallet balance on
   * screen already has it deducted — but only when it came out of *this*
   * wallet in a way that reduced it. Moving an expense from one wallet to
   * another restores nothing to the new one.
   */
  previous?: Transaction | null;
}

function round2(value: number): number {
  return Math.round(((Number(value) || 0) + Number.EPSILON) * 100) / 100;
}

/** Did this stored row take money *out* of the given wallet? */
function reduced(previous: Transaction | null | undefined, walletId: string): number {
  if (!previous || previous.walletId !== walletId) return 0;
  if (previous.type === 'expense' || previous.type === 'transfer') return Number(previous.amount) || 0;
  return 0;
}

export function checkOverdraft({ wallet, type, amount, previous }: OverdraftInput): OverdraftCheck {
  /* Income adds; a transfer's destination receives. Neither can overdraw. */
  if (!wallet || type === 'income') return NONE;
  if (!(amount > 0)) return NONE;

  /* What the wallet really has available to this entry: what it shows, plus
     whatever this same entry had already taken out of it. */
  const available = round2((Number(wallet.balance) || 0) + reduced(previous, wallet.id));
  const balanceAfter = round2(available - amount);

  if (wallet.type === 'CREDIT') {
    const limit = Number(wallet.creditLimit) || 0;
    /* No limit recorded means no line to cross — the app does not know what
       the card allows, and inventing one would be a warning about nothing. */
    if (limit <= 0) return { ...NONE, balanceAfter };

    /* A card's balance is what is owed, carried negative. Headroom is
       therefore the limit plus that balance: a ฿20,000 card owing ฿2,000
       (balance −2,000) has ฿18,000 left. */
    const owedAfter = -balanceAfter;
    if (owedAfter > limit) {
      return { warn: true, reason: 'credit-limit', balanceAfter, shortfall: round2(owedAfter - limit) };
    }
    return { ...NONE, balanceAfter };
  }

  if (balanceAfter < 0) {
    return { warn: true, reason: 'cash', balanceAfter, shortfall: round2(-balanceAfter) };
  }

  return { ...NONE, balanceAfter };
}
