/**
 * Domain types for block / group bookings, mirroring what
 * `backend/src/modules/reservation-groups` returns. Stay dates are date-only
 * `YYYY-MM-DD` strings.
 */

export type ReservationStatus = 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';

export interface GroupContactGuest {
  id: string;
  firstName: string;
  lastName: string;
  email?: string | null;
  phone?: string | null;
}

/** A block's child booking, as the detail view returns it. */
export interface GroupReservation {
  id: string;
  reference: string;
  status: ReservationStatus;
  guest: { id: string; firstName: string; lastName: string };
  roomType: { id: string; name: string; code: string | null };
  room: { id: string; name: string } | null;
  checkIn: string;
  checkOut: string;
  totalAmountMinor: number;
}

/** A block header in the list. */
export interface ReservationGroupSummary {
  id: string;
  name: string;
  reference: string;
  notes: string | null;
  createdAt: string;
  roomCount: number;
  contactGuest: { id: string; firstName: string; lastName: string } | null;
}

/** A block with its child bookings. */
export interface ReservationGroupDetail {
  id: string;
  name: string;
  reference: string;
  notes: string | null;
  createdAt: string;
  contactGuest: GroupContactGuest | null;
  totalAmountMinor: number;
  reservations: GroupReservation[];
}

/** One room line when creating a block. */
export interface BlockRoomInput {
  roomTypeId: string;
  ratePlanId: string;
  guestId: string;
  checkIn: string;
  checkOut: string;
  adults?: number;
  children?: number;
}

export interface CreateBlockInput {
  name: string;
  contactGuestId?: string;
  notes?: string;
  rooms: BlockRoomInput[];
}
