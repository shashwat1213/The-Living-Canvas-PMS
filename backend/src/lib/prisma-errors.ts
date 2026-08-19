import { Prisma } from '@prisma/client';

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
