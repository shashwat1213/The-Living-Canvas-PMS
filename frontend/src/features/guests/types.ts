/**
 * Domain types for guests, mirroring what `backend/src/modules/guests`
 * returns and accepts.
 */

export interface Guest {
  id: string;
  organizationId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
  /** How many reservations reference this guest. */
  reservationCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GuestListParams {
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateGuestInput {
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  notes?: string;
}

export type UpdateGuestInput = Partial<{
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  notes: string | null;
}>;

export const GUEST_NAME_MAX_LENGTH = 80;
export const GUEST_NOTES_MAX_LENGTH = 2000;

export function guestFullName(guest: Pick<Guest, 'firstName' | 'lastName'>): string {
  return `${guest.firstName} ${guest.lastName}`.trim();
}
