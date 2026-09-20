/** Mirrors `backend/src/types.ts` — keep the two in sync. */

import type { MobileNavConfig } from './lib/mobileNav';

export type { MobileNavConfig };

export type WalletMode = 'expense' | 'investment';
export type WalletKind = 'cash' | 'bank' | 'ewallet' | 'credit' | 'brokerage' | 'other';
/**
 * What the balance maths has to know about a wallet, as opposed to `kind`,
 * which is the label the user picked for it.
 *
 * Uppercase because that is how it is stored, and the two stay in sync
 * server-side: `kind: 'credit'` implies `type: 'CREDIT'` and vice versa. A row
 * written before the column existed has no type at all, and the server reads
 * that as CASH — see `walletType_` in Code.gs.
 */
export type WalletType = 'CASH' | 'CREDIT';
export type TransactionType = 'income' | 'expense' | 'transfer';
export type InvestmentStatus = 'hold' | 'sold';
export type SubscriptionFrequency = 'weekly' | 'monthly' | 'yearly';
export type BudgetScope = 'category' | 'wallet' | 'global';
export type BudgetMode = 'amount' | 'percent';
export type ThemeName =
  | 'light'
  | 'dark'
  | 'custom'
  | 'ocean'
  | 'forest'
  | 'sunset'
  | 'cyberpunk'
  | 'rosegold'
  | 'midnight'
  | 'dracula'
  | 'nord'
  | 'solarized'
  | 'amethyst'
  /* Minimal & cute, five light and five dark. `moonlight` is the one the
     brief called Midnight: that id was already taken, and two cards reading
     "Midnight" in one picker is worse than a different word. */
  | 'matcha'
  | 'oatmilk'
  | 'sakura'
  | 'lavender'
  | 'daylight'
  | 'cocoa'
  | 'moonlight'
  | 'pine'
  | 'slate'
  | 'twilight';

export interface PublicUser {
  id: string;
  username: string;
  displayName: string;
  createdAt: string;
}

export interface Wallet {
  id: string;
  userId: string;
  name: string;
  mode: WalletMode;
  kind: WalletKind;
  currency: string;
  openingBalance: number;
  color: string;
  icon: string;
  archived: boolean;
  note: string;
  createdAt: string;

  /* ---- Credit cards ----
     Always present on anything the API returns; the server normalises a legacy
     row's empty cells to 'CASH' and 0 before it leaves. They are only
     meaningful when `type === 'CREDIT'`, and switching a card back to cash
     clears them rather than leaving a stale limit behind. */
  type: WalletType;
  /** 0 means no limit set — utilisation is then unknowable, not 0%. */
  creditLimit: number;
  /** Day of month the statement closes, 1-31. 0 = no billing cycle yet. */
  statementDate: number;
  /** Day of month payment is due, 1-31. 0 = unset. */
  dueDate: number;
  /** Percent: 1.5 means 1.5% back. Informational only — never auto-posted. */
  cashbackRate: number;
}

export interface WalletBalance extends Wallet {
  balance: number;
  investedCost: number;
  income: number;
  expense: number;
  transactionCount: number;
}

export interface Transaction {
  id: string;
  userId: string;
  walletId: string;
  toWalletId: string;
  type: TransactionType;
  amount: number;
  category: string;
  note: string;
  date: string;
  createdAt: string;

  /* ---- 0% installment plans ----
     Empty on every ordinary transaction, which is all of them until someone
     creates a plan. A plan is n of these rows sharing a group id, one per
     month, each an otherwise completely normal expense — which is why nothing
     that aggregates transactions needed to learn about installments. */
  installmentGroupId: string;
  /** "3/10". Empty when the row is not part of a plan. */
  installmentIndex: string;
}

/** What `transactions.installment` answers with — the whole plan at once. */
export interface InstallmentPlanResult {
  /** Empty when `months` was 1: a one-chunk plan is just a transaction. */
  groupId: string;
  months: number;
  /** The per-month figure. The first chunk carries any rounding remainder. */
  monthly: number;
  total: number;
  transactions: Transaction[];
}

/* ------------------------------------------------------------------ */
/* Bill splits                                                         */
/* ------------------------------------------------------------------ */

export type BillSplitStatus = 'open' | 'settled';

/** One person's share of a bill. Stored inside the bill's `splitsJSON` cell. */
export interface BillSplitShare {
  personName: string;
  amount: number;
  isPaid: boolean;
  /** The income Transaction that settled this share. Empty while unpaid. */
  repaymentTxId: string;
}

