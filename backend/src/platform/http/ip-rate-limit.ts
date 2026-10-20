import type { NextFunction, Request, Response } from 'express';

import { env } from '../../config/env.js';
import { HttpError } from '../../lib/http-errors.js';

/**
 * A minimal in-memory, per-IP rate limiter factory for public (unauthenticated)
 * endpoints — the booking engine's search/book. Same single-process caveat as
 * the login limiter (`platform/auth/rate-limit.ts`): fine for one API process,
 * needs a shared store (e.g. Redis) before horizontal scaling. Kept separate
 * from the login limiter because that one keys on IP+email; this keys on IP
 * alone and is parameterised per route.
 */
export function ipRateLimit(options: {
  windowMs: number;
  max: number;
  name: string;
  /** Integration tests sign up hundreds of orgs from one IP; skip there. */
  skipInTest?: boolean;
}) {
  const { windowMs, max, name, skipInTest = false } = options;
  const buckets = new Map<string, { count: number; windowStart: number }>();

  function prune(now: number): void {
    if (buckets.size < 10_000) return;
    for (const [key, bucket] of buckets) {
      if (now - bucket.windowStart > windowMs) buckets.delete(key);
    }
  }

  return function rateLimit(req: Request, res: Response, next: NextFunction): void {
    if (skipInTest && env.isTest) {
      next();
      return;
    }
    const key = `${name}:${req.ip ?? 'unknown-ip'}`;
    const now = Date.now();
    prune(now);

    const bucket = buckets.get(key);
    if (!bucket || now - bucket.windowStart > windowMs) {
      buckets.set(key, { count: 1, windowStart: now });
      next();
      return;
    }

    bucket.count += 1;
    if (bucket.count > max) {
      res.setHeader('Retry-After', String(Math.ceil((bucket.windowStart + windowMs - now) / 1000)));
      next(new HttpError(429, 'too_many_requests', 'Too many requests. Please slow down and try again shortly.'));
      return;
    }
    next();
  };
}
