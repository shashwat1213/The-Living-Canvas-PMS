import { NotFoundError } from '../../lib/http-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { OCCUPYING_STATUSES } from '../reservations/repository.js';

/** A displayable availability row: an ACTIVE room type of the property. */
export interface AvailabilityRoomType {
  id: string;
  name: string;
  code: string | null;
}

/** An inventory-occupying stay, reduced to the fields the grid needs. */
export interface OccupyingStay {
  roomTypeId: string;
  checkIn: Date;
  checkOut: Date;
}

/**
 * Read-only inventory queries for the availability grid. Everything is
 * tenant-scoped through `scopedPrisma`, so a cross-organization property id
 * resolves to nothing — the same "no such thing here" signal every other
 * property sub-resource gives.
 */
export const availabilityRepository = {
  /**
   * Verify the parent property is visible to the caller first — without this,
   * a property in another organization (which an org-wide role passes
   * `requirePropertyAccess` for) would return an empty 200 grid instead of a
   * 404, an inconsistent signal next to every other property sub-route. The
   * scoped client makes a cross-org property resolve to nothing here. Mirrors
   * `reservationsRepository.list`.
   */
  async assertPropertyVisible(propertyId: string): Promise<void> {
    const property = await scopedPrisma.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }
  },

  /**
   * The ACTIVE room types of the property — the rows of the grid — ordered by
   * name then id. An archived (inactive) room type is not sellable inventory,
   * so it doesn't appear.
   */
  listActiveRoomTypes(propertyId: string): Promise<AvailabilityRoomType[]> {
    return scopedPrisma.roomType.findMany({
      where: { propertyId, isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  },

  /**
   * Count of ACTIVE (sellable) rooms per room type, in one grouped query. A
   * room out of service (INACTIVE/MAINTENANCE) is not sellable capacity, so it
   * is excluded — counting it would let the hotel oversell against rooms it
   * can't actually give a guest.
   */
  async activeRoomCountsByType(propertyId: string): Promise<Map<string, number>> {
    const rows = await scopedPrisma.room.groupBy({
      by: ['roomTypeId'],
      where: { propertyId, status: 'ACTIVE' },
      _count: { _all: true },
    });
    return new Map(rows.map((r) => [r.roomTypeId, r._count._all]));
  },

  /**
   * Every occupying reservation whose stay overlaps [from, to), in one query.
   * A stay overlaps the window when it starts before the window ends and ends
   * after the window starts — the standard half-open interval overlap. Only
   * occupying statuses (CONFIRMED, CHECKED_IN, CHECKED_OUT) count against
   * inventory; the caller intersects each stay with the window per night.
   */
  listOccupyingStays(propertyId: string, from: Date, to: Date): Promise<OccupyingStay[]> {
    return scopedPrisma.reservation.findMany({
      where: {
        propertyId,
        status: OCCUPYING_STATUSES,
        checkIn: { lt: to },
        checkOut: { gt: from },
      },
      select: { roomTypeId: true, checkIn: true, checkOut: true },
    });
  },
};
