import * as Sentry from '@sentry/react';

/**
 * Front-end error tracking. Only active when `VITE_SENTRY_DSN` is set at
 * build time — dev, tests and CI never report. No PII: Sentry's default
 * PII collection stays off and breadcrumbs from inputs are not recorded.
 */
const DSN = import.meta.env.VITE_SENTRY_DSN as string | undefined;

export function initObservability(): void {
  if (!DSN) return;
  Sentry.init({
    dsn: DSN,
    environment: import.meta.env.MODE,
    tracesSampleRate: 0,
    // Network blips and auth expiries are normal traffic, not bugs.
    ignoreErrors: [/Can't reach the server/, /Invalid or expired access token/, /ResizeObserver loop/],
  });
}

export function reportError(error: unknown, context?: Record<string, unknown>): void {
  if (!DSN) return;
  Sentry.captureException(error, context ? { extra: context } : undefined);
}
