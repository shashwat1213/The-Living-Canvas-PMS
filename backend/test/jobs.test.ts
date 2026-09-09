/**
 * The DB-backed job queue and worker (2026-09-09), exercised directly
 * against the real database with purpose-built handlers — separate from
 * the notifications end-to-end suite so the queue's own mechanics (claim,
 * retry, backoff, exhaustion, concurrency) are pinned independently of any
 * one job type.
 */
import { randomUUID } from 'node:crypto';

import { describe, expect, it, beforeAll } from 'vitest';

import { prisma } from '../src/lib/prisma.js';
import { enqueueJob } from '../src/platform/jobs/queue.js';
import { registerJobHandler, getJobHandler } from '../src/platform/jobs/registry.js';
import { processOnce, drainJobs } from '../src/platform/jobs/worker.js';
import { runWithRequestContext } from '../src/platform/tenancy/context.js';
import { PERMISSION_KEYS } from '../src/platform/rbac/permissions.js';
import { signupOrganization } from './helpers.js';

/** A request context for an org, so `enqueueJob` (which reads the org from
 * context) can run outside an HTTP request. */
function ctxFor(organizationId: string) {
  return {
    userId: 'test-user',
    organizationId,
    permissions: new Set(PERMISSION_KEYS),
    roleNames: new Set(['OWNER' as const]),
    grantedPropertyIds: new Set<string>(),
  };
}

// Register handlers once. Each test uses a unique type so registration
// (which rejects duplicates) is safe and tests don't interfere.
const calls: Record<string, number> = {};
const OK_TYPE = `test.ok.${randomUUID().slice(0, 8)}`;
const FAIL_TYPE = `test.fail.${randomUUID().slice(0, 8)}`;

beforeAll(() => {
  registerJobHandler(OK_TYPE, async () => {
    calls[OK_TYPE] = (calls[OK_TYPE] ?? 0) + 1;
  });
  registerJobHandler(FAIL_TYPE, async () => {
    calls[FAIL_TYPE] = (calls[FAIL_TYPE] ?? 0) + 1;
    throw new Error('deliberate handler failure');
  });
});

describe('job registry', () => {
  it('rejects a duplicate registration for the same type', () => {
    const type = `test.dup.${randomUUID().slice(0, 8)}`;
    registerJobHandler(type, async () => {});
    expect(() => registerJobHandler(type, async () => {})).toThrow(/already registered/);
  });

  it('the notification.send handler is registered by app construction', () => {
    // helpers.ts calls createApp(), which registers it.
    expect(getJobHandler('notification.send')).toBeDefined();
  });
});

describe('enqueue + process', () => {
  it('runs a ready job and marks it COMPLETED', async () => {
    const { organizationId } = await signupOrganization('Jobs Org');
    const jobId = await runWithRequestContext(ctxFor(organizationId), () =>
      enqueueJob({ type: OK_TYPE }),
    );

    const before = calls[OK_TYPE] ?? 0;
    const handled = await drainJobs();
    expect(handled).toBeGreaterThanOrEqual(1);
    expect(calls[OK_TYPE]).toBe(before + 1);

    const job = await prisma.job.findFirst({ where: { id: jobId } });
    expect(job?.status).toBe('COMPLETED');
    expect(job?.attempts).toBe(1);
    expect(job?.completedAt).not.toBeNull();
    expect(job?.lockedAt).toBeNull();
  });

  it('does not claim a job whose run_after is still in the future', async () => {
    const { organizationId } = await signupOrganization('Jobs Org');
    const jobId = await runWithRequestContext(ctxFor(organizationId), () =>
      enqueueJob({ type: OK_TYPE, runAfter: new Date(Date.now() + 60_000) }),
    );

    await drainJobs();
    const job = await prisma.job.findFirst({ where: { id: jobId } });
    // Still waiting — never claimed.
    expect(job?.status).toBe('PENDING');
    expect(job?.attempts).toBe(0);
  });
});

describe('retry and backoff', () => {
  it('reschedules a failed job with backoff, then lands it in FAILED after maxAttempts', async () => {
    const { organizationId } = await signupOrganization('Jobs Org');
    const jobId = await runWithRequestContext(ctxFor(organizationId), () =>
      enqueueJob({ type: FAIL_TYPE, maxAttempts: 2 }),
    );

    // First attempt: fails, goes back to PENDING with run_after pushed out.
    const didWork = await processOnce();
    expect(didWork).toBe(true);
    let job = await prisma.job.findFirst({ where: { id: jobId } });
    expect(job?.status).toBe('PENDING');
    expect(job?.attempts).toBe(1);
    expect(job?.lastError).toContain('deliberate handler failure');
    expect(job!.runAfter.getTime()).toBeGreaterThan(Date.now());

    // It is backed off, so an immediate drain claims nothing.
    expect(await drainJobs()).toBe(0);

    // Force it ready and run the final attempt: exhausts maxAttempts → FAILED.
    await prisma.job.update({ where: { id: jobId }, data: { runAfter: new Date(Date.now() - 1000) } });
    await processOnce();
    job = await prisma.job.findFirst({ where: { id: jobId } });
    expect(job?.status).toBe('FAILED');
    expect(job?.attempts).toBe(2);
    expect(job?.lastError).toContain('deliberate handler failure');
  });
});

describe('claim safety', () => {
  it('processOnce returns false when nothing is ready', async () => {
    // Drain anything left by other tests, then confirm the empty signal.
    await drainJobs();
    expect(await processOnce()).toBe(false);
  });

  it('never processes the same job twice under concurrent claims (SKIP LOCKED)', async () => {
    const { organizationId } = await signupOrganization('Jobs Org');
    // Clear any ready jobs left by earlier tests so the count below is exact.
    await drainJobs();
    // Enqueue several jobs, then claim them from many workers at once.
    const n = 5;
    await runWithRequestContext(ctxFor(organizationId), async () => {
      for (let i = 0; i < n; i += 1) await enqueueJob({ type: OK_TYPE });
    });

    const before = calls[OK_TYPE] ?? 0;
    // Fire more concurrent claims than there are jobs; the extras must find
    // nothing rather than double-claim a locked row.
    const results = await Promise.all(Array.from({ length: n + 3 }, () => processOnce()));
    const worked = results.filter(Boolean).length;
    expect(worked).toBe(n);
    expect(calls[OK_TYPE]).toBe(before + n);
  });
});
