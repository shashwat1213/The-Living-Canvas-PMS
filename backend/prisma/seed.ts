/**
 * Seeds the global permission catalog (see
 * `src/platform/rbac/permissions.ts`, the actual source of truth for
 * which keys exist). Idempotent — safe to run against an already-seeded
 * database. Organization-scoped system roles are NOT seeded here; they're
 * created per-organization at signup time (see
 * `src/platform/rbac/provisioning.ts`), since `Role` is org-scoped and
 * this script runs once per deployment, not once per tenant.
 *
 * Run via `npm run db:seed -w backend`, or automatically after
 * `prisma migrate dev` (Prisma's default behavior when a `seed` script is
 * configured in package.json).
 */
import { prisma } from '../src/lib/prisma.js';
import { ensurePermissionCatalog } from '../src/platform/rbac/provisioning.js';

async function main() {
  await ensurePermissionCatalog(prisma);
  console.log('[seed] permission catalog is up to date.');
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
