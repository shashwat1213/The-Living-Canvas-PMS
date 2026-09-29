import { apiFetch } from '../../lib/api';
import { toQueryString } from '../../lib/pagination';
import type { CalendarResponse } from './types';

/**
 * The only place the calendar endpoint is named. The calendar lives under a
 * property, so the call carries the property id — the backend resolves it
 * through the tenant-scoped client, which is what makes a cross-organization
 * property a 404 rather than a leak.
 *
 * The window is half-open: `from` is inclusive, `to` is exclusive.
 */
const base = (propertyId: string) => `/api/v1/properties/${propertyId}/calendar`;

export function getCalendar(propertyId: string, from: string, to: string): Promise<CalendarResponse> {
  return apiFetch<CalendarResponse>(`${base(propertyId)}${toQueryString({ from, to })}`);
}
