import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';

import { HttpError } from '../lib/http-errors.js';
import { captureError } from '../platform/observability/sentry.js';

/**
 * Centralized error handler — every route delegates errors here via
 * `next(err)` (or an async wrapper throwing) rather than formatting a
 * response inline. Keeps the error shape consistent and keeps unexpected
 * error details (stack traces, raw Prisma errors) out of the response.
 */
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof HttpError) {
    res.status(err.status).json({ error: { code: err.code, message: err.message } });
    return;
  }

  if (err instanceof ZodError) {
    res.status(400).json({
      error: {
        code: 'validation_error',
        message: 'The request body failed validation.',
        issues: err.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
      },
    });
    return;
  }

  // Malformed JSON body from express.json(): a client error, not a bug.
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({ error: { code: 'invalid_json', message: 'The request body is not valid JSON.' } });
    return;
  }

  console.error('[backend] unhandled error', err);
  captureError(err, { method: req.method, path: req.route?.path ?? req.path });
  res.status(500).json({ error: { code: 'internal_error', message: 'Something went wrong.' } });
}

/** Wraps an async route handler so a rejected promise reaches `errorHandler`. */
export function asyncHandler<T extends (req: Request, res: Response, next: NextFunction) => Promise<unknown>>(fn: T) {
  return (req: Request, res: Response, next: NextFunction): void => {
    fn(req, res, next).catch(next);
  };
}
