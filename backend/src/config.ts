import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config();

const backendRoot = path.resolve(__dirname, '..');

function num(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export const config = {
  port: num(process.env.PORT, 4000),
  /** Absolute path to database.xlsx. */
  dbPath: path.resolve(backendRoot, process.env.DB_PATH || './data/database.xlsx'),
  tokenTtlMs: num(process.env.TOKEN_TTL_HOURS, 720) * 60 * 60 * 1000,
  flushDebounceMs: num(process.env.FLUSH_DEBOUNCE_MS, 300),
  corsOrigins: (process.env.CORS_ORIGINS || '')
    .split(',')
    .map((o) => o.trim())
    .filter(Boolean),
};

export const dataDir = path.dirname(config.dbPath);
