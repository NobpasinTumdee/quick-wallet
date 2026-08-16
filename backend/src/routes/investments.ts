import crypto from 'node:crypto';
import { Router } from 'express';

import { db, StoreError } from '../db/excelStore';
import { asyncHandler } from '../middleware/errors';
import { decorateInvestment } from '../services/finance';
import { Investment, InvestmentStatus, Wallet } from '../types';
import { bad, isoDate, num, oneOf, str, toDateKey } from '../utils/validate';

export const investmentsRouter = Router();

const STATUSES: readonly InvestmentStatus[] = ['hold', 'sold'];

function normalizeTags(value: unknown): string {
  const raw = Array.isArray(value) ? value.join(',') : String(value ?? '');
  const tags = raw
    .split(',')
    .map((t) => t.trim())
    .filter(Boolean);
  return [...new Set(tags)].slice(0, 12).join(', ');
}

function parseBody(userId: string, body: Record<string, unknown>) {
  const walletId = str(body.walletId, 'walletId');
  const wallet = db.findById<Wallet>('Wallets', walletId);
  if (!wallet || wallet.userId !== userId) {
    throw new StoreError('Wallet not found', 404, 'WALLET_NOT_FOUND');
  }
  if (wallet.mode !== 'investment') {
    throw bad('Positions can only be added to an investment-mode wallet', 'WRONG_WALLET_MODE');
  }

  const status = oneOf<InvestmentStatus>(body.status, 'status', STATUSES, 'hold');
  const sellPrice = num(body.sellPrice, 'sellPrice', { required: false, min: 0 });

  // No artificial precision floor — fractional shares and 8-decimal crypto
  // quantities are both legitimate. Any positive number is accepted.
  const quantity = num(body.quantity, 'quantity', { min: 0 });
  if (quantity <= 0) throw bad('"quantity" must be greater than zero');

  if (status === 'sold' && sellPrice <= 0) {
    throw bad('A sold position needs a sell price', 'MISSING_SELL_PRICE');
  }

  return {
    walletId,
    symbol: str(body.symbol, 'symbol', { max: 20 }).toUpperCase(),
    quantity,
    buyPrice: num(body.buyPrice, 'buyPrice', { min: 0 }),
    fees: num(body.fees, 'fees', { required: false, min: 0 }),
    buyDate: isoDate(body.buyDate ?? toDateKey(new Date()), 'buyDate'),
    tags: normalizeTags(body.tags),
    status,
    sellPrice,
    sellDate: status === 'sold' ? isoDate(body.sellDate ?? toDateKey(new Date()), 'sellDate') : '',
    note: str(body.note, 'note', { required: false, max: 300 }),
  };
}

/** Cost basis and realised PnL come from the shared helper so /api/dashboard
 *  and /api/investments return identically shaped rows. */
const decorate = decorateInvestment;

investmentsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const { walletId, status, symbol, tag } = req.query as Record<string, string>;
    let rows = db.where<Investment>('Investments', (i) => i.userId === req.userId);

    if (walletId) rows = rows.filter((i) => i.walletId === walletId);
    if (status) rows = rows.filter((i) => i.status === status);
    if (symbol) rows = rows.filter((i) => i.symbol.toUpperCase() === symbol.toUpperCase());
    if (tag) {
      const needle = tag.toLowerCase();
      rows = rows.filter((i) =>
        i.tags.split(',').map((t) => t.trim().toLowerCase()).includes(needle),
      );
    }

    rows.sort((a, b) => (b.buyDate + b.createdAt).localeCompare(a.buyDate + a.createdAt));
    res.json(rows.map(decorate));
  }),
);

/** Distinct symbols the user holds — handy for batching stock-API quote calls. */
investmentsRouter.get(
  '/symbols',
  asyncHandler(async (req, res) => {
    const symbols = new Set(
      db
        .where<Investment>('Investments', (i) => i.userId === req.userId && i.status === 'hold')
        .map((i) => i.symbol.toUpperCase())
        .filter(Boolean),
    );
    res.json([...symbols].sort());
  }),
);

investmentsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const parsed = parseBody(req.userId, req.body ?? {});
    const investment: Investment = {
      id: crypto.randomUUID(),
      userId: req.userId,
      ...parsed,
      createdAt: new Date().toISOString(),
    };
    db.insert<Investment>('Investments', investment);
    res.status(201).json(decorate(investment));
  }),
);

investmentsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = db.findById<Investment>('Investments', req.params.id);
    if (!existing || existing.userId !== req.userId) {
      throw new StoreError('Investment not found', 404, 'NOT_FOUND');
    }
    const merged = { ...existing, ...(req.body ?? {}) } as unknown as Record<string, unknown>;
    const parsed = parseBody(req.userId, merged);
    res.json(decorate(db.update<Investment>('Investments', existing.id, parsed)));
  }),
);

/** Convenience endpoint for the "Sell" button. */
investmentsRouter.post(
  '/:id/sell',
  asyncHandler(async (req, res) => {
    const existing = db.findById<Investment>('Investments', req.params.id);
    if (!existing || existing.userId !== req.userId) {
      throw new StoreError('Investment not found', 404, 'NOT_FOUND');
    }
    if (existing.status === 'sold') throw bad('This position is already marked as sold', 'ALREADY_SOLD');

    const updated = db.update<Investment>('Investments', existing.id, {
      status: 'sold',
      sellPrice: num(req.body?.sellPrice, 'sellPrice', { min: 0 }),
      sellDate: isoDate(req.body?.sellDate ?? toDateKey(new Date()), 'sellDate'),
    });
    res.json(decorate(updated));
  }),
);

investmentsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = db.findById<Investment>('Investments', req.params.id);
    if (!existing || existing.userId !== req.userId) {
      throw new StoreError('Investment not found', 404, 'NOT_FOUND');
    }
    db.remove('Investments', existing.id);
    res.json({ ok: true });
  }),
);
