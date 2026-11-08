import type { WalletKind, WalletMode, WalletType } from '../types';

/**
 * Wallets grouped by their kind under each mode, for display only: the
 * wallets, their balances and the mode totals are unchanged.
 *
 * The order is the one the wallet form offers each mode's kinds in. The server
 * does not enforce which kinds go with which mode, so a wallet whose kind is
 * not on its mode's list (an old row, or one written by hand) still gets a
 * group under its real kind, after the listed ones, rather than being hidden
 * or labelled as something it is not.
 */

export const KIND_ORDER: Record<WalletMode, WalletKind[]> = {
  expense: ['cash', 'bank', 'ewallet', 'credit', 'other'],
  investment: ['brokerage', 'other'],
};

const ALL_KINDS: WalletKind[] = ['cash', 'bank', 'ewallet', 'credit', 'brokerage', 'other'];

interface Groupable {
  kind: WalletKind;
  type?: WalletType;
}

/**
 * The kind a wallet is grouped under. A CREDIT wallet is a credit card even
 * if an old row's kind says otherwise (the server keeps the two in sync on
 * write; this covers rows from before that); an unknown kind is "Other".
 */
export function walletGroupKind(wallet: Groupable): WalletKind {
  if (wallet.type === 'CREDIT') return 'credit';
  return ALL_KINDS.includes(wallet.kind) ? wallet.kind : 'other';
}

export interface WalletKindGroup<T> {
  kind: WalletKind;
  items: T[];
}

/** One mode's wallets in kind groups; empty groups are left out, and each group keeps the wallets' order. */
export function groupWalletsByKind<T extends Groupable>(wallets: T[], mode: WalletMode): WalletKindGroup<T>[] {
  const listed = KIND_ORDER[mode];
  const order = [...listed, ...ALL_KINDS.filter((kind) => !listed.includes(kind))];
  const byKind = new Map<WalletKind, T[]>();
  for (const wallet of wallets) {
    const kind = walletGroupKind(wallet);
    const items = byKind.get(kind);
    if (items) items.push(wallet);
    else byKind.set(kind, [wallet]);
  }
  return order.filter((kind) => byKind.has(kind)).map((kind) => ({ kind, items: byKind.get(kind) as T[] }));
}
