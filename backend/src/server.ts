import cors from 'cors';
import express from 'express';

import { config } from './config';
import { db } from './db/excelStore';
import { requireAuth } from './middleware/auth';
import { asyncHandler, errorHandler, notFound } from './middleware/errors';
import { authRouter } from './routes/auth';
import { budgetsRouter } from './routes/budgets';
import { dashboardRouter } from './routes/dashboard';
import { investmentsRouter } from './routes/investments';
import { settingsRouter } from './routes/settings';
import { transactionsRouter } from './routes/transactions';
import { walletsRouter } from './routes/wallets';

const app = express();

const allowedOrigins = new Set([
  'http://localhost:5173',
  'http://127.0.0.1:5173',
  'http://localhost:4173',
  'http://127.0.0.1:4173',
  ...config.corsOrigins,
]);

app.use(
  cors({
    origin(origin, callback) {
      // No origin = curl / same-origin / the packaged build. Always fine locally.
      if (!origin || allowedOrigins.has(origin)) return callback(null, true);
      callback(new Error(`Origin ${origin} is not allowed`));
    },
  }),
);
app.use(express.json({ limit: '2mb' }));

app.use((req, _res, next) => {
  if (req.method !== 'GET') console.log(`[api] ${req.method} ${req.path}`);
  next();
});

/** Health + workbook status. The client polls this to warn about file locks. */
app.get(
  '/api/health',
  asyncHandler(async (_req, res) => {
    const health = db.getHealth();
    res.json({
      ok: health.ready && !health.lastError,
      ...health,
      hint: health.fileLocked
        ? 'database.xlsx is open in another program. Close it in Excel — pending changes are written automatically.'
        : undefined,
    });
  }),
);

/** Manual "save now", useful right before you open the workbook in Excel. */
app.post(
  '/api/flush',
  asyncHandler(async (_req, res) => {
    await db.flushNow();
    res.json({ ok: true, ...db.getHealth() });
  }),
);

app.use('/api/auth', authRouter);
app.use('/api/wallets', requireAuth, walletsRouter);
app.use('/api/transactions', requireAuth, transactionsRouter);
app.use('/api/investments', requireAuth, investmentsRouter);
app.use('/api/budgets', requireAuth, budgetsRouter);
app.use('/api/settings', requireAuth, settingsRouter);
app.use('/api/dashboard', requireAuth, dashboardRouter);

app.use(notFound);
app.use(errorHandler);

async function main(): Promise<void> {
  try {
    await db.init();
  } catch (err) {
    console.error('\n[fatal] could not open the database:\n  ' + (err as Error).message + '\n');
    process.exit(1);
  }

  const server = app.listen(config.port, () => {
    console.log(`\n  Quick Wallet API  →  http://localhost:${config.port}`);
    console.log(`  Workbook          →  ${config.dbPath}\n`);
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(
        `\n[fatal] port ${config.port} is already in use. Set PORT in backend/.env to something else.\n`,
      );
      process.exit(1);
    }
    throw err;
  });

  let shuttingDown = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`\n[api] ${signal} received — saving workbook...`);
    server.close();
    await db.shutdown();
    process.exit(0);
  };

  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => console.error('[api] unhandled rejection:', reason));
}

void main();
