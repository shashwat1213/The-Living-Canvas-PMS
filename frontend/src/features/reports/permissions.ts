import type { SessionClaims } from '../../auth/session';
import { hasPermission } from '../../auth/session';

/**
 * UI-side mirror of the reports permission key enforced in
 * `backend/src/modules/reports`. Visibility only — the route and the API both
 * enforce `reports:read` themselves; this just avoids rendering a screen that
 * would only earn a 403. Reports are read-only management analytics, so there
 * is no matching `manage`.
 */
export function canReadReports(session: SessionClaims | null): boolean {
  return hasPermission(session, 'reports:read');
}
