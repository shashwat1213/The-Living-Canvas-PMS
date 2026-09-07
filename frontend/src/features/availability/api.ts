import { apiFetch } from '../../lib/api';
import { toQueryString } from '../../lib/pagination';
import type { AvailabilityResponse } from './types';

/**
 * The only place the availability endpoint is named. Availability lives
 * under a property, so the call carries the property id — the backend
 * resolves it through the tenant-scoped client, which is what makes a
 * cross-organization property a 404 rather than a leak.
 *
 * The window is half-open: `from` is inclusive, `to` is exclusive.
 */
const base = (propertyId: string) => `/api/v1/properties/${propertyId}/availability`;

export function getAvailability(
  propertyId: string,
  from: string,
  to: string,
): Promise<AvailabilityResponse> {
  return apiFetch<AvailabilityResponse>(`${base(propertyId)}${toQueryString({ from, to })}`);
}
