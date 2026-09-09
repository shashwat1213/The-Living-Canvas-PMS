import type { Prisma } from '@prisma/client';

import { prisma } from '../../lib/prisma.js';
import { getRequestContext } from '../tenancy/context.js';
import type { JobEnqueueDb } from './types.js';

export interface EnqueueJobInput {
  type: string;
  payload?: Prisma.InputJsonValue;
  /** Overrides the default retry ceiling for this job. */
  maxAttempts?: number;
  /** Earliest time the job may run; defaults to now. Use to schedule work. */
  runAfter?: Date;
}

/**
 * Enqueues a background job for the current request's organization.
 *
 * The organization is read from the request context, never passed in — a
 * caller cannot enqueue work for another tenant, exactly like the audit
 * recorder. Pass the surrounding transaction's client and the job row is
 * written inside it, so the job and the domain change that triggered it
 * commit or roll back together: no "send confirmation" job for a booking
 * that didn't persist, and no persisted booking whose job silently never
 * got enqueued.
 */
export async function enqueueJob(input: EnqueueJobInput, client: JobEnqueueDb = prisma): Promise<string> {
  const ctx = getRequestContext();
  const job = await client.job.create({
    data: {
      organizationId: ctx.organizationId,
      type: input.type,
      payload: input.payload ?? {},
      ...(input.maxAttempts !== undefined ? { maxAttempts: input.maxAttempts } : {}),
      ...(input.runAfter !== undefined ? { runAfter: input.runAfter } : {}),
    },
  });
  return job.id;
}
