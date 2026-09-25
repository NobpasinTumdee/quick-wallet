import { bankLists } from 'thai-banks-logo';

/**
 * Wallet icons: emoji, or a Thai bank logo.
 *
 * ---------------------------------------------------------------------------
 * ONE COLUMN, TWO KINDS OF VALUE
 * ---------------------------------------------------------------------------
 * The Wallets sheet has always held a single short `icon` string, and it still
 * does. A value starting with `bank:` names a logo from `thai-banks-logo`;
 * anything else is the emoji it has always been. No column was added, no row
 * was migrated, and a wallet saved before this feature keeps rendering exactly
 * as it did.
 *
 * The prefix is what makes that possible: no emoji can collide with it, and a
 * value the client does not recognise falls back to being drawn as text, which
 * is the same thing older builds do with every icon.
 *
 * ---------------------------------------------------------------------------
 * WHY THE LOGOS COME FROM node_modules AND NOT THE PACKAGE'S URLs
 * ---------------------------------------------------------------------------
 * Every entry in `bankLists` carries an `icon` pointing at
 * `raw.githubusercontent.com`. Using those directly would mean every wallet
 * row on every screen fetches an image from GitHub: a third-party request per
 * user per page load, nothing to show offline or on a flaky connection, and a
 * silent dependency on one repository keeping its branch layout.
 *
 * The package ships the same twenty-one PNGs locally, so they are imported
 * through the bundler instead — hashed, cached, and served from our own
 * origin. `import.meta.glob` does that eagerly at build time, which is also
 * what makes a missing file a build error rather than a broken image.
 */

/* Resolved by Vite at build time: `{ '/node_modules/…/SCB.png': '/assets/SCB-a1b2.png' }`. */
const LOGO_URLS = import.meta.glob<string>('/node_modules/thai-banks-logo/icons/*.png', {
  eager: true,
  query: '?url',
  import: 'default',
});

/** `bank:SCB`. Chosen over `bank-` so it cannot be mistaken for a kebab id. */
export const BANK_PREFIX = 'bank:';

export interface WalletBank {
  /** `SCB`, `KBANK`, `PromptPay`… — the package's own symbol, as stored. */
  symbol: string;
  /** Thai short name, e.g. "ไทยพาณิชย์". */
  name: string;
  /** English name, for the Latin UI and for search. */
  nameEN: string;
  /** The bank's brand colour, used behind the logo tile. */
  color: string;
  /** A bundled, same-origin URL — never the package's GitHub link. */
  logo: string;
}

function logoFor(symbol: string): string {
  return LOGO_URLS[`/node_modules/thai-banks-logo/icons/${symbol}.png`] ?? '';
}

/**
 * Every bank the picker offers, in the package's own order.
 *
 * Entries whose PNG did not resolve are dropped rather than rendered as a
 * broken image: the list is built from two sources (a table and a folder), and
 * the day they disagree the picker should be one option shorter, not one
 * option wrong.
 */
export const WALLET_BANKS: readonly WalletBank[] = Object.values(bankLists)
  .map((bank) => ({
    symbol: bank.symbol,
    name: bank.name,
    nameEN: bank.nameEN,
    color: bank.color,
    logo: logoFor(bank.symbol),
  }))
  .filter((bank) => bank.logo !== '');

const BY_SYMBOL = new Map(WALLET_BANKS.map((bank) => [bank.symbol.toLowerCase(), bank]));

/** True for a stored value that names a bank logo. */
export function isBankIcon(icon: string | null | undefined): boolean {
  return typeof icon === 'string' && icon.startsWith(BANK_PREFIX);
}

/** What to store for a bank. */
export function bankIconValue(symbol: string): string {
  return `${BANK_PREFIX}${symbol}`;
}

/**
 * The bank a stored value names, or null.
 *
 * Case-insensitive, because the symbol travels through a spreadsheet cell that
 * a person can edit: `bank:scb` and `bank:SCB` must mean the same bank. An
 * unknown symbol returns null, which every caller renders as the plain
 * fallback rather than as a gap.
 */
export function bankForIcon(icon: string | null | undefined): WalletBank | null {
  if (!isBankIcon(icon)) return null;
  return BY_SYMBOL.get(String(icon).slice(BANK_PREFIX.length).trim().toLowerCase()) ?? null;
}

/**
 * What a *text-only* context shows for this icon.
 *
 * `<option>` elements render text and nothing else — no image, no element —
 * and several wallet pickers in this app are built from them. Without this
 * they would print the raw "bank:SCB" the moment someone chose a logo. The
 * bank's symbol is short, recognisable, and already what the value means.
 */
export function walletIconText(icon: string | null | undefined, fallback = '💳'): string {
  const bank = bankForIcon(icon);
  if (bank) return bank.symbol;
  const value = String(icon ?? '').trim();
  /* An unrecognised `bank:` value would otherwise leak the prefix into the
     label; the fallback is friendlier and just as uninformative. */
  return value && !isBankIcon(value) ? value : fallback;
}

/** The bank's name in the reader's language, for labels and tooltips. */
export function bankLabel(bank: WalletBank, locale: string): string {
  return locale.startsWith('th') ? bank.name : bank.nameEN;
}