/**
 * A bill one person paid and several people owe a share of.
 *
 * The figures below `expenseTxId` are computed server-side by
 * `decorateBillSplit_` so that every screen reads the same arithmetic rather
 * than each re-deriving it — and so `ownShare` in particular can never drift
 * from `totalAmount - owedTotal`.
 */
export interface BillSplit {
  id: string;
  userId: string;
  title: string;
  totalAmount: number;
  /** The wallet that paid, and that every repayment returns to. */
  walletId: string;
  note: string;
  splits: BillSplitShare[];
  status: BillSplitStatus;
  createdAt: string;
  /** The expense Transaction written when the bill was created. */
  expenseTxId: string;

  /* computed server-side */
  /** Everyone else's shares added up. Never more than `totalAmount`. */
  owedTotal: number;
  recovered: number;
  outstanding: number;
  /** `totalAmount - owedTotal` — what the payer is genuinely out of pocket. */
  ownShare: number;
  /** Percent of `owedTotal` that has come back. 100 when nothing is owed. */
  recoveredPercent: number;
}

/** What `billSplits.create` and `billSplits.markPaid` answer with. */
export interface BillSplitResult {
  ok: boolean;
  billSplit: BillSplit;
  /** Null when `markPaid` was a no-op because the share was already settled. */
  transaction: Transaction | null;
  alreadyPaid?: boolean;
}

export interface BillSplitUnpaidResult {
  ok: boolean;
  billSplit: BillSplit;
  /** The income row that was removed. Empty when there was nothing to undo. */
  removedTransactionId: string;
}

export interface Subscription {
  id: string;
  userId: string;
  name: string;
  amount: number;
  walletId: string;
  category: string;
  frequency: SubscriptionFrequency;
  /** `YYYY-MM-DD`. Due once today reaches it. */
  nextDueDate: string;
  note: string;
  createdAt: string;
}

/** What subscriptions.pay returns — both halves, so the client can reconcile. */
export interface SubscriptionPayment {
  ok: boolean;
  subscription: Subscription;
  transaction: Transaction;
}

export interface Investment {
  id: string;
  userId: string;
  walletId: string;
  symbol: string;
  quantity: number;
  buyPrice: number;
  fees: number;
  buyDate: string;
  tags: string;
  status: InvestmentStatus;
  sellPrice: number;
  sellDate: string;
  note: string;
  createdAt: string;
  /* computed server-side */
  /**
   * `<walletId>::<SYMBOL>` — the identity of the *holding* this lot belongs to.
   *
   * Several rows share one key when the same ticker is bought repeatedly, which
   * is what makes dollar-cost averaging work: the sheet keeps every purchase,
   * and `lib/positions.ts` groups on this to produce the blended average cost.
   * Scoped to the wallet because the same symbol in two brokerages is two
   * positions. Mirrors `positionKey_` in Code.gs.
   */
  positionKey: string;
  costBasis: number;
  avgCost: number;
  realizedPnl: number;
  realizedPnlPercent: number;
  tagList: string[];
}

/**
 * A symbol being tracked but not owned.
 *
 * Deliberately its own table rather than a flag on `Investment`: a watchlist
 * row has no quantity, no cost basis and no wallet, so folding the two together
 * would mean every P&L figure, DCA roll-up and wallet balance had to filter it
 * back out again. Mirrors the `Watchlist` sheet in Code.gs.
 */
export interface WatchlistItem {
  id: string;
  userId: string;
  symbol: string;
  /** Free text, never empty — the server defaults it to "Watching". */
  category: string;
  /** 0 means no target set. */
  targetPrice: number;
  note: string;
  createdAt: string;
}

/**
 * A sinking fund — a label on money you already have.
 *
 * Funding one writes no Transaction and moves no balance; it only records how
 * much of your cash is spoken for. Mirrors the `Goals` sheet in Code.gs.
 */
/**
 * `active` until the thing is actually bought.
 *
 * Only `goals.purchase` writes `purchased`, and only alongside the expense that
 * pays for it — a status set on its own would claim money left a wallet when
 * none did.
 */
export type GoalStatus = 'active' | 'purchased';

export interface Goal {
  id: string;
  userId: string;
  title: string;
  targetAmount: number;
  /** Only ever moved through the `goals.fund` action — never patched directly. */
  savedAmount: number;
  /** `YYYY-MM-DD`, or empty for no deadline. */
  deadline: string;
  color: string;
  note: string;
  createdAt: string;
  /** Normalised server-side: a blank cell on an older row reads as `active`. */
  status: GoalStatus;
  /** The expense written when the goal was bought, or empty. */
  purchaseTxId: string;
  /** `YYYY-MM-DD` the purchase was booked on, or empty. */
  purchasedAt: string;
  /* computed server-side */
  remaining: number;
  /** Uncapped: over-funding is real, and the bar caps it, not the number. */
  percentComplete: number;
  complete: boolean;
  /** `status === 'purchased'`, decided once on the server. */
  purchased: boolean;
}

