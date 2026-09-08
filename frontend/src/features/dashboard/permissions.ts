import type { SessionClaims } from '../../auth/session';
import { hasPermission } from '../../auth/session';

/**
 * UI-side mirror of the dashboard permission key enforced in
 * `backend/src/modules/dashboard`. Visibility only — the route and the API
 * both enforce `dashboard:read` themselves; this just avoids rendering a
 * screen that would only earn a 403. The dashboard is read-only, so there
 * is no matching `manage`.
 */
export function canReadDashboard(session: SessionClaims | null): boolean {
  return hasPermission(session, 'dashboard:read');
}
