import { NotFoundError } from '../../lib/http-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { OCCUPYING_STATUSES } from '../reservations/repository.js';

/** A physical room, as the tape chart lists it (one grid row). */
export interface CalendarRoom {
  id: string;
  name: string;
  floor: string | null;
  status: 'ACTIVE' | 'INACTIVE' | 'MAINTENANCE';
  housekeepingStatus: 'DIRTY' | 'CLEANING' | 'CLEAN' | 'INSPECTED';
}

/** An ACTIVE room type with its rooms — a grouped section of the chart. */
export interface CalendarRoomType {
  id: string;
  name: string;
  code: string | null;
  rooms: CalendarRoom[];
}

/** A reservation reduced to what a chart block needs to render and be acted on. */
export interface CalendarReservation {
  id: string;
  reference: string;
  status: 'CONFIRMED' | 'CHECKED_IN' | 'CHECKED_OUT' | 'CANCELLED' | 'NO_SHOW';
  roomId: string | null;
  roomTypeId: string;
  checkIn: Date;
  checkOut: Date;
  adults: number;
  children: number;
  guestFirstName: string;
  guestLastName: string;
}

/**
 * Read-only inventory + booking queries for the reservation calendar (tape
 * chart). Everything is tenant-scoped through `scopedPrisma`, so a
 * cross-organization property id resolves to nothing — the same "no such thing
 * here" 404 signal every other property sub-resource gives.
 */
export const calendarRepository = {
  /**
   * Verify the parent property is visible to the caller first — without this a
   * property in another organization (which an org-wide role passes
   * `requirePropertyAccess` for) would return an empty 200 chart instead of a
   * 404. Mirrors `availabilityRepository.assertPropertyVisible`.
   */
  async assertPropertyVisible(propertyId: string): Promise<void> {
    const property = await scopedPrisma.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }
  },

  /**
   * The ACTIVE room types of the property, each with its rooms — the grouped
   * rows of the chart. Unlike the availability grid (which counts only sellable
   * ACTIVE rooms), the tape chart shows EVERY room including those out of
   * service (INACTIVE/MAINTENANCE): the front desk needs to see that a room
   * exists but can't take a guest, not have it silently vanish from the board.
   * Ordered by type name, then room name, both stable by id.
   */
  listRoomTypesWithRooms(propertyId: string): Promise<CalendarRoomType[]> {
    return scopedPrisma.roomType.findMany({
      where: { propertyId, isActive: true },
      select: {
        id: true,
        name: true,
        code: true,
        rooms: {
          select: { id: true, name: true, floor: true, status: true, housekeepingStatus: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        },
      },
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });
  },

  /**
   * Every occupying reservation whose stay overlaps [from, to), in one query,
   * with the guest name and enough shape to render and act on a chart block. A
   * stay overlaps the window when it starts before the window ends and ends
   * after the window starts — the standard half-open interval overlap. Only
   * occupying statuses (CONFIRMED, CHECKED_IN, CHECKED_OUT) appear; cancelled
   * and no-show bookings never occupied inventory, so they are not on the board.
   */
  async listOccupyingReservations(propertyId: string, from: Date, to: Date): Promise<CalendarReservation[]> {
    const rows = await scopedPrisma.reservation.findMany({
      where: {
        propertyId,
        status: OCCUPYING_STATUSES,
        checkIn: { lt: to },
        checkOut: { gt: from },
      },
      select: {
        id: true,
        reference: true,
        status: true,
        roomId: true,
        roomTypeId: true,
        checkIn: true,
        checkOut: true,
        adults: true,
        children: true,
        guest: { select: { firstName: true, lastName: true } },
      },
      orderBy: [{ checkIn: 'asc' }, { id: 'asc' }],
    });

    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      status: r.status,
      roomId: r.roomId,
      roomTypeId: r.roomTypeId,
      checkIn: r.checkIn,
      checkOut: r.checkOut,
      adults: r.adults,
      children: r.children,
      guestFirstName: r.guest.firstName,
      guestLastName: r.guest.lastName,
    }));
  },
};
