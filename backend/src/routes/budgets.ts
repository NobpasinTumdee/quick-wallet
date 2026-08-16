import crypto from 'node:crypto';
import { Router } from 'express';

import { db, StoreError } from '../db/excelStore';
import { asyncHandler } from '../middleware/errors';
import { computeBudgetProgress } from '../services/finance';
import { Budget, BudgetMode, BudgetScope, Wallet } from '../types';
import { bad, currentPeriod, num, oneOf, period as periodKey, shiftPeriod, str } from '../utils/validate';

export const budgetsRouter = Router();

const SCOPES: readonly BudgetScope[] = ['category', 'wallet', 'global'];
const MODES: readonly BudgetMode[] = ['amount', 'percent'];

function parseBody(userId: string, body: Record<string, unknown>) {
  const scope = oneOf<BudgetScope>(body.scope, 'scope', SCOPES, 'category');
  const mode = oneOf<BudgetMode>(body.mode, 'mode', MODES, 'amount');
  const value = num(body.value, 'value', { min: 0, max: mode === 'percent' ? 100 : Number.MAX_SAFE_INTEGER });

  let targetId = '';
  let targetLabel = '';

  if (scope === 'category') {
    targetId = str(body.targetId, 'targetId', { max: 60 });
    targetLabel = targetId;
  } else if (scope === 'wallet') {
    targetId = str(body.targetId, 'targetId');
    const wallet = db.findById<Wallet>('Wallets', targetId);
    if (!wallet || wallet.userId !== userId) {
      throw new StoreError('Wallet not found', 404, 'WALLET_NOT_FOUND');
    }
    targetLabel = wallet.name;
  } else {
    targetLabel = 'All spending';
  }

  return {
    period: periodKey(body.period, 'period', currentPeriod()),
    scope,
    targetId,
    targetLabel,
    mode,
    value,
    baseIncome: num(body.baseIncome, 'baseIncome', { required: false, min: 0 }),
    note: str(body.note, 'note', { required: false, max: 300 }),
  };
}

/** Budgets for a period, each with computed progress. */
budgetsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const period = periodKey(req.query.period, 'period', currentPeriod());
    const progress = computeBudgetProgress(req.userId, period);

    const percentAllocated = progress
      .filter((b) => b.mode === 'percent')
      .reduce((sum, b) => sum + b.value, 0);

    res.json({
      period,
      budgets: progress,
      totals: {
        limit: progress.reduce((s, b) => s + b.limit, 0),
        spent: progress.reduce((s, b) => s + b.spent, 0),
        percentAllocated,
        percentUnallocated: Math.max(0, 100 - percentAllocated),
      },
    });
  }),
);

budgetsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = parseBody(req.userId, req.body ?? {});

    const clash = db.findOne<Budget>(
      'Budgets',
      (b) =>
        b.userId === req.userId &&
        b.period === parsed.period &&
        b.scope === parsed.scope &&
        b.targetId.toLowerCase() === parsed.targetId.toLowerCase(),
    );
    if (clash) {
      throw bad(
        `A ${parsed.scope} budget for "${parsed.targetLabel || parsed.period}" already exists this period — edit it instead.`,
        'DUPLICATE_BUDGET',
      );
    }

    const budget: Budget = {
      id: crypto.randomUUID(),
      userId: req.userId,
      ...parsed,
      createdAt: new Date().toISOString(),
    };
    db.insert<Budget>('Budgets', budget);
    res.status(201).json(budget);
  }),
);

budgetsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = db.findById<Budget>('Budgets', req.params.id);
    if (!existing || existing.userId !== req.userId) {
      throw new StoreError('Budget not found', 404, 'NOT_FOUND');
    }
    const merged = { ...existing, ...(req.body ?? {}) } as unknown as Record<string, unknown>;
    res.json(db.update<Budget>('Budgets', existing.id, parseBody(req.userId, merged)));
  }),
);

budgetsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = db.findById<Budget>('Budgets', req.params.id);
    if (!existing || existing.userId !== req.userId) {
      throw new StoreError('Budget not found', 404, 'NOT_FOUND');
    }
    db.remove('Budgets', existing.id);
    res.json({ ok: true });
  }),
);

/** Copy an entire month of budgets forward — the usual start-of-month chore. */
budgetsRouter.post(
  '/copy',
  asyncHandler(async (req, res) => {
    const from = periodKey(req.body?.from, 'from', shiftPeriod(currentPeriod(), -1));
    const to = periodKey(req.body?.to, 'to', currentPeriod());
    if (from === to) throw bad('Source and target periods must differ', 'SAME_PERIOD');

    const source = db.where<Budget>('Budgets', (b) => b.userId === req.userId && b.period === from);
    if (!source.length) throw bad(`No budgets found for ${from}`, 'NOTHING_TO_COPY');

    const existing = db.where<Budget>('Budgets', (b) => b.userId === req.userId && b.period === to);
    const taken = new Set(existing.map((b) => `${b.scope}:${b.targetId.toLowerCase()}`));

    let copied = 0;
    for (const budget of source) {
      if (taken.has(`${budget.scope}:${budget.targetId.toLowerCase()}`)) continue;
      db.insert<Budget>('Budgets', {
        ...budget,
        id: crypto.randomUUID(),
        period: to,
        createdAt: new Date().toISOString(),
      });
      copied += 1;
    }

    res.json({ ok: true, copied, skipped: source.length - copied });
  }),
);
