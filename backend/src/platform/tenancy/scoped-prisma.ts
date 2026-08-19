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
 * The multi-tenancy enforcement mechanism (Phase 1 decision, see
 * ARCHITECTURE.md "Multi-tenancy enforcement"). Every query issued
 * through `scopedPrisma` for a tenant-scoped model gets its
 * organization filter injected automatically, sourced from the
 * request-scoped context — a repository function cannot forget it,
 * because it never writes the filter itself.
 *
 * `Property` carries `organizationId` directly; `Room` doesn't (only
 * `propertyId`), so its scope is enforced through the `property`
 * relation instead. Extend this file the same way — one block per model
 * — when a new tenant-scoped model is added; a model not listed here is
 * NOT scoped by this extension (raw `prisma` from `lib/prisma.ts` stays
 * unscoped, for the platform-level code — auth, org creation — that
 * runs before tenant context exists).
 */
export const scopedPrisma = prisma.$extends({
  name: 'tenant-scoping',
  query: {
    property: {
      async $allOperations({ operation, args, query }) {
        const ctx = getRequestContext();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const a = args as any;
        if (WHERE_OPERATIONS.has(operation)) {
          a.where = { ...a.where, organizationId: ctx.organizationId };
        }
        if (operation === 'create') {
          a.data = { ...a.data, organizationId: ctx.organizationId };
        }
        return query(a);
      },
    },
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
