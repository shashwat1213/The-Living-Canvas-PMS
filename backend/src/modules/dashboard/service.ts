import { dashboardRepository, type DashboardReservationRow, type FolioBalanceRow } from './repository.js';

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** A reservation as it appears in an arrivals/departures/in-house list. */
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
  /** Headline counters for the top of the cockpit. */
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

function serializeReservation(row: DashboardReservationRow): DashboardReservation {
  return {
    id: row.id,
    reference: row.reference,
    status: row.status,
    guest: row.guest,
    roomType: row.roomType,
    room: row.room,
    checkIn: toIsoDate(row.checkIn),
    checkOut: toIsoDate(row.checkOut),
  };
}

/**
 * The operational dashboard for a property on a date (default today): the
 * front desk's daily cockpit. Read-only and computed from a bounded set of
 * parallel queries across reservations, rooms, housekeeping and maintenance —
 * it writes nothing and takes no audit entry. A cross-org property 404s, like
 * every other property sub-route.
 */
export async function getDashboard(propertyId: string, dateStr: string | undefined): Promise<DashboardView> {
  await dashboardRepository.assertPropertyVisible(propertyId);

  const date = dateStr ? new Date(`${dateStr}T00:00:00.000Z`) : new Date(`${toIsoDate(new Date())}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    // Defensive — the schema regex already guards format; this catches an
    // impossible calendar date like 2026-13-40.
    throw new Error('Invalid date.');
  }

  const [arrivals, departures, inHouse, sellableRooms, occupiedRooms, hkCounts, openHkTasks, mxCounts, openFolios] =
    await Promise.all([
      dashboardRepository.listArrivals(propertyId, date),
      dashboardRepository.listDepartures(propertyId, date),
      dashboardRepository.listInHouse(propertyId, date),
      dashboardRepository.countSellableRooms(propertyId),
      dashboardRepository.countOccupied(propertyId, date),
      dashboardRepository.housekeepingCounts(propertyId),
      dashboardRepository.countOpenHousekeepingTasks(propertyId),
      dashboardRepository.maintenanceCounts(propertyId),
      dashboardRepository.openFolioBalances(propertyId),
    ]);

  // A folio is unsettled when the guest still owes (positive balance). A zero
  // or credit (overpaid) balance is not chased on this list.
  const unsettled = openFolios
    .map((f: FolioBalanceRow) => ({
      id: f.id,
      reference: f.reservation.reference,
      guestName: `${f.reservation.guest.firstName} ${f.reservation.guest.lastName}`,
      balanceMinor: f.chargesTotalMinor - f.paymentsTotalMinor,
    }))
    .filter((f) => f.balanceMinor > 0)
    .sort((a, b) => b.balanceMinor - a.balanceMinor);

  const housekeeping = {
    dirty: hkCounts.DIRTY ?? 0,
    cleaning: hkCounts.CLEANING ?? 0,
    clean: hkCounts.CLEAN ?? 0,
    inspected: hkCounts.INSPECTED ?? 0,
    openTasks: openHkTasks,
  };

  const roomsToClean = housekeeping.dirty + housekeeping.cleaning;
  const unsettledBalanceMinor = unsettled.reduce((a, f) => a + f.balanceMinor, 0);

  return {
    date: toIsoDate(date),
    summary: {
      arrivals: arrivals.length,
      departures: departures.length,
      inHouse: inHouse.length,
      occupancyPct: sellableRooms === 0 ? 0 : Math.round((occupiedRooms / sellableRooms) * 100),
      sellableRooms,
      occupiedRooms,
      roomsToClean,
      roomsOutOfService: mxCounts.roomsOutOfService,
      openWorkOrders: mxCounts.open,
      urgentWorkOrders: mxCounts.urgent,
      unsettledFolios: unsettled.length,
      unsettledBalanceMinor,
    },
    arrivals: arrivals.map(serializeReservation),
    departures: departures.map(serializeReservation),
    inHouse: inHouse.map(serializeReservation),
    housekeeping,
    maintenance: mxCounts,
    unsettledFolioList: unsettled,
  };
}
