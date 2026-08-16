import { db } from '../db/excelStore';
import {
  Budget,
  BudgetProgress,
  Investment,
  Settings,
  Transaction,
  Wallet,
  WalletBalance,
} from '../types';
import { money } from '../utils/validate';

export function userTransactions(userId: string): Transaction[] {
  return db.where<Transaction>('Transactions', (t) => t.userId === userId);
}

export function userWallets(userId: string, includeArchived = true): Wallet[] {
  return db
    .where<Wallet>('Wallets', (w) => w.userId === userId && (includeArchived || !w.archived))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function userInvestments(userId: string): Investment[] {
  return db.where<Investment>('Investments', (i) => i.userId === userId);
}

export function inPeriod(dateKey: string, period: string): boolean {
  return typeof dateKey === 'string' && dateKey.slice(0, 7) === period;
}

export interface DecoratedInvestment extends Investment {
  costBasis: number;
  avgCost: number;
  realizedPnl: number;
  realizedPnlPercent: number;
  tagList: string[];
}

/**
 * Adds the figures the client shouldn't have to recompute. Unrealised P&L is
 * deliberately absent — it needs a live price, which the client fetches.
 */
export function decorateInvestment(inv: Investment): DecoratedInvestment {
  const costBasis = money(inv.quantity * inv.buyPrice + (inv.fees || 0));
  const realizedPnl = inv.status === 'sold' ? money(inv.quantity * inv.sellPrice - costBasis) : 0;

  return {
    ...inv,
    costBasis,
    avgCost: inv.quantity > 0 ? money(costBasis / inv.quantity) : 0,
    realizedPnl,
    realizedPnlPercent: inv.status === 'sold' && costBasis > 0 ? money((realizedPnl / costBasis) * 100) : 0,
    tagList: inv.tags ? inv.tags.split(',').map((t) => t.trim()).filter(Boolean) : [],
  };
}

/**
 * Wallet balance = opening balance + income - expense + transfers in - transfers out.
 * A transfer is stored as ONE row (source wallet + toWalletId), so both legs are
 * derived here rather than duplicated in the sheet.
 */
export function computeWalletBalances(
  userId: string,
  period?: string,
): WalletBalance[] {
  const wallets = userWallets(userId);
  const transactions = userTransactions(userId);
  const investments = userInvestments(userId);

  const byId = new Map<string, WalletBalance>();
  for (const wallet of wallets) {
    byId.set(wallet.id, {
      ...wallet,
      balance: wallet.openingBalance || 0,
      investedCost: 0,
      income: 0,
      expense: 0,
      transactionCount: 0,
    });
  }

  for (const tx of transactions) {
    const source = byId.get(tx.walletId);
    const target = byId.get(tx.toWalletId);
    const amount = Number(tx.amount) || 0;
    const counted = !period || inPeriod(tx.date, period);

    if (tx.type === 'income') {
      if (!source) continue;
      source.balance += amount;
      source.transactionCount += 1;
      if (counted) source.income += amount;
    } else if (tx.type === 'expense') {
      if (!source) continue;
      source.balance -= amount;
      source.transactionCount += 1;
      if (counted) source.expense += amount;
    } else if (tx.type === 'transfer') {
      // Transfers move money; they are neither income nor expense.
      if (source) {
        source.balance -= amount;
        source.transactionCount += 1;
      }
      if (target) {
        target.balance += amount;
        target.transactionCount += 1;
      }
    }
  }

  // Buying a position converts wallet cash into holdings, so the wallet's cash
  // balance drops by the cost basis and `investedCost` picks it up. Selling
  // returns the proceeds, i.e. cash moves by the realised P&L.
  for (const inv of investments) {
    const wallet = byId.get(inv.walletId);
    if (!wallet) continue;
    const quantity = Number(inv.quantity) || 0;
    const cost = quantity * (Number(inv.buyPrice) || 0) + (Number(inv.fees) || 0);

    if (inv.status === 'hold') {
      wallet.investedCost += cost;
      wallet.balance -= cost;
    } else {
      wallet.balance += quantity * (Number(inv.sellPrice) || 0) - cost;
    }
  }

  return [...byId.values()].map((w) => ({
    ...w,
    balance: money(w.balance),
    investedCost: money(w.investedCost),
    income: money(w.income),
    expense: money(w.expense),
  }));
}

export function getSettings(userId: string): Settings | undefined {
  return db.findById<Settings>('Settings', userId);
}

/**
 * Percent budgets need a base to be a percentage *of*. Preference order:
 *   1. the budget's own baseIncome (explicit override)
 *   2. the user's configured monthlyIncome in Settings
 *   3. actual income recorded in that period
 */
function resolveBase(budget: Budget, settings: Settings | undefined, actualIncome: number): number {
  if (budget.baseIncome > 0) return budget.baseIncome;
  if (settings && settings.monthlyIncome > 0) return settings.monthlyIncome;
  return actualIncome;
}

export function computeBudgetProgress(userId: string, period: string): BudgetProgress[] {
  const budgets = db.where<Budget>('Budgets', (b) => b.userId === userId && b.period === period);
  const transactions = userTransactions(userId).filter((t) => inPeriod(t.date, period));
  const settings = getSettings(userId);

  const actualIncome = transactions
    .filter((t) => t.type === 'income')
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  const totalExpense = transactions
    .filter((t) => t.type === 'expense')
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  return budgets
    .map((budget) => {
      const base = resolveBase(budget, settings, actualIncome);
      const limit = budget.mode === 'percent' ? money((base * budget.value) / 100) : money(budget.value);

      let spent = 0;
      if (budget.scope === 'category') {
        spent = transactions
          .filter(
            (t) =>
              t.type === 'expense' &&
              t.category.trim().toLowerCase() === budget.targetId.trim().toLowerCase(),
          )
          .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      } else if (budget.scope === 'wallet') {
        spent = transactions
          .filter((t) => t.type === 'expense' && t.walletId === budget.targetId)
          .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);
      } else {
        spent = totalExpense;
      }

      spent = money(spent);
      const percentUsed = limit > 0 ? money((spent / limit) * 100) : spent > 0 ? 100 : 0;

      return {
        ...budget,
        base: money(base),
        limit,
        spent,
        remaining: money(limit - spent),
        percentUsed,
        status: percentUsed >= 100 ? 'over' : percentUsed >= 80 ? 'warning' : 'ok',
      } as BudgetProgress;
    })
    .sort((a, b) => b.percentUsed - a.percentUsed);
}
