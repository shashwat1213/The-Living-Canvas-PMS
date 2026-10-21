import type { IncomingMessage, ServerResponse } from 'node:http';

import { waitUntil } from '@vercel/functions';
import express from 'express';

import { createApp } from './app.js';
import { configureProviders } from './bootstrap.js';
import { drainJobs } from './platform/jobs/worker.js';
import { flushErrors } from './platform/observability/sentry.js';

/**
 * Serverless entry (Vercel Functions). Same Express app as `index.ts`, but
 * there is no long-lived process to run the background-job poll loop, so:
 *
 * - after every mutating request, the queue is drained in `waitUntil` (runs
 *   after the response is sent, before the instance is frozen) — this is
 *   what makes "generate marketing copy" / notifications complete promptly;
 * - a daily Vercel Cron hits `/api/cron/drain-jobs` as a safety net for
 *   anything left behind (retries with backoff).
 *
 * `FOR UPDATE SKIP LOCKED` in the claim query keeps concurrent drains safe.
 */
configureProviders();
const api = createApp();
// The cron route must be registered before the API's catch-all 404.
const app = express();

function drainSafely(): Promise<void> {
  return drainJobs()
    .then(() => undefined)
    .catch((error: unknown) => console.error('[jobs] serverless drain failed', error));
}

app.get('/api/cron/drain-jobs', (req, res, next) => {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    next();
    return;
  }
  drainJobs()
    .then((handled) => res.json({ handled }))
    .catch(next);
});
app.use(api);

export default function handler(req: IncomingMessage, res: ServerResponse): void {
  res.on('finish', () => {
    if (req.method && req.method !== 'GET' && req.method !== 'HEAD' && req.method !== 'OPTIONS') {
      waitUntil(drainSafely());
    }
    waitUntil(flushErrors());
  });
  app(req as never, res as never);
}
