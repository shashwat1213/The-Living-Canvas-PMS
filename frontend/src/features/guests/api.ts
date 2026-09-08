import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';
import type { CreateGuestInput, Guest, GuestListParams, GuestProfile, UpdateGuestInput } from './types';

/**
 * The only place guest endpoints are named. Guests are organization-scoped
 * (a guest may stay at any of the organization's properties), so unlike rooms
 * or rate plans these live at the top level with no `propertyId` in the path.
 */
const base = '/api/v1/guests';

export interface GuestListResult {
  guests: Guest[];
  page: PageMeta;
}

export function listGuests(params: GuestListParams = {}): Promise<GuestListResult> {
  return apiFetch<GuestListResult>(`${base}${toQueryString({ ...params })}`);
}

export function getGuest(guestId: string): Promise<Guest> {
  return apiFetch<{ guest: Guest }>(`${base}/${guestId}`).then((res) => res.guest);
}

export function createGuest(input: CreateGuestInput): Promise<Guest> {
  return apiFetch<{ guest: Guest }>(base, { method: 'POST', body: input }).then((res) => res.guest);
}

export function updateGuest(guestId: string, input: UpdateGuestInput): Promise<Guest> {
  return apiFetch<{ guest: Guest }>(`${base}/${guestId}`, { method: 'PATCH', body: input }).then((res) => res.guest);
}

export function deleteGuest(guestId: string): Promise<void> {
  return apiFetch<void>(`${base}/${guestId}`, { method: 'DELETE' });
}

export function getGuestProfile(guestId: string): Promise<GuestProfile> {
  return apiFetch<GuestProfile>(`${base}/${guestId}/profile`);
}

export function setGuestTags(guestId: string, tags: string[]): Promise<Guest> {
  return apiFetch<{ guest: Guest }>(`${base}/${guestId}/tags`, { method: 'PUT', body: { tags } }).then((res) => res.guest);
}
