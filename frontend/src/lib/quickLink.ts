/**
 * Deep links into the quick-entry form, for home-screen widgets and the PWA
 * shortcuts: `?quick=expense|income|transfer`, optionally `&wallet=<id>` and,
 * for a transfer, `&to=<id>`.
 *
 * Pure and free of imports so the Node tests can load it directly. The shell
 * reads the link once after sign-in, opens the form, and removes these
 * parameters from the address bar, so a refresh never opens it again.
 */

export type QuickLinkType = 'expense' | 'income' | 'transfer';

export interface QuickLink {
  type: QuickLinkType;
  walletId?: string;
  toWalletId?: string;
}

const TYPES: readonly QuickLinkType[] = ['expense', 'income', 'transfer'];
const PARAMS = ['quick', 'wallet', 'to'] as const;
/** Wallet ids are uuids; anything longer or stranger is ignored, not trusted. */
const ID = /^[A-Za-z0-9-]{1,64}$/;

/** Reads a quick link from a query string (`location.search`), or null. */
export function parseQuickLink(search: string): QuickLink | null {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  const type = (params.get('quick') ?? '').trim().toLowerCase();
  if (!(TYPES as readonly string[]).includes(type)) return null;

  const link: QuickLink = { type: type as QuickLinkType };
  const wallet = (params.get('wallet') ?? '').trim();
  if (ID.test(wallet)) link.walletId = wallet;
  if (type === 'transfer') {
    const to = (params.get('to') ?? '').trim();
    if (ID.test(to) && to !== link.walletId) link.toWalletId = to;
  }
  return link;
}

/** True when the query string carries any quick-link parameter at all. */
export function hasQuickLinkParams(search: string): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return PARAMS.some((key) => params.has(key));
}

/**
 * The same address without the quick-link parameters. Every other parameter
 * and the `#route` hash are kept as they were.
 */
export function stripQuickLink(href: string): string {
  const url = new URL(href);
  PARAMS.forEach((key) => url.searchParams.delete(key));
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ''}${url.hash}`;
}

/**
 * Keeps only the wallets that exist and fit the type: income and expense need
 * a spending wallet, a transfer can use any. A link naming a wallet that was
 * archived or deleted since the widget was set up opens the form with the
 * usual default instead of an empty picker.
 */
export function resolveQuickLink(
  link: QuickLink,
  wallets: readonly { id: string; mode: string; archived: boolean }[],
): QuickLink {
  const live = wallets.filter((w) => !w.archived);
  const fits = (id: string | undefined) =>
    id !== undefined &&
    live.some((w) => w.id === id && (link.type === 'transfer' || w.mode === 'expense'));

  const out: QuickLink = { type: link.type };
  if (fits(link.walletId)) out.walletId = link.walletId;
  if (link.type === 'transfer' && fits(link.toWalletId) && link.toWalletId !== out.walletId) {
    out.toWalletId = link.toWalletId;
  }
  return out;
}
