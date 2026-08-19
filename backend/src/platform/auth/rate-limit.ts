import type { NextFunction, Request, Response } from 'express';

import { HttpError } from '../../lib/http-errors.js';

/**
 * Minimal in-memory rate limiter for the login endpoint (Security
 * finding, Phase 1 review — see DECISIONS.md). Deliberately not backed
 * by a shared store: this is a single-process deployment for now (see
 * ARCHITECTURE.md's "Approved direction" — no Redis until pg-boss proves
 * insufficient). Revisit with a shared store (e.g. Redis) before running
 * more than one API process, since each process would otherwise track
 * its own independent counters.
 */
const WINDOW_MS = 15 * 60 * 1000;
const MAX_ATTEMPTS = 10;

interface Bucket {
  count: number;
  windowStart: number;
}

const buckets = new Map<string, Bucket>();

// Bounds unbounded growth from a sustained flood of distinct keys —
// prunes expired buckets opportunistically rather than on a timer.
function prune(now: number): void {
  if (buckets.size < 10_000) return;
  for (const [key, bucket] of buckets) {
    if (now - bucket.windowStart > WINDOW_MS) {
      buckets.delete(key);
    }
  }
}

export function loginRateLimit(req: Request, _res: Response, next: NextFunction): void {
  const email = typeof req.body?.email === 'string' ? req.body.email.toLowerCase() : 'unknown';
  const key = `${req.ip ?? 'unknown-ip'}:${email}`;
  const now = Date.now();

  prune(now);

  const bucket = buckets.get(key);
  if (!bucket || now - bucket.windowStart > WINDOW_MS) {
    buckets.set(key, { count: 1, windowStart: now });
    next();
    return;
  }

  bucket.count += 1;
  if (bucket.count > MAX_ATTEMPTS) {
    next(new HttpError(429, 'too_many_requests', 'Too many login attempts. Try again later.'));
    return;
  }

  next();
}