/* ------------------------------------------------------------------ */
/* The financial inbox                                                  */
/* ------------------------------------------------------------------ */

/**
 * Which way a resolved item would move money, if it moves any.
 *
 * `note` is the default and the majority: a reminder with no figure on it.
 * The other two decide whether a converted Transaction is an expense or
 * income, and nothing else.
 */
export type InboxType = 'to-pay' | 'to-receive' | 'note';

export type InboxStatus = 'pending' | 'resolved';

/**
 * One line in the inbox. Deliberately not a Transaction, a Debt or a
 * Subscription — see the `Inbox` schema note in Code.gs.
 */
export interface InboxItem {
  id: string;
  userId: string;
  text: string;
  /** 0 when the item is just a reminder. */
  amount: number;
  /** `YYYY-MM-DD`, or empty. */
  dueDate: string;
  type: InboxType;
  /** Normalised server-side: a blank cell reads as `pending`. */
  status: InboxStatus;
  createdAt: string;
  /** ISO timestamp, or empty while pending. */
  resolvedAt: string;
  /** The Transaction this became, when the user chose to record one. */
  transactionId: string;
  /** `amount > 0 && type !== 'note'` — decided once, on the server. */
  convertible: boolean;
}

/** What `goals.purchase` answers with: both halves of the one write. */
export interface GoalPurchaseResult {
  ok: boolean;
  goal: Goal;
  transaction: Transaction;
  /** The part of the price the envelope had not saved up, paid anyway. */
  shortfall: number;
}

/**
 * Real borrowed money — a mortgage, a car loan, money owed to a person.
 *
 * The counterpart to `Goal`, and deliberately not the same thing. Funding a
 * goal moves a number inside an envelope and no wallet changes. Paying a debt
 * writes an expense against a chosen wallet *and* lowers the balance, in one
 * server call, so cash and indebtedness always move together.
 */
export interface Debt {
  id: string;
  userId: string;
  title: string;
  /** What was originally borrowed. The denominator of every progress figure. */
  principalAmount: number;
  /** Still owed. Moved by `debts.pay`, or corrected by an explicit edit. */
  currentBalance: number;
  /** Annual percentage rate as a percent: 6.5 means 6.5%. */
  interestRateApr: number;
  minimumPayment: number;
  /** Day of month the payment falls due, 1-31. 0 = unset. */
  dueDate: number;
  note: string;
  createdAt: string;

  /* computed server-side */
  /** Principal reduction, not cash handed over — see `decorateDebt_`. */
  paidAmount: number;
  /** Capped at 100: owing less than nothing is a correction, not progress. */
  percentPaid: number;
  /**
   * One month of simple interest on today's balance.
   *
   * An estimate the user reads. Nothing in this app ever adds it to the
   * balance — no scheduled job exists to accrue it, and a figure that grew
   * only when someone happened to open the app would be worse than none.
   */
  projectedMonthlyInterest: number;
  settled: boolean;
}

/** What `debts.pay` answers with — both halves, so the client can reconcile. */
export interface DebtPaymentResult {
  ok: boolean;
  debt: Debt;
  transaction: Transaction;
  /** The part of the payment the balance could not absorb. */
  overpaid: number;
}

export interface Budget {
  id: string;
  userId: string;
  period: string;
  scope: BudgetScope;
  targetId: string;
  targetLabel: string;
  mode: BudgetMode;
  value: number;
  baseIncome: number;
  note: string;
  createdAt: string;
}

export interface BudgetProgress extends Budget {
  limit: number;
  base: number;
  spent: number;
  remaining: number;
  percentUsed: number;
  status: 'ok' | 'warning' | 'over';
}

export interface BudgetResponse {
  period: string;
  budgets: BudgetProgress[];
  totals: {
    limit: number;
    spent: number;
    percentAllocated: number;
    percentUnallocated: number;
  };
}

/**
 * One saved palette from the user's theme library.
 *
 * Stored server-side as a JSON array in the Settings row rather than in a sheet
 * of its own — see the `customThemes` column note in Code.gs.
 */
export interface CustomTheme {
  id: string;
  name: string;
  /** CSS custom properties, e.g. `{ '--bg': '#071413' }`. */
  colors: Record<string, string>;
  /**
   * A `FONTS` id from `lib/fonts.ts` — 'sarabun', not a CSS font stack.
   *
   * The stack is resolved client-side from this id, so the stored value is a
   * name from a closed list rather than arbitrary CSS. Empty means the system
   * face.
   */
  fontFamily: string;
  createdAt: string;
  updatedAt: string;
}

