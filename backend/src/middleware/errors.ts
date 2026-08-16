import { NextFunction, Request, RequestHandler, Response } from 'express';
import { StoreError } from '../db/excelStore';

/** Wraps async handlers so rejected promises reach the error middleware. */
export function asyncHandler(fn: RequestHandler): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}

export function notFound(_req: Request, res: Response): void {
  res.status(404).json({ error: 'Route not found', code: 'ROUTE_NOT_FOUND' });
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof StoreError) {
    res.status(err.status).json({ error: err.message, code: err.code });
    return;
  }

  if (err instanceof SyntaxError && 'body' in (err as never)) {
    res.status(400).json({ error: 'Request body is not valid JSON', code: 'BAD_JSON' });
    return;
  }

  const message = err instanceof Error ? err.message : 'Unexpected server error';
  console.error('[api] unhandled error:', err);
  res.status(500).json({ error: message, code: 'INTERNAL_ERROR' });
}
