/**
 * Domain types for the reservation calendar (tape chart), mirroring what
 * `backend/src/modules/calendar` returns. Dates are date-only `YYYY-MM-DD`
 * strings (a night), never full timestamps. The window is half-open: `from`
 * is inclusive, `to` is exclusive, so `dates` lists exactly the nights in
 * [from, to).
 */

export type ReservationStatus = 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';
export type RoomStatus = 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';
export type HousekeepingStatus = 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED';

/** A physical room — one row of the chart. */
export interface CalendarRoom {
  id: string;
  name: string;
  floor: string | null;
  status: RoomStatus;
  housekeepingStatus: HousekeepingStatus;
}

/** An ACTIVE room type with its rooms — a grouped section of the chart. */
export interface CalendarRoomType {
  id: string;
  name: string;
  code: string | null;
  rooms: CalendarRoom[];
}

/**
 * A reservation as the chart draws it: a bar positioned within the window.
 * `startIndex` is the column (night offset from `from`) the bar begins at and
 * `span` how many columns it covers, both already clamped to the visible
 * window. `continuesBefore` / `continuesAfter` flag a stay truncated at an
 * edge, so the UI can render an open-ended bar.
 */
export interface CalendarBlock {
  id: string;
  reference: string;
  status: ReservationStatus;
  roomId: string | null;
  roomTypeId: string;
  guestName: string;
  adults: number;
  children: number;
  checkIn: string;
  checkOut: string;
  startIndex: number;
  span: number;
  continuesBefore: boolean;
  continuesAfter: boolean;
}

export interface CalendarResponse {
  from: string;
  to: string;
  /** Every night in [from, to), left-to-right column order. */
  dates: string[];
  roomTypes: CalendarRoomType[];
  /** Blocks assigned to a specific room, keyed by `roomId`. */
  assigned: Record<string, CalendarBlock[]>;
  /** Occupying bookings with no room assigned yet — the front desk's work list. */
  unassigned: CalendarBlock[];
}

/** How many nights the default window spans, starting today. */
export const DEFAULT_WINDOW_NIGHTS = 14;

/**
 * Adds `days` nights to a date-only `YYYY-MM-DD` string, staying in UTC so the
 * result never shifts by a day across a local timezone or DST boundary.
 */
export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return date;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** Today as a date-only `YYYY-MM-DD` string, in UTC. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
