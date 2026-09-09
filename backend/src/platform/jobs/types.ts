import type { Prisma } from '@prisma/client';

/**
 * A job handler processes one job of a given `type`. It receives the job's
 * decoded payload and runs inside the request context of the organization
 * that enqueued the job (see `systemContextForOrganization`), so it can use
 * `scopedPrisma` freely.
 *
 * Throwing signals failure: the worker records the error, increments the
 * attempt count, and reschedules with exponential backoff until the job's
 * `maxAttempts` is reached, after which the job lands in `FAILED`. A handler
 * should therefore be idempotent — the same job may run more than once if a
 * process dies mid-run after the side effect but before the row is marked
 * COMPLETED.
 */
export type JobHandler = (payload: Prisma.JsonValue) => Promise<void>;

/** Minimal client surface the queue's `enqueue` needs — satisfied by the
 * base client, the scoped client, and any transaction opened from either,
 * so a job can be enqueued inside the transaction that triggered it. */
export interface JobEnqueueDb {
  job: {
    create(args: { data: Prisma.JobUncheckedCreateInput }): PromiseLike<{ id: string }>;
  };
}
