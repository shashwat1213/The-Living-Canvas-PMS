import { NotFoundError } from '../../lib/http-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { OCCUPYING_STATUSES } from '../reservations/repository.js';

/** One night's sold-room revenue and count, straight from the group-by. */
export interface NightRevenueRow {
  date: Date;
  roomRevenueMinor: number;
  roomsSold: number;
}

/** Payments collected in the window, grouped by method. */
export interface PaymentsByMethodRow {
  method: string;
  amountMinor: number;
  count: number;
}

export const reportsRepository = {
  /** Cross-org property resolves to nothing here → 404, like every sub-route. */
  async assertPropertyVisible(propertyId: string): Promise<void> {
    const property = await scopedPrisma.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }
  },

  /**
   * Per-night room revenue and rooms sold for the property, over [from, to).
   *
   * Reads the authoritative per-night ledger (`ReservationNight`) rather than
   * the reservation total, so revenue lands on the night it was earned and a
   * multi-night stay spanning the window edge is counted only for the nights
   * inside it. Only occupying statuses count — a cancelled or no-show booking
   * earned nothing. One grouped query, not a query per night.
   */
  async nightlyRoomRevenue(propertyId: string, from: Date, to: Date): Promise<NightRevenueRow[]> {
    const rows = await scopedPrisma.reservationNight.groupBy({
      by: ['date'],
      where: {
        date: { gte: from, lt: to },
        reservation: { propertyId, status: OCCUPYING_STATUSES },
      },
      _sum: { amountMinor: true },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      date: r.date,
      roomRevenueMinor: r._sum.amountMinor ?? 0,
      roomsSold: r._count._all,
    }));
  },

  /**
   * Total ACTIVE (sellable) rooms at the property — the denominator for
   * occupancy and RevPAR. Rooms don't carry per-date availability beyond
   * status, so this is the same "sellable capacity" figure the availability
   * grid and the dashboard use.
   */
  countSellableRooms(propertyId: string): Promise<number> {
    return scopedPrisma.room.count({ where: { propertyId, status: 'ACTIVE' } });
  },

  /**
   * Payments recorded at the property in [from, to), grouped by method. This
   * is a cash-basis figure keyed on when the payment was taken (`createdAt`),
   * a different axis from accrued room revenue — a guest may pay before or
   * after the nights they stay. Scoped through folio → reservation → property.
   */
  async paymentsByMethod(propertyId: string, from: Date, to: Date): Promise<PaymentsByMethodRow[]> {
    const rows = await scopedPrisma.payment.groupBy({
      by: ['method'],
      where: {
        createdAt: { gte: from, lt: to },
        folio: { reservation: { propertyId } },
      },
      _sum: { amountMinor: true },
      _count: { _all: true },
    });
    return rows.map((r) => ({
      method: r.method,
      amountMinor: r._sum.amountMinor ?? 0,
      count: r._count._all,
    }));
  },
};
