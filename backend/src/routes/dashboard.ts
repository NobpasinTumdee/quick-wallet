import { Router } from 'express';

import { db } from '../db/excelStore';
import { asyncHandler } from '../middleware/errors';
import {
  computeBudgetProgress,
  computeWalletBalances,
  decorateInvestment,
  getSettings,
  inPeriod,
  userInvestments,
  userTransactions,
} from '../services/finance';
import { Budget, DashboardSummary } from '../types';
import { currentPeriod, money, period as periodKey, shiftPeriod } from '../utils/validate';

export const dashboardRouter = Router();

const TREND_MONTHS = 6;

dashboardRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const period = periodKey(req.query.period, 'period', currentPeriod());
    const settings = getSettings(req.userId);

    const wallets = computeWalletBalances(req.userId, period).filter((w) => !w.archived);
    const transactions = userTransactions(req.userId);
    const investments = userInvestments(req.userId);
    const monthTx = transactions.filter((t) => inPeriod(t.date, period));

    const monthIncome = money(
      monthTx.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0),
    );
    const monthExpense = money(
      monthTx.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0),
    );

    const liquidBalance = money(
      wallets.filter((w) => w.mode === 'expense').reduce((s, w) => s + w.balance, 0),
    );
    // `investedCost` is the cost basis of open positions. Live market value is
    // layered on by the client once it has quotes from the stock API.
    const investedCost = money(wallets.reduce((s, w) => s + w.investedCost, 0));
    const investmentCash = money(
      wallets.filter((w) => w.mode === 'investment').reduce((s, w) => s + w.balance, 0),
    );

    const expenseByCategory = new Map<string, number>();
    for (const tx of monthTx) {
      if (tx.type !== 'expense') continue;
      const key = tx.category || 'Uncategorised';
      expenseByCategory.set(key, (expenseByCategory.get(key) ?? 0) + tx.amount);
    }
    const categoryBreakdown = [...expenseByCategory.entries()]
      .map(([category, amount]) => ({
        category,
        amount: money(amount),
        share: monthExpense > 0 ? money((amount / monthExpense) * 100) : 0,
      }))
      .sort((a, b) => b.amount - a.amount);

    const trend: DashboardSummary['trend'] = [];
    for (let i = TREND_MONTHS - 1; i >= 0; i -= 1) {
      const key = shiftPeriod(period, -i);
      const rows = transactions.filter((t) => inPeriod(t.date, key));
      const income = money(rows.filter((t) => t.type === 'income').reduce((s, t) => s + t.amount, 0));
      const expense = money(rows.filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0));
      trend.push({ period: key, income, expense, net: money(income - expense) });
    }

    const recentTransactions = [...transactions]
      .sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt))
      .slice(0, 8);

    const openPositions = investments
      .filter((i) => i.status === 'hold')
      .sort((a, b) => b.quantity * b.buyPrice - a.quantity * a.buyPrice);

    const summary: DashboardSummary & {
      investmentCash: number;
      positionCount: number;
      walletCount: number;
    } = {
      period,
      currency: settings?.currency || 'USD',
      netWorth: money(liquidBalance + investmentCash + investedCost),
      liquidBalance,
      investedCost,
      investmentCash,
      monthIncome,
      monthExpense,
      monthNet: money(monthIncome - monthExpense),
      savingsRate: monthIncome > 0 ? money(((monthIncome - monthExpense) / monthIncome) * 100) : 0,
      wallets,
      budgets: computeBudgetProgress(req.userId, period),
      recentTransactions,
      openPositions: openPositions.map(decorateInvestment),
      categoryBreakdown,
      trend,
      positionCount: openPositions.length,
      walletCount: wallets.length,
    };

    res.json(summary);
  }),
);

/** Distinct months that actually contain data — drives the period picker. */
dashboardRouter.get(
  '/periods',
  asyncHandler(async (req, res) => {
    const periods = new Set<string>([currentPeriod()]);
    for (const tx of userTransactions(req.userId)) {
      if (tx.date) periods.add(tx.date.slice(0, 7));
    }
    for (const budget of db.where<Budget>('Budgets', (b) => b.userId === req.userId)) {
      if (budget.period) periods.add(budget.period);
    }
    res.json([...periods].sort().reverse());
  }),
);
