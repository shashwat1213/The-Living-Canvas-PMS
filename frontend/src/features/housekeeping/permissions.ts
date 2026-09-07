import type { SessionClaims } from '../../auth/session';
import { hasPermission } from '../../auth/session';

/**
 * UI-side mirror of the housekeeping permission keys enforced in
 * `backend/src/modules/housekeeping`. Visibility only — every action still
 * goes to the server, which is the sole authority (see the staff permissions
 * file for the full rationale). Housekeeping has no rank rule: manage is a
 * flat capability.
 */
export function canReadHousekeeping(session: SessionClaims | null): boolean {
  return hasPermission(session, 'housekeeping:read');
}

export function canManageHousekeeping(session: SessionClaims | null): boolean {
  return hasPermission(session, 'housekeeping:manage');
}
