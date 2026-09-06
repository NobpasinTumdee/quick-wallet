/** Mirrors `backend/src/types.ts` — keep the two in sync. */

export type WalletMode = 'expense' | 'investment';
export type WalletKind = 'cash' | 'bank' | 'ewallet' | 'credit' | 'brokerage' | 'other';
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
  | 'amethyst';

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

export interface Settings {
  userId: string;
  theme: ThemeName;
  accent: string;
  customVars: Record<string, string>;
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
}

export interface DashboardSummary {
  period: string;
  currency: string;
  netWorth: number;
  liquidBalance: number;
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
