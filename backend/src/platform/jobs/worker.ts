import { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { runWithRequestContext } from '../tenancy/context.js';
import { getJobHandler } from './registry.js';
import { systemContextForOrganization } from './system-context.js';

/**
 * Exponential backoff for a failed job: 2^attempts seconds, capped, so a
 * transient failure (a provider blip) is retried soon and a persistent one
 * backs off rather than hammering. attempts=1 → ~2s, 2 → ~4s, 3 → ~8s …
 */
const BACKOFF_CAP_SECONDS = 3600;
function backoffSeconds(attempts: number): number {
  return Math.min(2 ** attempts, BACKOFF_CAP_SECONDS);
}

/** One claimed job row, as returned by the claim query. */
interface ClaimedJob {
  id: string;
  organization_id: string;
  type: string;
  payload: Prisma.JsonValue;
  attempts: number;
  max_attempts: number;
}

/**
 * Claims a single ready job and marks it RUNNING, atomically.
 *
 * The claim is a raw `UPDATE … WHERE id IN (SELECT … FOR UPDATE SKIP
 * LOCKED)` because Prisma's query API cannot express row-level locking.
 * `SKIP LOCKED` is what makes this safe to run from multiple workers or app
 * instances at once: a row another worker is already holding is skipped
 * rather than waited on, so no job is ever handed to two workers. Only
 * PENDING jobs whose `run_after` has arrived are eligible; the oldest
 * ready job wins.
 *
 * Runs against the base (unscoped) client on purpose: the worker serves
 * every tenant, and the per-job organization scope is applied when the
 * handler runs (see `processOnce`), not at claim time.
 */
async function claimNextJob(): Promise<ClaimedJob | null> {
  const rows = await prisma.$queryRaw<ClaimedJob[]>`
    UPDATE jobs
       SET status = 'RUNNING', locked_at = now(), attempts = attempts + 1, updated_at = now()
     WHERE id IN (
       SELECT id FROM jobs
        WHERE status = 'PENDING' AND run_after <= now()
        ORDER BY run_after ASC, created_at ASC
        FOR UPDATE SKIP LOCKED
        LIMIT 1
     )
    RETURNING id, organization_id, type, payload, attempts, max_attempts
  `;
  return rows[0] ?? null;
}

async function markCompleted(id: string): Promise<void> {
  await prisma.job.update({
    where: { id },
    data: { status: 'COMPLETED', completedAt: new Date(), lockedAt: null, lastError: null },
  });
}

/**
 * Records a failed attempt. If attempts remain, the job goes back to
 * PENDING with `run_after` pushed out by the backoff; otherwise it lands in
 * FAILED for inspection. The attempt count was already incremented by the
 * claim, so `attempts >= max_attempts` here means this was the last try.
 */
async function markFailed(job: ClaimedJob, error: unknown): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const exhausted = job.attempts >= job.max_attempts;
  await prisma.job.update({
    where: { id: job.id },
    data: exhausted
      ? { status: 'FAILED', lockedAt: null, lastError: message }
      : {
          status: 'PENDING',
          lockedAt: null,
          lastError: message,
          runAfter: new Date(Date.now() + backoffSeconds(job.attempts) * 1000),
        },
  });
}

/**
 * Claims and processes at most one job. Returns true if a job was handled
 * (success or failure), false if the queue had nothing ready — the signal
 * the poll loop uses to decide whether to drain again immediately or sleep.
 *
 * The handler runs inside the job's organization context so `scopedPrisma`
 * is correctly tenant-filtered, exactly as an HTTP handler would be. An
 * unregistered job type is treated as a failure (and will exhaust retries
 * into FAILED), never a silent success — queued work with no handler is a
 * real deploy problem that must surface.
 */
export async function processOnce(): Promise<boolean> {
  const job = await claimNextJob();
  if (!job) return false;

  try {
    const handler = getJobHandler(job.type);
    if (!handler) {
      throw new Error(`No job handler registered for type "${job.type}".`);
    }
    await runWithRequestContext(systemContextForOrganization(job.organization_id), () =>
      handler(job.payload),
    );
    await markCompleted(job.id);
  } catch (error) {
    await markFailed(job, error);
  }
  return true;
}

/**
 * Drains all currently-ready jobs, one at a time, until the queue reports
 * nothing left to claim. Used by the poll loop each tick and, directly, by
 * tests that want to run the queue to quiescence without a timer.
 */
export async function drainJobs(): Promise<number> {
  let handled = 0;
  // Bound the drain so a job that immediately re-enqueues itself can't spin
  // this loop forever within a single tick; the next tick picks up the rest.
  const MAX_PER_DRAIN = 1000;
  while (handled < MAX_PER_DRAIN) {
    const didWork = await processOnce();
    if (!didWork) break;
    handled += 1;
  }
  return handled;
}

let timer: NodeJS.Timeout | null = null;
let running = false;

/**
 * Starts the in-process poll loop: every `intervalMs`, drain whatever is
 * ready. Deliberately simple — a DB-backed queue trades the sub-second
 * latency of a broker for zero extra infrastructure, and a few seconds of
 * delay on a confirmation email is the right trade for this product's
 * stage. Idempotent: calling twice does not start two loops.
 */
export function startJobWorker(intervalMs = 5000): void {
  if (timer) return;
  const tick = async (): Promise<void> => {
    if (running) return; // never overlap two drains
    running = true;
    try {
      await drainJobs();
    } catch (error) {
      console.error('[jobs] worker tick failed', error);
    } finally {
      running = false;
    }
  };
  timer = setInterval(() => void tick(), intervalMs);
  // Don't keep the process alive solely for the poll timer.
  timer.unref?.();
}

export function stopJobWorker(): void {
  if (timer) {
    clearInterval(timer);
    timer = null;
  }
}
