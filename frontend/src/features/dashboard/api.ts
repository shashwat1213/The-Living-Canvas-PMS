import { apiFetch } from '../../lib/api';
import { toQueryString } from '../../lib/pagination';
import type { DashboardView } from './types';

/**
 * The only place the dashboard endpoint is named. The cockpit lives under a
 * property, so the call carries the property id — the backend resolves it
 * through the tenant-scoped client, which is what makes a cross-organization
 * property a 404 rather than a leak. `date` is optional (defaults to today,
 * server-side) and date-only `YYYY-MM-DD`.
 */
const base = (propertyId: string) => `/api/v1/properties/${propertyId}/dashboard`;

export function getDashboard(propertyId: string, date?: string): Promise<DashboardView> {
  const qs = date ? toQueryString({ date }) : '';
  return apiFetch<DashboardView>(`${base(propertyId)}${qs}`);
}
