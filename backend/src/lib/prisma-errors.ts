import { Prisma } from '@prisma/client';

import { ConflictError } from './http-errors.js';

/**
 * True for Prisma's "record to update/delete not found" error — the
 * expected shape when the tenant-scoping extension's injected filter
 * makes a cross-tenant `update`/`delete` match zero rows. Repositories
 * catch this and rethrow as `NotFoundError` (see `lib/http-errors.ts`)
 * rather than letting a raw Prisma error reach the client.
 */
export function isRecordNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}

/** True for Prisma's unique-constraint violation (e.g. a duplicate slug/name). */
export function isUniqueConstraintError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

/**
 * Runs a write, converting a database-level unique-constraint violation
 * into a `ConflictError` — the backstop for the narrow race between a
 * service's own proactive existence check and the write itself. Every
 * unrelated error propagates unchanged.
 *
 * Centralizes what was previously the same five-line try/catch repeated
 * in `organizations`/`properties`/`rooms` `service.ts` (branch-review
 * finding #9) — the proactive check itself still lives in each service,
 * since the lookup differs per entity; only the catch-and-convert
 * boilerplate is shared here.
 */
export async function withUniqueConstraintGuard<T>(write: () => Promise<T>, conflictMessage: string): Promise<T> {
  try {
    return await write();
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError(conflictMessage);
    }
    throw error;
  }
}
