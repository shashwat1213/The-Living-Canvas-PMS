import type { SessionClaims } from '../../auth/session';
import { hasPermission } from '../../auth/session';

/**
 * UI-side mirror of the maintenance permission keys enforced in
 * `backend/src/modules/maintenance`. Visibility only — every action still goes
 * to the server, which is the sole authority. Maintenance has no rank rule:
 * manage is a flat capability.
 */
export function canReadMaintenance(session: SessionClaims | null): boolean {
  return hasPermission(session, 'maintenance:read');
}

export function canManageMaintenance(session: SessionClaims | null): boolean {
  return hasPermission(session, 'maintenance:manage');
}
