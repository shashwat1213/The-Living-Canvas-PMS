import type { Prisma } from '@prisma/client';

import { NotFoundError } from '../../lib/http-errors.js';
import { buildPageMeta, toSkipTake, type PageMeta } from '../../lib/pagination.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { ListReservationsQuery } from './schemas.js';

/**
 * Every reservation is returned with the things a front desk needs to read it
 * at a glance embedded — the guest, the room type and the rate plan — rather
 * than as bare foreign keys. The per-night breakdown is included only on the
 * single-reservation read, not the list, since a list doesn't need it.
 */
const listInclude = {
  guest: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  roomType: { select: { id: true, name: true, code: true } },
  ratePlan: { select: { id: true, name: true, code: true, isRefundable: true } },
} satisfies Prisma.ReservationInclude;

const detailInclude = {
  ...listInclude,
  nights: { select: { date: true, amountMinor: true }, orderBy: { date: 'asc' } },
  room: { select: { id: true, name: true } },
} satisfies Prisma.ReservationInclude;

export type ReservationListRow = Prisma.ReservationGetPayload<{ include: typeof listInclude }>;
export type ReservationDetail = Prisma.ReservationGetPayload<{ include: typeof detailInclude }>;

/** The reservation statuses that occupy inventory — i.e. count against availability. */
export const OCCUPYING_STATUSES: Prisma.ReservationWhereInput['status'] = {
  in: ['CONFIRMED', 'CHECKED_IN', 'CHECKED_OUT'],
};

function buildWhere(propertyId: string, query: ListReservationsQuery): Prisma.ReservationWhereInput {
  const conditions: Prisma.ReservationWhereInput[] = [{ propertyId }];

  if (query.status) {
    conditions.push({ status: query.status });
  }
  // A stay overlaps [from, to) when it starts before the window ends and ends
  // after the window starts — the standard half-open interval overlap.
  if (query.from) {
    conditions.push({ checkOut: { gt: query.from } });
  }
  if (query.to) {
    conditions.push({ checkIn: { lt: query.to } });
  }
  if (query.search) {
    for (const term of query.search.split(/\s+/).filter(Boolean)) {
      conditions.push({
        OR: [
          { reference: { contains: term, mode: 'insensitive' } },
          { guest: { firstName: { contains: term, mode: 'insensitive' } } },
          { guest: { lastName: { contains: term, mode: 'insensitive' } } },
        ],
      });
    }
  }

  return { AND: conditions };
}

export type ReservationsDb = Pick<
  typeof scopedPrisma,
  'reservation' | 'room' | 'roomType' | 'ratePlan' | 'ratePlanRate' | 'guest'
>;

export const reservationsRepository = {
  async list(
    propertyId: string,
    query: ListReservationsQuery,
  ): Promise<{ items: ReservationListRow[]; page: PageMeta }> {
    // Verify the parent property is visible to the caller first — without
    // this, a property in another organization (which an org-wide role passes
    // `requirePropertyAccess` for) would list as an empty 200 instead of 404,
    // an inconsistent signal next to every other property sub-route. The
    // scoped client makes a cross-org property resolve to nothing here.
    const property = await scopedPrisma.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }

    const where = buildWhere(propertyId, query);
    const { skip, take } = toSkipTake(query);

    const [totalItems, items] = await scopedPrisma.$transaction([
      scopedPrisma.reservation.count({ where }),
      scopedPrisma.reservation.findMany({
        where,
        include: listInclude,
        // Soonest arrivals first — the order a front desk works the day in.
        orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
        skip,
        take,
      }),
    ]);

    return { items, page: buildPageMeta(query, totalItems) };
  },

  findById(propertyId: string, id: string): Promise<ReservationDetail | null> {
    return scopedPrisma.reservation.findFirst({ where: { id, propertyId }, include: detailInclude });
  },

  findByReference(propertyId: string, reference: string): Promise<{ id: string } | null> {
    return scopedPrisma.reservation.findFirst({ where: { propertyId, reference }, select: { id: true } });
  },

  /**
   * Physical, sellable rooms of a type — the inventory ceiling. Only ACTIVE
   * rooms count: a room out of service (INACTIVE/MAINTENANCE) is not sellable
   * capacity, so counting it would let the hotel oversell against rooms it
   * can't actually give a guest.
   */
  countSellableRooms(propertyId: string, roomTypeId: string, db: ReservationsDb = scopedPrisma): Promise<number> {
    return db.room.count({ where: { propertyId, roomTypeId, status: 'ACTIVE' } });
  },

  /**
   * How many occupying reservations of this type overlap [checkIn, checkOut).
   * This is the "already booked" count availability subtracts. `excludeId`
   * lets a future modify-booking flow ignore the reservation being changed;
   * unused on create.
   */
  countOverlapping(
    propertyId: string,
    roomTypeId: string,
    checkIn: Date,
    checkOut: Date,
    db: ReservationsDb = scopedPrisma,
    excludeId?: string,
  ): Promise<number> {
    return db.reservation.count({
      where: {
        propertyId,
        roomTypeId,
        status: OCCUPYING_STATUSES,
        // Half-open overlap: existing.checkIn < new.checkOut AND
        // existing.checkOut > new.checkIn.
        checkIn: { lt: checkOut },
        checkOut: { gt: checkIn },
        ...(excludeId ? { id: { not: excludeId } } : {}),
      },
    });
  },
};
