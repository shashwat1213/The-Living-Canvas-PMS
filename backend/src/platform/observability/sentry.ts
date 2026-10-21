import * as Sentry from '@sentry/node';

import { env } from '../../config/env.js';

/**
 * Error tracking. Active only when `SENTRY_DSN` is set; otherwise every call
 * here is a no-op, so dev, CI and tests never phone home.
 *
 * Only *unexpected* failures (the 500 path in `errorHandler`) are reported —
 * validation errors, 401/403/404s are normal traffic, not bugs. PII is kept
 * out: no request bodies, cookies or auth headers are attached.
 */
let enabled = false;

export function initErrorTracking(): void {
  if (enabled || !env.sentryDsn) return;
  Sentry.init({
    dsn: env.sentryDsn,
    environment: process.env.VERCEL_ENV ?? env.nodeEnv,
    release: process.env.VERCEL_GIT_COMMIT_SHA,
    tracesSampleRate: 0,
  });
  enabled = true;
}

export function captureError(error: unknown, context?: { method?: string; path?: string }): void {
  if (!enabled) return;
  Sentry.withScope((scope) => {
    if (context?.method) scope.setTag('http.method', context.method);
    if (context?.path) scope.setTag('http.route', context.path);
    Sentry.captureException(error);
  });
}

/** Serverless: flush before the function is frozen. */
export async function flushErrors(timeoutMs = 2000): Promise<void> {
  if (enabled) await Sentry.flush(timeoutMs);
}
