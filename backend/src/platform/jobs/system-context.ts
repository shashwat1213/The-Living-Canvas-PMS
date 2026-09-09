import { type Permission, PERMISSION_KEYS, type SystemRoleName } from '../rbac/permissions.js';
import type { RequestContext } from '../tenancy/context.js';

/**
 * A sentinel actor id for work performed by the system itself (the job
 * worker), not by a logged-in user. It is deliberately NOT a real
 * `User.id`: a job handler must not write a USER-attributed audit entry
 * under this id (the FK would dangle). System-originated audit, when a
 * handler needs it, uses `actorType: 'SYSTEM'` with a null actor — which
 * is what the audit trail already models via `AuditActorType.SYSTEM`.
 */
export const SYSTEM_ACTOR_ID = 'system';

/**
 * Builds the request context a background job runs inside. Unlike an HTTP
 * request — where the context is resolved from the caller's access token —
 * a job has no caller, so it runs with the full permission set and the
 * org-wide role, scoped to the single organization that enqueued it. That
 * is what keeps `scopedPrisma` correct inside a handler (every query is
 * filtered to this org) while never letting a handler reach across tenants.
 *
 * `userId` is the SYSTEM sentinel, not a real user — see `SYSTEM_ACTOR_ID`.
 */
export function systemContextForOrganization(organizationId: string): RequestContext {
  return {
    userId: SYSTEM_ACTOR_ID,
    organizationId,
    permissions: new Set<Permission>(PERMISSION_KEYS),
    roleNames: new Set<SystemRoleName>(['OWNER']),
    grantedPropertyIds: new Set<string>(),
  };
}
