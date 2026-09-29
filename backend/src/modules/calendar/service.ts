import { calendarRepository } from './repository.js';
import type { CalendarQuery } from './schemas.js';
import type { CalendarRoomType, CalendarReservation } from './repository.js';

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Every night in [from, to) — `to` is exclusive, mirroring a stay's checkOut. */
function nightsBetween(from: Date, to: Date): Date[] {
  const nights: Date[] = [];
  for (let d = new Date(from); d < to; d.setUTCDate(d.getUTCDate() + 1)) {
    nights.push(new Date(d));
  }
  return nights;
}

const MS_PER_NIGHT = 86_400_000;

/**
 * A reservation as the chart draws it: a bar positioned within the window.
 * `startIndex` is the column (night offset from `from`) the bar begins at and
 * `span` how many columns it covers, both already clamped to the visible
 * window — a stay that begins before `from` or ends after `to` is truncated to
 * the edge and flagged (`continuesBefore` / `continuesAfter`) so the UI can
 * render an open-ended bar instead of a false start/end.
 */
export interface CalendarBlock {
  id: string;
  reference: string;
  status: CalendarReservation['status'];
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

export interface CalendarView {
  from: string;
  to: string;
  /** One ISO date per night in the window, left-to-right column order. */
  dates: string[];
  /** ACTIVE room types with their rooms — the grouped rows of the chart. */
  roomTypes: CalendarRoomType[];
  /** Blocks assigned to a specific room, grouped by `roomId`. */
  assigned: Record<string, CalendarBlock[]>;
  /**
   * Occupying bookings with no room assigned yet — the front desk's work list.
   * Rendered in an "Unassigned" lane above the rooms so nothing is invisible.
   */
  unassigned: CalendarBlock[];
}

/**
 * Turn one reservation into a window-clamped chart bar. The window is
 * [windowFrom, windowTo) in whole nights; a stay is [checkIn, checkOut). We
 * intersect the two and express the result as a start column and a span in
 * nights, so the frontend positions the bar with pure arithmetic and never has
 * to re-parse dates.
 */
function toBlock(r: CalendarReservation, windowFrom: Date, totalNights: number): CalendarBlock {
  const windowFromMs = windowFrom.getTime();
  const checkInMs = r.checkIn.getTime();
  const checkOutMs = r.checkOut.getTime();

  // Column of the stay's first visible night, clamped to the window start.
  const rawStart = Math.round((checkInMs - windowFromMs) / MS_PER_NIGHT);
  const startIndex = Math.max(0, rawStart);
  // Column just past the stay's last visible night, clamped to the window end.
  const rawEnd = Math.round((checkOutMs - windowFromMs) / MS_PER_NIGHT);
  const endIndex = Math.min(totalNights, rawEnd);
  const span = Math.max(1, endIndex - startIndex);

  return {
    id: r.id,
    reference: r.reference,
    status: r.status,
    roomId: r.roomId,
    roomTypeId: r.roomTypeId,
    guestName: `${r.guestFirstName} ${r.guestLastName}`.trim(),
    adults: r.adults,
    children: r.children,
    checkIn: toIsoDate(r.checkIn),
    checkOut: toIsoDate(r.checkOut),
    startIndex,
    span,
    continuesBefore: rawStart < 0,
    continuesAfter: rawEnd > totalNights,
  };
}

/**
 * The reservation calendar (tape chart) for a property over [from, to).
 *
 * Read-only: it writes nothing and takes no audit entry. Assembled from three
 * bounded queries — the ACTIVE room types with their rooms, and every occupying
 * reservation overlapping the window — then arranged in TypeScript into rows
 * (rooms) and bars (reservations). Bookings already assigned to a room are
 * grouped under that room; bookings still awaiting a room show in a dedicated
 * "unassigned" lane, which is the front desk's assignment work list.
 */
export async function getCalendar(propertyId: string, query: CalendarQuery): Promise<CalendarView> {
  // Scoped visibility check first: a cross-org property 404s here, exactly like
  // the reservations list and availability grid, rather than returning an empty
  // chart.
  await calendarRepository.assertPropertyVisible(propertyId);

  const [roomTypes, reservations] = await Promise.all([
    calendarRepository.listRoomTypesWithRooms(propertyId),
    calendarRepository.listOccupyingReservations(propertyId, query.from, query.to),
  ]);

  const nights = nightsBetween(query.from, query.to);
  const dates = nights.map(toIsoDate);
  const totalNights = nights.length;

  const assigned: Record<string, CalendarBlock[]> = {};
  const unassigned: CalendarBlock[] = [];

  for (const r of reservations) {
    const block = toBlock(r, query.from, totalNights);
    if (block.roomId) {
      (assigned[block.roomId] ??= []).push(block);
    } else {
      unassigned.push(block);
    }
  }

  return {
    from: toIsoDate(query.from),
    to: toIsoDate(query.to),
    dates,
    roomTypes,
    assigned,
    unassigned,
  };
}
