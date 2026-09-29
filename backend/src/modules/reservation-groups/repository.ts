import { NotFoundError } from '../../lib/http-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { Prisma } from '@prisma/client';

/** A block header with its child bookings, as the group detail view returns it. */
const groupInclude = {
  contactGuest: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
  reservations: {
    select: {
      id: true,
      reference: true,
      status: true,
      roomTypeId: true,
      roomId: true,
      guestId: true,
      checkIn: true,
      checkOut: true,
      totalAmountMinor: true,
      guest: { select: { id: true, firstName: true, lastName: true } },
      roomType: { select: { id: true, name: true, code: true } },
      room: { select: { id: true, name: true } },
    },
    orderBy: [{ checkIn: 'asc' }, { reference: 'asc' }],
  },
} satisfies Prisma.ReservationGroupInclude;

export const reservationGroupsRepository = {
  /** Cross-org property resolves to nothing here, mirroring every property sub-route. */
  async assertPropertyVisible(propertyId: string): Promise<void> {
    const property = await scopedPrisma.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }
  },

  /** A block with its children, scoped to the property. */
  findById(propertyId: string, id: string) {
    return scopedPrisma.reservationGroup.findFirst({ where: { id, propertyId }, include: groupInclude });
  },

  /** All blocks at a property, newest first, with a room count. */
  list(propertyId: string) {
    return scopedPrisma.reservationGroup.findMany({
      where: { propertyId },
      select: {
        id: true,
        name: true,
        reference: true,
        notes: true,
        createdAt: true,
        contactGuest: { select: { id: true, firstName: true, lastName: true } },
        _count: { select: { reservations: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  },
};
