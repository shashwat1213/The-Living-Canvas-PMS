import type { Prisma } from '@prisma/client';

import { NotFoundError } from '../../lib/http-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { OCCUPYING_STATUSES } from '../reservations/repository.js';

/** A reservation as the dashboard's arrival/departure/in-house lists need it. */
const listInclude = {
  guest: { select: { id: true, firstName: true, lastName: true } },
  roomType: { select: { id: true, name: true } },
  room: { select: { id: true, name: true } },
} satisfies Prisma.ReservationInclude;

export type DashboardReservationRow = Prisma.ReservationGetPayload<{ include: typeof listInclude }>;

/** A folio with just enough to derive its balance for the "unsettled" list. */
export interface FolioBalanceRow {
  id: string;
  reservation: { id: string; reference: string; guest: { firstName: string; lastName: string } };
  chargesTotalMinor: number;
  paymentsTotalMinor: number;
}

export const dashboardRepository = {
  /** Cross-org property resolves to nothing here → 404, like every sub-route. */
  async assertPropertyVisible(propertyId: string): Promise<void> {
    const property = await scopedPrisma.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }
  },

  /** Reservations ARRIVING on `date` (checkIn === date), still active (CONFIRMED/CHECKED_IN). */
  listArrivals(propertyId: string, date: Date): Promise<DashboardReservationRow[]> {
    return scopedPrisma.reservation.findMany({
      where: { propertyId, checkIn: date, status: { in: ['CONFIRMED', 'CHECKED_IN'] } },
      include: listInclude,
      orderBy: [{ reference: 'asc' }],
    });
  },

  /** Reservations DEPARTING on `date` (checkOut === date), CHECKED_IN or already CHECKED_OUT. */
  listDepartures(propertyId: string, date: Date): Promise<DashboardReservationRow[]> {
    return scopedPrisma.reservation.findMany({
      where: { propertyId, checkOut: date, status: { in: ['CHECKED_IN', 'CHECKED_OUT'] } },
      include: listInclude,
      orderBy: [{ reference: 'asc' }],
    });
  },

  /** Currently in-house: CHECKED_IN with the stay covering `date` (checkIn <= date < checkOut). */
  listInHouse(propertyId: string, date: Date): Promise<DashboardReservationRow[]> {
    return scopedPrisma.reservation.findMany({
      where: { propertyId, status: 'CHECKED_IN', checkIn: { lte: date }, checkOut: { gt: date } },
      include: listInclude,
      orderBy: [{ reference: 'asc' }],
    });
  },

  /** Total ACTIVE (sellable) rooms at the property. */
  countSellableRooms(propertyId: string): Promise<number> {
    return scopedPrisma.room.count({ where: { propertyId, status: 'ACTIVE' } });
  },

  /** Occupying reservations covering `date` — the numerator of occupancy. */
  countOccupied(propertyId: string, date: Date): Promise<number> {
    return scopedPrisma.reservation.count({
      where: { propertyId, status: OCCUPYING_STATUSES, checkIn: { lte: date }, checkOut: { gt: date } },
    });
  },

  /** Room count grouped by housekeeping condition. */
  async housekeepingCounts(propertyId: string): Promise<Record<string, number>> {
    const rows = await scopedPrisma.room.groupBy({
      by: ['housekeepingStatus'],
      where: { propertyId },
      _count: { _all: true },
    });
    const counts: Record<string, number> = {};
    for (const r of rows) counts[r.housekeepingStatus] = r._count._all;
    return counts;
  },

  /** Open (PENDING/IN_PROGRESS) housekeeping-task count for the property. */
  countOpenHousekeepingTasks(propertyId: string): Promise<number> {
    return scopedPrisma.housekeepingTask.count({
      where: { room: { propertyId }, status: { in: ['PENDING', 'IN_PROGRESS'] } },
    });
  },

  /** Open work-order counts: total open plus how many are URGENT. */
  async maintenanceCounts(propertyId: string): Promise<{ open: number; urgent: number; roomsOutOfService: number }> {
    const [open, urgent, roomsOutOfService] = await Promise.all([
      scopedPrisma.maintenanceWorkOrder.count({ where: { propertyId, status: { in: ['OPEN', 'IN_PROGRESS'] } } }),
      scopedPrisma.maintenanceWorkOrder.count({
        where: { propertyId, status: { in: ['OPEN', 'IN_PROGRESS'] }, priority: 'URGENT' },
      }),
      scopedPrisma.room.count({ where: { propertyId, status: 'MAINTENANCE' } }),
    ]);
    return { open, urgent, roomsOutOfService };
  },

  /**
   * OPEN folios of the property with their charge/payment sums, so the service
   * can derive which ones still carry a balance. Scoped through
   * reservation → property. Only OPEN folios can be unsettled — a closed folio
   * is settled by definition.
   */
  async openFolioBalances(propertyId: string): Promise<FolioBalanceRow[]> {
    const folios = await scopedPrisma.folio.findMany({
      where: { status: 'OPEN', reservation: { propertyId } },
      select: {
        id: true,
        reservation: { select: { id: true, reference: true, guest: { select: { firstName: true, lastName: true } } } },
        charges: { select: { amountMinor: true } },
        payments: { select: { amountMinor: true } },
      },
    });
    return folios.map((f) => ({
      id: f.id,
      reservation: f.reservation,
      chargesTotalMinor: f.charges.reduce((a, c) => a + c.amountMinor, 0),
      paymentsTotalMinor: f.payments.reduce((a, p) => a + p.amountMinor, 0),
    }));
  },
};
