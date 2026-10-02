import type { SessionClaims } from '../../auth/session';
import { hasPermission } from '../../auth/session';

/**
 * UI-side mirror of the permission the assistant route enforces
 * (`dashboard:read` — the assistant answers from the same operational snapshot
 * the dashboard exposes). Visibility only; the route and API are the sole
 * authority. Every built-in role (OWNER/ADMIN/MANAGER/STAFF) holds this, so
 * the assistant is available to anyone who can see a property's cockpit.
 */
export function canUseAssistant(session: SessionClaims | null): boolean {
  return hasPermission(session, 'dashboard:read');
}
