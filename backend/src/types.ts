/**
 * Shared domain types. The frontend keeps a mirrored copy in
 * `frontend/src/types.ts` — keep the two in sync when you change a shape.
 */

export type WalletMode = 'expense' | 'investment';
export type WalletKind = 'cash' | 'bank' | 'ewallet' | 'credit' | 'brokerage' | 'other';
export type TransactionType = 'income' | 'expense' | 'transfer';
export type InvestmentStatus = 'hold' | 'sold';
export type BudgetScope = 'category' | 'wallet' | 'global';
export type BudgetMode = 'amount' | 'percent';
export type ThemeName = 'light' | 'dark' | 'custom';

export interface User {
  id: string;
  username: string;
  displayName: string;
  salt: string;
  passwordHash: string;
  active: boolean;
  createdAt: string;
}

/** What we hand back to the client — never includes salt/hash. */
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

export interface Transaction {
  id: string;
  userId: string;
  walletId: string;
  /** Destination wallet — only used when `type === 'transfer'`. */
  toWalletId: string;
  type: TransactionType;
  amount: number;
  category: string;
  note: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  createdAt: string;
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
  /** Comma separated free-form tags, e.g. "growth,dividend". */
  tags: string;
  status: InvestmentStatus;
  sellPrice: number;
  sellDate: string;
  note: string;
  createdAt: string;
}

export interface Budget {
  id: string;
  userId: string;
  /** YYYY-MM */
  period: string;
  scope: BudgetScope;
  /** Category name when scope==='category', wallet id when scope==='wallet', '' when global. */
  targetId: string;
  targetLabel: string;
  mode: BudgetMode;
  /** Currency amount when mode==='amount', 0-100 when mode==='percent'. */
  value: number;
  /** Optional explicit base for percent budgets; 0 means "derive it". */
  baseIncome: number;
  note: string;
  createdAt: string;
}

export interface Settings {
  userId: string;
  theme: ThemeName;
  accent: string;
  /** JSON blob of CSS custom properties for the `custom` theme. */
  customVars: Record<string, string>;
  /** Bookkeeping currency: what every stored amount is actually denominated in. */
  currency: string;
  /** Optional presentation currency. Empty (or equal to `currency`) = no conversion. */
  displayCurrency: string;
  /** Multiplier from `currency` to `displayCurrency`. */
  fxRate: number;
  fxRateUpdatedAt: string;
  locale: string;
  monthlyIncome: number;
  categories: string[];
  updatedAt: string;
}

/* ---------- Derived / computed shapes returned by the API ---------- */

export interface WalletBalance extends Wallet {
  balance: number;
  /** Cost basis of open positions, for investment wallets. */
  investedCost: number;
  income: number;
  expense: number;
  transactionCount: number;
}

export interface BudgetProgress extends Budget {
  /** Resolved currency limit (percent budgets are converted using `base`). */
  limit: number;
  base: number;
  spent: number;
  remaining: number;
  /** 0-100+, clamped only for display on the client. */
  percentUsed: number;
  status: 'ok' | 'warning' | 'over';
}

export interface DashboardSummary {
  period: string;
  currency: string;
  netWorth: number;
  liquidBalance: number;
  investedCost: number;
  monthIncome: number;
  monthExpense: number;
  monthNet: number;
  savingsRate: number;
  wallets: WalletBalance[];
  budgets: BudgetProgress[];
  recentTransactions: Transaction[];
  openPositions: Investment[];
  categoryBreakdown: { category: string; amount: number; share: number }[];
  /** Last 6 months of income/expense, oldest first. */
  trend: { period: string; income: number; expense: number; net: number }[];
}
