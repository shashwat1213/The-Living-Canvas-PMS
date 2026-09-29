import type { SessionClaims } from '../../auth/session';
import { hasPermission } from '../../auth/session';

/**
 * UI-side mirror of the marketing permission keys enforced in
 * `backend/src/modules/marketing`. Visibility only — the route and API are
 * the sole authority. Three tiers: read (see the library), manage
 * (generate / edit / regenerate / discard), approve (sign a draft off).
 */
export function canReadMarketing(session: SessionClaims | null): boolean {
  return hasPermission(session, 'marketing:read');
}

export function canManageMarketing(session: SessionClaims | null): boolean {
  return hasPermission(session, 'marketing:manage');
}

export function canApproveMarketing(session: SessionClaims | null): boolean {
  return hasPermission(session, 'marketing:approve');
}