export interface Settings {
  userId: string;
  theme: ThemeName;
  accent: string;
  /**
   * The colours currently painted for `theme: 'custom'`.
   *
   * When a library theme is active this is a materialised copy of its `colors`.
   * The duplication is deliberate: the anti-FOUC boot script in index.html reads
   * only `theme` + `customVars`, so a saved theme paints before first paint
   * without that script needing to understand the library.
   */
  customVars: Record<string, string>;
  /** The user's saved palettes. */
  customThemes: CustomTheme[];
  /** Which library entry `customVars` was materialised from. Empty when none. */
  activeCustomThemeId: string;
  /**
   * The typeface currently painted, as a `FONTS` id. Materialised from the
   * active theme exactly like `customVars`, and empty for the system face.
   */
  fontFamily: string;
  /** Bookkeeping currency: what every stored amount is denominated in. */
  currency: string;
  /** Optional presentation currency. Empty or equal to `currency` = no conversion. */
  displayCurrency: string;
  /** Multiplier from `currency` to `displayCurrency`. */
  fxRate: number;
  fxRateUpdatedAt: string;
  locale: string;
  monthlyIncome: number;
  categories: string[];
  updatedAt: string;

  /**
   * Which screens the phone's bottom bar and gesture arc carry.
   *
   * Never read directly — `resolveMobileNav` in `lib/mobileNav` repairs it
   * first. The stored value outlives the code that wrote it, so it can name
   * routes that no longer exist, and a dead button in a tab bar is a silent
   * failure rather than a loud one.
   */
  mobileNavConfig: MobileNavConfig;

  /**
   * Days of the month a salary lands, e.g. `[1, 16]`.
   *
   * An array because being paid twice a month is ordinary. Sorted and deduped
   * by `resolvePaydays`; a day past the end of a short month simply draws no
   * marker that month.
   */
  paydays: number[];
}

/** The end-of-period snapshot carried on every dashboard payload. */
export interface HistoricalBalance {
  /** `YYYY-MM-DD`, or empty for an all-time figure. */
  asOf: string;
  netWorth: number;
  liquidBalance: number;
  cashBalance: number;
  /** Positive = owed. */
  creditDebt: number;
  investedCost: number;
  investmentCash: number;
}

export interface DashboardSummary {
  period: string;
  currency: string;
  netWorth: number;
  /** Every spending wallet, credit cards included — unchanged meaning. */
  liquidBalance: number;
  /** Spending wallets of type CASH only. */
  cashBalance: number;
  /** Positive = owed, summed across every credit wallet. */
  creditDebt: number;
  /** Summed `creditLimit` across every credit wallet. 0 when none is set. */
  creditLimit: number;
  /** `cashBalance - creditDebt`: spendable today with every card cleared. */
  safeToSpend: number;
  /** `creditDebt / creditLimit` as a percent. 0 when no limit is set. */
  creditUtilization: number;
  investedCost: number;
  investmentCash: number;
  monthIncome: number;
  monthExpense: number;
  monthNet: number;
  savingsRate: number;
  walletCount: number;
  positionCount: number;
  wallets: WalletBalance[];
  budgets: BudgetProgress[];
  recentTransactions: Transaction[];
  openPositions: Investment[];
  categoryBreakdown: { category: string; amount: number; share: number }[];
  trend: { period: string; income: number; expense: number; net: number }[];

  /**
   * Balances as they stood on the last day of `period`.
   *
   * Every other figure on this payload is all-time — `computeWalletBalances_`
   * applies every transaction whatever month is being browsed — so stepping
   * back to March still showed today's money. This is the same set of
   * quantities as at the end of the month being looked at.
   *
   * Optional because a frontend can be deployed before the matching Code.gs;
   * the dashboard falls back to its previous behaviour when it is absent.
   */
  historical?: HistoricalBalance;
  /** `YYYY-MM-DD` the snapshot is computed to: the last day of `period`. */
  asOfDate?: string;
  /** True when `asOfDate` is genuinely in the past. Drives the card's default. */
  isHistorical?: boolean;
}

export interface DbHealth {
  ok: boolean;
  ready: boolean;
  dbPath: string;
  dirty: boolean;
  lastFlushAt: string | null;
  lastError: string | null;
  fileLocked: boolean;
  rowCounts: Record<string, number>;
  hint?: string;
}

/** A live quote from the stock API (or a simulated stand-in). */
export interface Quote {
  symbol: string;
  price: number;
  previousClose: number;
  changePercent: number;
  currency: string;
  fetchedAt: number;
  source: 'live' | 'simulated';
}
