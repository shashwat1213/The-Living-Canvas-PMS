import type { JobHandler } from './types.js';

/**
 * The registry of job handlers, keyed by job `type`. A module that owns a
 * kind of deferred work registers its handler here at startup (see
 * `platform/notifications` registering `notification.send`). The worker
 * looks a handler up by the job's `type` string; an unregistered type is a
 * hard error, not a silent skip — a job in the table with no handler means
 * a deploy dropped code that still has queued work, which must be visible.
 */
const handlers = new Map<string, JobHandler>();

export function registerJobHandler(type: string, handler: JobHandler): void {
  if (handlers.has(type)) {
    throw new Error(`A job handler for "${type}" is already registered.`);
  }
  handlers.set(type, handler);
}

export function getJobHandler(type: string): JobHandler | undefined {
  return handlers.get(type);
}

/** Test-only: clear the registry so a suite can register in isolation. */
export function resetJobHandlers(): void {
  handlers.clear();
}
