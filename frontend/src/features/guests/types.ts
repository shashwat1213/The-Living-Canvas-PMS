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
  /** Segmentation labels, upper-cased (e.g. "VIP", "CORPORATE"). */
  tags: string[];
  /** How many reservations reference this guest. */
  reservationCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface GuestListParams {
  search?: string;
  tag?: string;
  page?: number;
  pageSize?: number;
}

/** One line of a guest's stay history. */
export interface GuestStay {
  id: string;
  reference: string;
  status: string;
  property: { id: string; name: string };
  roomType: { id: string; name: string };
  checkIn: string;
  checkOut: string;
  nights: number;
  totalAmountMinor: number;
}

/** The guest-360 profile: the record plus computed history and lifetime value. */
export interface GuestProfile {
  guest: Guest;
  stats: {
    totalStays: number;
    upcomingStays: number;
    cancelledStays: number;
    nightsStayed: number;
    bookedValueMinor: number;
    chargedMinor: number;
    paidMinor: number;
    balanceMinor: number;
    isRepeatGuest: boolean;
    firstStay: string | null;
    lastStay: string | null;
  };
  stays: GuestStay[];
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
