import { prisma } from '../../lib/prisma.js';
import { getRequestContext } from './context.js';

const WHERE_OPERATIONS = new Set([
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'findUnique',
  'findUniqueOrThrow',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
  'count',
  'aggregate',
  'groupBy',
  'upsert',
]);

/**
 * Scoping logic for a model that carries `organizationId` as a real
 * column of its own (`Property`, `User`).
 *
 * Factored into one function rather than copy-pasted per model on
 * purpose: branch-review finding #4 was exactly a drifted copy of this
 * block — the `upsert` branch existed in one place and was missing from
 * another — and every additional hand-written copy is another chance to
 * reintroduce that class of bug. One definition means a model is either
 * fully scoped or not registered at all, with no partially-scoped
 * in-between state to get wrong.
 */
function scopeByOrganizationColumn() {
  return {
    async $allOperations({
      operation,
      args,
      query,
    }: {
      operation: string;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      args: any;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      query: (args: any) => Promise<any>;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    }): Promise<any> {
      const ctx = getRequestContext();
      const a = args;
      if (WHERE_OPERATIONS.has(operation)) {
        a.where = { ...a.where, organizationId: ctx.organizationId };
      }
      if (operation === 'create') {
        a.data = { ...a.data, organizationId: ctx.organizationId };
      }
      if (operation === 'upsert') {
        // upsert's create payload lives at `create`, not `data` — a
        // separate branch from plain `create` above. Its `where` is
        // already scoped by the WHERE_OPERATIONS block, but without
        // this the *created* row (on no match) would land with no
        // organizationId enforced by this mechanism.
        a.create = { ...a.create, organizationId: ctx.organizationId };
      }
      return query(a);
    },
  };
}

/**
 * The multi-tenancy enforcement mechanism (Phase 1 decision, see
 * ARCHITECTURE.md "Multi-tenancy enforcement"). Every query issued
 * through `scopedPrisma` for a tenant-scoped model gets its
 * organization filter injected automatically, sourced from the
 * request-scoped context — a repository function cannot forget it,
 * because it never writes the filter itself.
 *
 * `Property`, `User` and `AuditLog` carry `organizationId` directly;
 * `Room` doesn't (only `propertyId`), so its scope is enforced through
 * the `property` relation instead. Extend this file the same way — one entry per model
 * — when a new tenant-scoped model is added; a model not listed here is
 * NOT scoped by this extension (raw `prisma` from `lib/prisma.ts` stays
 * unscoped, for the platform-level code — auth, org creation — that
 * runs before tenant context exists).
 *
 * `Session`, `UserRoleAssignment` and `PropertyAccess` are deliberately
 * absent. Nothing reaches them with a client-supplied ID directly: the
 * auth platform reads them through the unscoped client *before* a tenant
 * context exists (which is why they can't be scoped here — see
 * `session-service.ts`), and staff management only ever writes them for a
 * `userId`/`propertyId` it has already resolved through the scoped `user`
 * and `property` entries above. That is the same pattern `Room`'s
 * `create` relies on, spelled out in the room block below.
 *
 * NOTE: this extension applies inside `$transaction` as well — a
 * transaction client opened from `scopedPrisma` still has the
 * organization filter injected on every statement. That is what lets a
 * service commit a mutation and its audit entry together without leaving
 * the tenant boundary (see `modules/properties/service.ts`), and it is
 * pinned by a regression test in `test/audit-transactional.test.ts`
 * rather than assumed: if a Prisma upgrade ever changed it, every
 * transactional mutation would silently go cross-tenant.
 *
 * Convention: read scoped models with `findFirst`, not `findUnique`.
 * (Prisma does tolerate the injected `organizationId` in a `findUnique`
 * where-clause — an earlier note here claimed otherwise and was wrong —
 * but `findFirst` states the intent, works uniformly, and is what every
 * repository here uses.)
 */
export const scopedPrisma = prisma.$extends({
  name: 'tenant-scoping',
  query: {
    property: scopeByOrganizationColumn(),
    user: scopeByOrganizationColumn(),
    auditLog: scopeByOrganizationColumn(),
    room: {
      async $allOperations({ operation, args, query }) {
        const ctx = getRequestContext();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = args as any;
        if (WHERE_OPERATIONS.has(operation)) {
          a.where = { ...a.where, property: { ...a.where?.property, organizationId: ctx.organizationId } };
        }
        // `create` has no organizationId column to inject on Room itself —
        // the rooms repository resolves/verifies the parent Property
        // through `scopedPrisma.property` first, which is what actually
        // enforces the scope for a room create (see modules/rooms/repository.ts).
        return query(a);
      },
    },
  },
});
