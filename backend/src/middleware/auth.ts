import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { NextFunction, Request, Response } from 'express';

import { config, dataDir } from '../config';
import { db, StoreError } from '../db/excelStore';
import { User } from '../types';

/**
 * Local-only auth. This app never leaves your machine, so the goal here is
 * "keep users' data separated and don't store plaintext passwords" — not
 * defending against a determined attacker who already has your disk.
 */

const SECRET_FILE = path.join(dataDir, '.session-secret');

function loadOrCreateSecret(): string {
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    if (fs.existsSync(SECRET_FILE)) {
      const existing = fs.readFileSync(SECRET_FILE, 'utf8').trim();
      if (existing.length >= 32) return existing;
    }
    const secret = crypto.randomBytes(48).toString('hex');
    fs.writeFileSync(SECRET_FILE, secret, { encoding: 'utf8' });
    return secret;
  } catch {
    // Read-only data dir: fall back to an in-memory secret. Tokens then die
    // with the process, which just means "log in again after a restart".
    console.warn('[auth] could not persist session secret — sessions reset on restart');
    return crypto.randomBytes(48).toString('hex');
  }
}

const SECRET = loadOrCreateSecret();

export function createSalt(): string {
  return crypto.randomBytes(16).toString('hex');
}

export function hashPassword(password: string, salt: string): string {
  return crypto.scryptSync(password, salt, 64).toString('hex');
}

export function verifyPassword(password: string, salt: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHash, 'hex');
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}

function sign(payload: string): string {
  return crypto.createHmac('sha256', SECRET).update(payload).digest('base64url');
}

export function issueToken(userId: string): string {
  const expiresAt = Date.now() + config.tokenTtlMs;
  const payload = `${userId}.${expiresAt}`;
  return `${Buffer.from(payload).toString('base64url')}.${sign(payload)}`;
}

export function verifyToken(token: string): string | null {
  const parts = token.split('.');
  if (parts.length !== 2) return null;

  const [encoded, signature] = parts;
  let payload: string;
  try {
    payload = Buffer.from(encoded, 'base64url').toString('utf8');
  } catch {
    return null;
  }

  const expected = sign(payload);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  const [userId, expiresAt] = payload.split('.');
  if (!userId || !expiresAt) return null;
  if (Number(expiresAt) < Date.now()) return null;
  return userId;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      userId: string;
      user: User;
    }
  }
}

/** Rejects the request unless a valid bearer token maps to an active user. */
export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  const header = req.header('authorization') || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';

  if (!token) {
    next(new StoreError('Missing authorization token', 401, 'UNAUTHORIZED'));
    return;
  }

  const userId = verifyToken(token);
  if (!userId) {
    next(new StoreError('Session expired or invalid — please sign in again', 401, 'UNAUTHORIZED'));
    return;
  }

  const user = db.findById<User>('Users', userId);
  if (!user || user.active === false) {
    next(new StoreError('User no longer exists', 401, 'UNAUTHORIZED'));
    return;
  }

  req.userId = userId;
  req.user = user;
  next();
}
