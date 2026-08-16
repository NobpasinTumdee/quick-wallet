import crypto from 'node:crypto';
import { Router } from 'express';

import { db, StoreError } from '../db/excelStore';
import { DEFAULT_CATEGORIES } from '../db/schema';
import { createSalt, hashPassword, issueToken, requireAuth, verifyPassword } from '../middleware/auth';
import { asyncHandler } from '../middleware/errors';
import { PublicUser, Settings, User, Wallet } from '../types';
import { bad, str } from '../utils/validate';

export const authRouter = Router();

function toPublic(user: User): PublicUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    createdAt: user.createdAt,
  };
}

function defaultSettings(userId: string): Settings {
  return {
    userId,
    theme: 'dark',
    accent: '#4f8cff',
    customVars: {},
    currency: 'USD',
    displayCurrency: '',
    fxRate: 1,
    fxRateUpdatedAt: '',
    locale: 'en-US',
    monthlyIncome: 0,
    categories: [...DEFAULT_CATEGORIES],
    updatedAt: new Date().toISOString(),
  };
}

/** Who exists on this machine — used to render the login screen's user list. */
authRouter.get(
  '/users',
  asyncHandler(async (_req, res) => {
    const users = db
      .all<User>('Users')
      .filter((u) => u.active !== false)
      .map((u) => ({ id: u.id, username: u.username, displayName: u.displayName }));
    res.json({ users, needsSetup: users.length === 0 });
  }),
);

authRouter.post(
  '/register',
  asyncHandler(async (req, res) => {
    const username = str(req.body?.username, 'username', { max: 40 }).toLowerCase();
    const password = str(req.body?.password, 'password', { max: 200 });
    const displayName = str(req.body?.displayName, 'displayName', { required: false, max: 60 }) || username;

    if (!/^[a-z0-9._-]{2,40}$/.test(username)) {
      throw bad('Username may only contain letters, numbers, dot, dash and underscore (2-40 chars)');
    }
    if (password.length < 4) throw bad('Password must be at least 4 characters');

    const existing = db.findOne<User>('Users', (u) => u.username === username);
    if (existing) throw new StoreError('That username is already taken', 409, 'USERNAME_TAKEN');

    const salt = createSalt();
    const user: User = {
      id: crypto.randomUUID(),
      username,
      displayName,
      salt,
      passwordHash: hashPassword(password, salt),
      active: true,
      createdAt: new Date().toISOString(),
    };

    db.insert<User>('Users', user);
    db.insert<Settings>('Settings', defaultSettings(user.id));

    // A brand new user with zero wallets can't record anything, so seed one.
    db.insert<Wallet>('Wallets', {
      id: crypto.randomUUID(),
      userId: user.id,
      name: 'Cash',
      mode: 'expense',
      kind: 'cash',
      currency: 'USD',
      openingBalance: 0,
      color: '#4f8cff',
      icon: '💵',
      archived: false,
      note: 'Created automatically — rename or delete it any time.',
      createdAt: new Date().toISOString(),
    });

    res.status(201).json({ token: issueToken(user.id), user: toPublic(user) });
  }),
);

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const username = str(req.body?.username, 'username', { max: 40 }).toLowerCase();
    const password = str(req.body?.password, 'password', { max: 200 });

    const user = db.findOne<User>('Users', (u) => u.username === username);
    // Same message either way — no username enumeration, even locally.
    const invalid = new StoreError('Incorrect username or password', 401, 'INVALID_CREDENTIALS');

    if (!user || user.active === false) throw invalid;
    if (!user.salt || !user.passwordHash) {
      throw new StoreError(
        'This account has no password stored. Edit the Users sheet or register again.',
        409,
        'ACCOUNT_BROKEN',
      );
    }
    if (!verifyPassword(password, user.salt, user.passwordHash)) throw invalid;

    // Older rows (or hand-made ones) may predate the Settings sheet.
    if (!db.findById<Settings>('Settings', user.id)) {
      db.insert<Settings>('Settings', defaultSettings(user.id));
    }

    res.json({ token: issueToken(user.id), user: toPublic(user) });
  }),
);

/** Cheap token validation for app boot. */
authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    res.json({ user: toPublic(req.user) });
  }),
);

authRouter.post(
  '/change-password',
  requireAuth,
  asyncHandler(async (req, res) => {
    const currentPassword = str(req.body?.currentPassword, 'currentPassword', { max: 200 });
    const newPassword = str(req.body?.newPassword, 'newPassword', { max: 200 });
    if (newPassword.length < 4) throw bad('New password must be at least 4 characters');

    if (!verifyPassword(currentPassword, req.user.salt, req.user.passwordHash)) {
      throw new StoreError('Current password is incorrect', 401, 'INVALID_CREDENTIALS');
    }

    const salt = createSalt();
    db.update<User>('Users', req.userId, { salt, passwordHash: hashPassword(newPassword, salt) });
    res.json({ ok: true });
  }),
);
