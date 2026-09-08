import type { SessionClaims } from '../../auth/session';
import { hasPermission } from '../../auth/session';

/**
 * UI-side mirror of the guest permission keys enforced in
 * `backend/src/modules/guests`. Visibility only — every action still goes to
 * the server, which is the sole authority (see the staff permissions file for
 * the full rationale). Guests have no rank rule: manage is a flat capability.
 */
export function canReadGuests(session: SessionClaims | null): boolean {
  return hasPermission(session, 'guests:read');
}

export function canManageGuests(session: SessionClaims | null): boolean {
  return hasPermission(session, 'guests:manage');
}
