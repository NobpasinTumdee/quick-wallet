import crypto from 'node:crypto';
import { Router } from 'express';

import { db, StoreError } from '../db/excelStore';
import { asyncHandler } from '../middleware/errors';
import { Transaction, TransactionType, Wallet } from '../types';
import { bad, isoDate, num, oneOf, str, toDateKey } from '../utils/validate';

export const transactionsRouter = Router();

const TYPES: readonly TransactionType[] = ['income', 'expense', 'transfer'];

function ownedWallet(userId: string, walletId: string, label: string): Wallet {
  const wallet = db.findById<Wallet>('Wallets', walletId);
  if (!wallet || wallet.userId !== userId) {
    throw new StoreError(`${label} not found`, 404, 'WALLET_NOT_FOUND');
  }
  return wallet;
}

interface ParsedBody {
  walletId: string;
  toWalletId: string;
  type: TransactionType;
  amount: number;
  category: string;
  note: string;
  date: string;
}

function parseBody(userId: string, body: Record<string, unknown>): ParsedBody {
  const type = oneOf<TransactionType>(body.type, 'type', TYPES);
  const amount = num(body.amount, 'amount', { min: 0 });
  if (amount <= 0) throw bad('"amount" must be greater than zero');
  const walletId = str(body.walletId, 'walletId');
  const source = ownedWallet(userId, walletId, 'Source wallet');

  if (source.mode === 'investment' && type !== 'transfer') {
    throw bad(
      'Investment wallets hold positions, not income/expense rows. Use a transfer to move cash in or out.',
      'WRONG_WALLET_MODE',
    );
  }

  let toWalletId = '';
  if (type === 'transfer') {
    toWalletId = str(body.toWalletId, 'toWalletId');
    if (toWalletId === walletId) throw bad('A transfer needs two different wallets', 'SAME_WALLET');
    ownedWallet(userId, toWalletId, 'Destination wallet');
  }

  return {
    walletId,
    toWalletId,
    type,
    amount,
    category: type === 'transfer' ? 'Transfer' : str(body.category, 'category', { max: 60 }),
    note: str(body.note, 'note', { required: false, max: 300 }),
    date: isoDate(body.date ?? toDateKey(new Date()), 'date'),
  };
}

/**
 * Filters: walletId, type, category, period (YYYY-MM), from/to (YYYY-MM-DD),
 * search (matches note or category), limit.
 */
transactionsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { walletId, type, category, period, from, to, search } = req.query as Record<string, string>;
    const limit = Math.min(Number(req.query.limit) || 500, 5000);

    let rows = db.where<Transaction>('Transactions', (t) => t.userId === req.userId);

    if (walletId) rows = rows.filter((t) => t.walletId === walletId || t.toWalletId === walletId);
    if (type) rows = rows.filter((t) => t.type === type);
    if (category) rows = rows.filter((t) => t.category.toLowerCase() === category.toLowerCase());
    if (period) rows = rows.filter((t) => t.date.slice(0, 7) === period);
    if (from) rows = rows.filter((t) => t.date >= from);
    if (to) rows = rows.filter((t) => t.date <= to);
    if (search) {
      const needle = search.toLowerCase();
      rows = rows.filter(
        (t) => t.note.toLowerCase().includes(needle) || t.category.toLowerCase().includes(needle),
      );
    }

    // Newest first; createdAt breaks ties within the same day.
    rows.sort((a, b) => (b.date + b.createdAt).localeCompare(a.date + a.createdAt));
    res.json(rows.slice(0, limit));
  }),
);

transactionsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = parseBody(req.userId, req.body ?? {});
    const transaction: Transaction = {
      id: crypto.randomUUID(),
      userId: req.userId,
      ...parsed,
      createdAt: new Date().toISOString(),
    };
    db.insert<Transaction>('Transactions', transaction);
    res.status(201).json(transaction);
  }),
);

transactionsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = db.findById<Transaction>('Transactions', req.params.id);
    if (!existing || existing.userId !== req.userId) {
      throw new StoreError('Transaction not found', 404, 'NOT_FOUND');
    }
    // Re-validate the whole row so partial edits can't produce an invalid combo
    // (e.g. switching to `transfer` without a destination wallet).
    const merged = { ...existing, ...(req.body ?? {}) } as unknown as Record<string, unknown>;
    const parsed = parseBody(req.userId, merged);
    res.json(db.update<Transaction>('Transactions', existing.id, parsed));
  }),
);

transactionsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = db.findById<Transaction>('Transactions', req.params.id);
    if (!existing || existing.userId !== req.userId) {
      throw new StoreError('Transaction not found', 404, 'NOT_FOUND');
    }
    db.remove('Transactions', existing.id);
    res.json({ ok: true });
  }),
);
