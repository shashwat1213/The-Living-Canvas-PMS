import { AsyncLocalStorage } from 'node:async_hooks';

import type { Permission, SystemRoleName } from '../rbac/permissions.js';

/**
 * Resolved from the access token on every authenticated request (see
 * `platform/tenancy/middleware.ts`). This is what the tenant-scoping
 * Prisma extension (`platform/tenancy/scoped-prisma.ts`) and the RBAC
 * guard (`platform/rbac/guard.ts`) read — request handlers never build
 * their own tenant filter or permission check by hand.
 */
export interface RequestContext {
  userId: string;
  organizationId: string;
  /** Resolved from every Role the user holds, deduplicated. */
  permissions: ReadonlySet<Permission>;
  /** Names of the (system) roles the user holds — drives PropertyAccess bypass. */
  roleNames: ReadonlySet<SystemRoleName>;
  /** Property IDs the user has an explicit PropertyAccess grant for. */
  grantedPropertyIds: ReadonlySet<string>;
}

const storage = new AsyncLocalStorage<RequestContext>();

/**
 * IMPORTANT: `fn` must actually `await` any Prisma call before returning
 * — merely returning the (lazy, thenable) Prisma query without awaiting
 * it inside this callback loses the AsyncLocalStorage context, because
 * Prisma defers real execution until `.then()`/`await`, which by then
 * happens outside `storage.run`'s synchronous extent. This is exactly
 * how `authenticate` (`tenancy/middleware.ts`) uses it: it calls `next()`
 * synchronously, and every downstream route handler's first `await`
 * happens while still inside this call stack, so context propagates
 * correctly without every handler needing to know about this rule.
 */
export function runWithRequestContext<T>(ctx: RequestContext, fn: () => T): T {
  return storage.run(ctx, fn);
}

/** Throws if called outside an authenticated request — every tenant-scoped
 * data access path is expected to run inside one. */
export function getRequestContext(): RequestContext {
  const ctx = storage.getStore();
  if (!ctx) {
    throw new Error(
      'No tenant request context is active. This code path must run inside the `authenticate` middleware chain.',
    );
  }
  return ctx;
}

export function hasPermission(permission: Permission): boolean {
  return getRequestContext().permissions.has(permission);
}

/**
 * True if the caller may act on the given property: an org-wide role
 * (OWNER/ADMIN), or an explicit PropertyAccess grant.
 *
 * This function answers *property-level* access only — "is this ID one
 * the caller is granted onto within their org" — and does NOT verify the
 * property actually belongs to the caller's organization; an
 * OWNER/ADMIN's org-wide bypass returns true for any ID passed in. That
 * is deliberate, not a gap: the *organization* boundary is enforced
 * separately and unconditionally by the tenant-scoping Prisma extension
 * (`scoped-prisma.ts`) at the point a property/room is actually read or
 * written, regardless of what this guard decided. A cross-organization
 * property ID still resolves to 404 there. Keeping these as two
 * independent layers — property-level grant here, organization boundary
 * in the data-access layer — means neither one has to re-implement the
 * other's job to stay correct.
 */
export function canAccessProperty(propertyId: string): boolean {
  const ctx = getRequestContext();
  const isOrgWide = [...ctx.roleNames].some((name) => name === 'OWNER' || name === 'ADMIN');
  return isOrgWide || ctx.grantedPropertyIds.has(propertyId);
}
