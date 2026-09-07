/**
 * Domain types for reservations, mirroring what
 * `backend/src/modules/reservations` returns and accepts. Money is always
 * integer INR minor units (paise); stay dates are date-only `YYYY-MM-DD`
 * strings, never full timestamps.
 */

export const RESERVATION_STATUSES = ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW'] as const;
export type ReservationStatus = (typeof RESERVATION_STATUSES)[number];

export interface ReservationGuest {
  id: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
}

export interface ReservationRoomType {
  id: string;
  name: string;
  code: string | null;
}

export interface ReservationRatePlan {
  id: string;
  name: string;
  code: string | null;
  isRefundable: boolean;
}

export interface ReservationListRow {
  id: string;
  propertyId: string;
  roomTypeId: string;
  ratePlanId: string;
  guestId: string;
  roomId: string | null;
  reference: string;
  status: ReservationStatus;
  checkIn: string;
  checkOut: string;
  adults: number;
  children: number;
  totalAmountMinor: number;
  notes: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  updatedAt: string;
  guest: ReservationGuest;
  roomType: ReservationRoomType;
  ratePlan: ReservationRatePlan;
}

export interface ReservationNight {
  date: string;
  amountMinor: number;
}

export interface Reservation extends ReservationListRow {
  nights: ReservationNight[];
  room: { id: string; name: string } | null;
}

export interface ReservationListParams {
  status?: ReservationStatus;
  search?: string;
  from?: string;
  to?: string;
  page?: number;
  pageSize?: number;
}

export interface CreateReservationInput {
  guestId: string;
  roomTypeId: string;
  ratePlanId: string;
  checkIn: string;
  checkOut: string;
  adults?: number;
  children?: number;
  notes?: string;
}

/** A candidate room for assignment, flagged free/occupied for the stay dates. */
export interface AssignableRoom {
  id: string;
  name: string;
  floor: string | null;
  available: boolean;
}

export interface ReservationQuote {
  available: boolean;
  sellableRooms: number;
  booked: number;
  nights: number;
  totalMinor: number;
  pricedNights: ReservationNight[];
}

export const RESERVATION_STATUS_LABEL: Record<ReservationStatus, string> = {
  CONFIRMED: 'Confirmed',
  CHECKED_IN: 'Checked in',
  CHECKED_OUT: 'Checked out',
  CANCELLED: 'Cancelled',
  NO_SHOW: 'No-show',
};

/** Only a confirmed or checked-in booking can be cancelled, per the service. */
export function canCancel(status: ReservationStatus): boolean {
  return status === 'CONFIRMED' || status === 'CHECKED_IN';
}

/** Only a confirmed booking can be marked a no-show, per the service. */
export function canMarkNoShow(status: ReservationStatus): boolean {
  return status === 'CONFIRMED';
}

/** A room can be assigned while the booking still holds inventory. */
export function canAssignRoom(status: ReservationStatus): boolean {
  return status === 'CONFIRMED' || status === 'CHECKED_IN';
}

/** Only a confirmed booking can be checked in. */
export function canCheckIn(status: ReservationStatus): boolean {
  return status === 'CONFIRMED';
}

/** Only a checked-in booking can be checked out. */
export function canCheckOut(status: ReservationStatus): boolean {
  return status === 'CHECKED_IN';
}

export function reservationGuestName(guest: Pick<ReservationGuest, 'firstName' | 'lastName'>): string {
  return `${guest.firstName} ${guest.lastName}`.trim();
}

/** Whole nights in [checkIn, checkOut) — checkOut is exclusive. */
export function nightCount(checkIn: string, checkOut: string): number {
  const inMs = Date.parse(`${checkIn}T00:00:00.000Z`);
  const outMs = Date.parse(`${checkOut}T00:00:00.000Z`);
  if (Number.isNaN(inMs) || Number.isNaN(outMs)) return 0;
  return Math.round((outMs - inMs) / 86_400_000);
}
