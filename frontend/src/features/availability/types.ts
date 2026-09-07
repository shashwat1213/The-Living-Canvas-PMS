/**
 * Domain types for the availability calendar, mirroring what
 * `backend/src/modules/availability` returns. Dates are date-only
 * `YYYY-MM-DD` strings (a night), never full timestamps. The window is
 * half-open: `from` is inclusive, `to` is exclusive, so `dates` lists
 * exactly the nights in [from, to).
 */

/** One room type's inventory on a single night. */
export interface RoomTypeDay {
  date: string;
  booked: number;
  available: number;
}

/** A room type row in the grid, with its per-night inventory. */
export interface AvailabilityRoomType {
  id: string;
  name: string;
  code: string | null;
  totalRooms: number;
  /** Aligned by index with the response's `dates` array. */
  days: RoomTypeDay[];
}

/** The property-wide totals for a single night. */
export interface TotalsDay {
  date: string;
  totalRooms: number;
  booked: number;
  available: number;
  occupancyPct: number;
}

export interface AvailabilityResponse {
  from: string;
  to: string;
  /** Every night in [from, to); aligned by index with each `days` array. */
  dates: string[];
  roomTypes: AvailabilityRoomType[];
  totals: { days: TotalsDay[] };
}

/** How many nights the default window spans, starting today. */
export const DEFAULT_WINDOW_NIGHTS = 7;

/**
 * Adds `days` nights to a date-only `YYYY-MM-DD` string, staying in UTC so
 * the result never shifts by a day across a local timezone or DST boundary.
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
