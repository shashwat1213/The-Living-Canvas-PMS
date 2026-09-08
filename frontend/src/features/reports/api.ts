import { apiFetch } from '../../lib/api';
import { toQueryString } from '../../lib/pagination';
import type { RevenueReport } from './types';

/**
 * The only place the reports endpoint is named. Reports live under a
 * property, so the call carries the property id — the backend resolves it
 * through the tenant-scoped client, which is what makes a cross-organization
 * property a 404 rather than a leak. The window is half-open: `from`
 * inclusive, `to` exclusive, both date-only `YYYY-MM-DD`.
 */
const base = (propertyId: string) => `/api/v1/properties/${propertyId}/reports`;

export function getRevenueReport(propertyId: string, from: string, to: string): Promise<RevenueReport> {
  return apiFetch<RevenueReport>(`${base(propertyId)}/revenue${toQueryString({ from, to })}`);
}
