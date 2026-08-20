import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';
import type { CreateStaffInput, StaffListParams, StaffMember, UpdateStaffInput } from './types';

/**
 * The only place staff endpoints are named. Components call these
 * functions and never build a `/api/v1/staff/...` path themselves, so the
 * contract has exactly one point of contact with the rest of the app — if
 * the API changes, this file changes and nothing else has to.
 *
 * Everything goes through `lib/api.ts`'s `apiFetch`, which attaches the
 * access token, performs the single-flight refresh-and-retry on a 401,
 * and throws a typed `ApiError` that callers surface directly. Errors are
 * deliberately not caught or reinterpreted here: the backend's message is
 * the accurate one, including for 403s.
 */

const BASE = '/api/v1/staff';

export interface StaffListResult {
  staff: StaffMember[];
  page: PageMeta;
}

/**
 * One page of staff. Searching and filtering happen on the server, so the
 * client never holds — or has to hide — rows the user didn't ask for.
 * Omitted params fall back to the API's own defaults rather than being
 * duplicated here.
 */
export function listStaff(params: StaffListParams = {}): Promise<StaffListResult> {
  return apiFetch<StaffListResult>(`${BASE}${toQueryString({ ...params })}`);
}

export function getStaffMember(userId: string): Promise<StaffMember> {
  return apiFetch<{ staff: StaffMember }>(`${BASE}/${userId}`).then((res) => res.staff);
}

export function createStaffMember(input: CreateStaffInput): Promise<StaffMember> {
  return apiFetch<{ staff: StaffMember }>(BASE, { method: 'POST', body: input }).then((res) => res.staff);
}

export function updateStaffMember(userId: string, input: UpdateStaffInput): Promise<StaffMember> {
  return apiFetch<{ staff: StaffMember }>(`${BASE}/${userId}`, { method: 'PATCH', body: input }).then(
    (res) => res.staff,
  );
}

/**
 * Replaces the member's property grants with exactly this set — the API
 * is a whole-set write, not a delta, so callers send the complete
 * resulting list.
 */
export function setStaffPropertyAccess(userId: string, propertyIds: string[]): Promise<StaffMember> {
  return apiFetch<{ staff: StaffMember }>(`${BASE}/${userId}/property-access`, {
    method: 'PUT',
    body: { propertyIds },
  }).then((res) => res.staff);
}
