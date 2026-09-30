import { NotFoundError } from '../../lib/http-errors.js';
import { Prisma } from '@prisma/client';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { OCCUPYING_STATUSES } from '../reservations/repository.js';

/** One night's sold-room revenue and count, straight from the group-by. */
export interface NightRevenueRow {
  date: Date;
  roomRevenueMinor: number;
  roomsSold: number;
}

/** One calendar month's aggregated performance, from the monthly roll-ups. */
export interface MonthlyRow {
  /** First day of the month, ISO date (YYYY-MM-01). */
  month: string;
  roomRevenueMinor: number;
  posRevenueMinor: number;
  roomsSold: number;
  paymentsCollectedMinor: number;
  refundsMinor: number;
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

  /**
   * Monthly performance roll-ups for the property over [from, to): room
   * revenue + rooms sold (accrual, from the per-night ledger), POS revenue
   * (settled orders), and payments collected vs refunds (cash basis). Each is a
   * single `date_trunc('month')` aggregate in Postgres rather than a per-month
   * round-trip.
   *
   * Raw SQL bypasses the tenant-scoping Prisma extension, so `propertyId` is
   * bound explicitly in every WHERE (and is already tenant-verified by
   * `assertPropertyVisible` before this runs) — the isolation guarantee is
   * preserved, not weakened.
   */
  async monthlyRollup(propertyId: string, from: Date, to: Date): Promise<MonthlyRow[]> {
    // Room revenue + rooms sold, from the authoritative per-night ledger.
    const roomRows = await scopedPrisma.$queryRaw<{ month: Date; revenue: bigint; sold: bigint }[]>(Prisma.sql`
      SELECT date_trunc('month', rn.date) AS month,
             COALESCE(SUM(rn.amount_minor), 0) AS revenue,
             COUNT(*) AS sold
        FROM reservation_nights rn
        JOIN reservations r ON r.id = rn.reservation_id
       WHERE r.property_id = ${propertyId}
         AND r.status IN ('CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT')
         AND rn.date >= ${from} AND rn.date < ${to}
       GROUP BY 1`);

    // POS revenue from settled (CHARGED/PAID) orders, by settlement month.
    const posRows = await scopedPrisma.$queryRaw<{ month: Date; revenue: bigint }[]>(Prisma.sql`
      SELECT date_trunc('month', COALESCE(po.settled_at, po.created_at)) AS month,
             COALESCE(SUM(po.total_minor), 0) AS revenue
        FROM pos_orders po
       WHERE po.property_id = ${propertyId}
         AND po.status IN ('CHARGED', 'PAID')
         AND COALESCE(po.settled_at, po.created_at) >= ${from}
         AND COALESCE(po.settled_at, po.created_at) < ${to}
       GROUP BY 1`);

    // Payments collected (positive) vs refunds (negative), cash basis, by month.
    const payRows = await scopedPrisma.$queryRaw<{ month: Date; collected: bigint; refunds: bigint }[]>(Prisma.sql`
      SELECT date_trunc('month', p.created_at) AS month,
             COALESCE(SUM(CASE WHEN p.amount_minor > 0 THEN p.amount_minor ELSE 0 END), 0) AS collected,
             COALESCE(SUM(CASE WHEN p.amount_minor < 0 THEN -p.amount_minor ELSE 0 END), 0) AS refunds
        FROM payments p
        JOIN folios f ON f.id = p.folio_id
        JOIN reservations r ON r.id = f.reservation_id
       WHERE r.property_id = ${propertyId}
         AND p.created_at >= ${from} AND p.created_at < ${to}
       GROUP BY 1`);

    const iso = (d: Date) => d.toISOString().slice(0, 10);
    const byMonth = new Map<string, MonthlyRow>();
    const ensure = (m: Date): MonthlyRow => {
      const key = iso(m);
      let row = byMonth.get(key);
      if (!row) {
        row = { month: key, roomRevenueMinor: 0, posRevenueMinor: 0, roomsSold: 0, paymentsCollectedMinor: 0, refundsMinor: 0 };
        byMonth.set(key, row);
      }
      return row;
    };
    for (const r of roomRows) {
      const row = ensure(r.month);
      row.roomRevenueMinor = Number(r.revenue);
      row.roomsSold = Number(r.sold);
    }
    for (const r of posRows) ensure(r.month).posRevenueMinor = Number(r.revenue);
    for (const r of payRows) {
      const row = ensure(r.month);
      row.paymentsCollectedMinor = Number(r.collected);
      row.refundsMinor = Number(r.refunds);
    }
    return [...byMonth.values()];
  },
};
