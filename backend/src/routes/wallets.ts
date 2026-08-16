import crypto from 'node:crypto';
import { Router } from 'express';

import { db, StoreError } from '../db/excelStore';
import { asyncHandler } from '../middleware/errors';
import { computeWalletBalances } from '../services/finance';
import { Investment, Transaction, Wallet, WalletKind, WalletMode } from '../types';
import { bad, bool, num, oneOf, str } from '../utils/validate';

export const walletsRouter = Router();

const MODES: readonly WalletMode[] = ['expense', 'investment'];
const KINDS: readonly WalletKind[] = ['cash', 'bank', 'ewallet', 'credit', 'brokerage', 'other'];

function ownedWallet(userId: string, walletId: string): Wallet {
  const wallet = db.findById<Wallet>('Wallets', walletId);
  if (!wallet || wallet.userId !== userId) {
    throw new StoreError('Wallet not found', 404, 'WALLET_NOT_FOUND');
  }
  return wallet;
}

/** List wallets with their computed balances. */
walletsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const includeArchived = bool(req.query.includeArchived, false);
    const balances = computeWalletBalances(req.userId).filter(
      (w) => includeArchived || !w.archived,
    );
    res.json(balances);
  }),
);

walletsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    ownedWallet(req.userId, req.params.id);
    const wallet = computeWalletBalances(req.userId).find((w) => w.id === req.params.id);
    res.json(wallet);
  }),
);

walletsRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const name = str(body.name, 'name', { max: 60 });

    const duplicate = db.findOne<Wallet>(
      'Wallets',
      (w) => w.userId === req.userId && !w.archived && w.name.toLowerCase() === name.toLowerCase(),
    );
    if (duplicate) throw bad(`You already have a wallet called "${name}"`, 'DUPLICATE_WALLET');

    const mode = oneOf<WalletMode>(body.mode, 'mode', MODES, 'expense');
    const wallet: Wallet = {
      id: crypto.randomUUID(),
      userId: req.userId,
      name,
      mode,
      kind: oneOf<WalletKind>(body.kind, 'kind', KINDS, mode === 'investment' ? 'brokerage' : 'cash'),
      currency: (str(body.currency, 'currency', { required: false, max: 8 }) || 'USD').toUpperCase(),
      openingBalance: num(body.openingBalance, 'openingBalance', { required: false }),
      color: str(body.color, 'color', { required: false, max: 20 }) || '#4f8cff',
      icon: str(body.icon, 'icon', { required: false, max: 8 }) || (mode === 'investment' ? '📈' : '💳'),
      archived: false,
      note: str(body.note, 'note', { required: false, max: 300 }),
      createdAt: new Date().toISOString(),
    };

    db.insert<Wallet>('Wallets', wallet);
    res.status(201).json(wallet);
  }),
);

walletsRouter.patch(
  '/:id',
  asyncHandler(async (req, res) => {
    const existing = ownedWallet(req.userId, req.params.id);
    const body = req.body ?? {};
    const patch: Partial<Wallet> = {};

    if (body.name !== undefined) patch.name = str(body.name, 'name', { max: 60 });
    if (body.kind !== undefined) patch.kind = oneOf<WalletKind>(body.kind, 'kind', KINDS);
    if (body.currency !== undefined) patch.currency = str(body.currency, 'currency', { max: 8 }).toUpperCase();
    if (body.openingBalance !== undefined) {
      patch.openingBalance = num(body.openingBalance, 'openingBalance');
    }
    if (body.color !== undefined) patch.color = str(body.color, 'color', { max: 20 });
    if (body.icon !== undefined) patch.icon = str(body.icon, 'icon', { required: false, max: 8 });
    if (body.note !== undefined) patch.note = str(body.note, 'note', { required: false, max: 300 });
    if (body.archived !== undefined) patch.archived = bool(body.archived);

    // Switching modes would strand the existing rows, so only allow it while empty.
    if (body.mode !== undefined) {
      const mode = oneOf<WalletMode>(body.mode, 'mode', MODES);
      if (mode !== existing.mode) {
        const hasTx = db.where<Transaction>(
          'Transactions',
          (t) => t.walletId === existing.id || t.toWalletId === existing.id,
        ).length;
        const hasInv = db.where<Investment>('Investments', (i) => i.walletId === existing.id).length;
        if (hasTx || hasInv) {
          throw bad('Cannot change the mode of a wallet that already has records', 'MODE_LOCKED');
        }
        patch.mode = mode;
      }
    }

    res.json(db.update<Wallet>('Wallets', existing.id, patch));
  }),
);

/**
 * Delete a wallet. Refuses when records exist unless `?cascade=true`, which
 * also removes the wallet's transactions and investments.
 */
walletsRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const wallet = ownedWallet(req.userId, req.params.id);
    const cascade = bool(req.query.cascade, false);

    const linkedTx = db.where<Transaction>(
      'Transactions',
      (t) => t.userId === req.userId && (t.walletId === wallet.id || t.toWalletId === wallet.id),
    );
    const linkedInv = db.where<Investment>(
      'Investments',
      (i) => i.userId === req.userId && i.walletId === wallet.id,
    );

    if ((linkedTx.length || linkedInv.length) && !cascade) {
      throw new StoreError(
        `"${wallet.name}" still has ${linkedTx.length} transaction(s) and ${linkedInv.length} investment(s). ` +
          'Archive it instead, or delete with cascade=true.',
        409,
        'WALLET_NOT_EMPTY',
      );
    }

    if (cascade) {
      db.removeWhere(
        'Transactions',
        (t) => t.userId === req.userId && (t.walletId === wallet.id || t.toWalletId === wallet.id),
      );
      db.removeWhere('Investments', (i) => i.userId === req.userId && i.walletId === wallet.id);
      db.removeWhere('Budgets', (b) => b.userId === req.userId && b.scope === 'wallet' && b.targetId === wallet.id);
    }

    db.remove('Wallets', wallet.id);
    res.json({ ok: true, removedTransactions: cascade ? linkedTx.length : 0, removedInvestments: cascade ? linkedInv.length : 0 });
  }),
);
