/**
 * Seeds the global permission catalog (see
 * `src/platform/rbac/permissions.ts`, the actual source of truth for
 * which keys exist). Idempotent — safe to run against an already-seeded
 * database. Organization-scoped system roles are NOT created here; they're
 * created per-organization at signup time (see
 * `src/platform/rbac/provisioning.ts`), since `Role` is org-scoped and
 * this script runs once per deployment, not once per tenant.
 *
 * It does, however, *backfill* role→permission mappings for organizations
 * that already exist, so a permission key added to the catalog after they
 * signed up still reaches them (`syncSystemRolePermissions`). Without that
 * step, a new key would only ever apply to organizations created after the
 * deploy that introduced it.
 *
 * Run via `npm run db:seed -w backend`, or automatically after
 * `prisma migrate dev` (Prisma's default behavior when a `seed` script is
 * configured in package.json).
 */
import { prisma } from '../src/lib/prisma.js';
import { ensurePermissionCatalog, syncSystemRolePermissions } from '../src/platform/rbac/provisioning.js';

async function main() {
  await ensurePermissionCatalog(prisma);
  console.log('[seed] permission catalog is up to date.');

  const added = await syncSystemRolePermissions(prisma);
  console.log(
    added === 0
      ? '[seed] existing organizations already have every system-role permission.'
      : `[seed] backfilled ${added} role-permission mapping(s) onto existing organizations.`,
  );
}

main()
  .catch((error: unknown) => {
    console.error('[seed] failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
