/**
 * Domain types for the operational dashboard, mirroring what
 * `backend/src/modules/dashboard` returns for a single property on a date.
 * All money is integer INR minor units (paise); dates are date-only
 * `YYYY-MM-DD` strings, never full timestamps.
 */

/** A reservation as it appears in an arrivals / departures / in-house list. */
export interface DashboardReservation {
  id: string;
  reference: string;
  status: string;
  guest: { id: string; firstName: string; lastName: string };
  roomType: { id: string; name: string };
  room: { id: string; name: string } | null;
  checkIn: string;
  checkOut: string;
}

/** A folio still carrying a positive balance (guest owes money). */
export interface UnsettledFolio {
  id: string;
  reference: string;
  guestName: string;
  balanceMinor: number;
}

export interface DashboardView {
  date: string;
  summary: {
    arrivals: number;
    departures: number;
    inHouse: number;
    occupancyPct: number;
    sellableRooms: number;
    occupiedRooms: number;
    roomsToClean: number;
    roomsOutOfService: number;
    openWorkOrders: number;
    urgentWorkOrders: number;
    unsettledFolios: number;
    unsettledBalanceMinor: number;
  };
  arrivals: DashboardReservation[];
  departures: DashboardReservation[];
  inHouse: DashboardReservation[];
  housekeeping: {
    dirty: number;
    cleaning: number;
    clean: number;
    inspected: number;
    openTasks: number;
  };
  maintenance: {
    open: number;
    urgent: number;
    roomsOutOfService: number;
  };
  unsettledFolioList: UnsettledFolio[];
}

/** Today as a date-only `YYYY-MM-DD` string, in UTC. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Adds `days` to a date-only `YYYY-MM-DD` string, staying in UTC so the
 * result never shifts by a day across a local timezone or DST boundary.
 */
export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return date;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}
