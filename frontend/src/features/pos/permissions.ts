import type { SessionClaims } from '../../auth/session';
import { hasPermission } from '../../auth/session';

/**
 * UI-side mirror of the POS permission keys enforced in
 * `backend/src/modules/pos`. Visibility only — the route and API are the sole
 * authority. Three tiers: read (see outlets/catalogue/orders), operate (take
 * and settle/void orders — front line), manage (configure outlets and the
 * catalogue — managers).
 */
export function canReadPos(session: SessionClaims | null): boolean {
  return hasPermission(session, 'pos:read');
}

export function canOperatePos(session: SessionClaims | null): boolean {
  return hasPermission(session, 'pos:operate');
}

export function canManagePos(session: SessionClaims | null): boolean {
  return hasPermission(session, 'pos:manage');
}
