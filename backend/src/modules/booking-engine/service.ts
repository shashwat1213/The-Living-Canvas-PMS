import { NotFoundError } from '../../lib/http-errors.js';
import { prisma } from '../../lib/prisma.js';
import { systemContextForOrganization } from '../../platform/jobs/system-context.js';
import { runWithRequestContext } from '../../platform/tenancy/context.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import { createReservation, quoteStay } from '../reservations/service.js';
import { createGuest } from '../guests/service.js';
import type { BookRequest, SearchQuery } from './schemas.js';

/**
 * The guest-facing booking engine.
 *
 * This is the one public, UNAUTHENTICATED surface of the system, so it works
 * differently from every staff module: there is no access token and thus no
 * tenant request context to resolve from. Instead each call resolves the
 * property from its public `slug` using the UNSCOPED client, then runs all
 * tenant-scoped work inside a system request context for that property's
 * organization (the same mechanism the job worker uses). That keeps every
 * downstream query correctly scoped to exactly one organization while letting
 * us reuse the audited, transactional staff services (`quoteStay`,
 * `createGuest`, `createReservation`) rather than re-implementing booking.
 *
 * Only a deliberately small, public-safe projection is ever returned — never
 * internal ids beyond what the client must echo back to book, never other
 * tenants' data, never credentials.
 */

/** Public view of a bookable property. */
export interface PublicProperty {
  slug: string;
  name: string;
  addressLine1: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

/** A bookable option returned by search: a room type, its cheapest rate plan
 * for the window, the total price, and how many rooms are left. */
export interface BookableOption {
  roomTypeId: string;
  roomTypeName: string;
  description: string | null;
  ratePlanId: string;
  ratePlanName: string;
  nights: number;
  totalMinor: number;
  avgNightlyMinor: number;
  roomsLeft: number;
}

export interface SearchResult {
  property: PublicProperty;
  checkIn: string;
  checkOut: string;
  options: BookableOption[];
}

function toIso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Resolve a property by its public slug using the unscoped client (there is no
 * tenant context yet). Returns the id + organizationId needed to build a system
 * context, plus the public projection. A slug that doesn't exist 404s.
 */
async function resolveBySlug(slug: string): Promise<{ id: string; organizationId: string; publicView: PublicProperty }> {
  const property = await prisma.property.findFirst({
    where: { slug },
    select: {
      id: true,
      organizationId: true,
      name: true,
      slug: true,
      addressLine1: true,
      city: true,
      region: true,
      country: true,
    },
  });
  if (!property) {
    throw new NotFoundError('Property not found.');
  }
  return {
    id: property.id,
    organizationId: property.organizationId,
    publicView: {
      slug: property.slug,
      name: property.name,
      addressLine1: property.addressLine1,
      city: property.city,
      region: property.region,
      country: property.country,
    },
  };
}

/** The public property page (no dates): name, location, description. */
export async function getPublicProperty(slug: string): Promise<PublicProperty> {
  const { publicView } = await resolveBySlug(slug);
  return publicView;
}

/**
 * Search bookable options for a property over a date window. For each active
 * room type we price every one of its rate plans for the stay and keep the
 * cheapest that is fully priced and has availability, so the guest sees one
 * clean "from ₹X" option per room type. Room types with no priced/available
 * option for the window are omitted.
 */
export async function search(slug: string, query: SearchQuery): Promise<SearchResult> {
  const { id: propertyId, organizationId, publicView } = await resolveBySlug(slug);

  const options = await runWithRequestContext(systemContextForOrganization(organizationId), async () => {
    const roomTypes = await scopedPrisma.roomType.findMany({
      where: { propertyId, isActive: true },
      select: { id: true, name: true, description: true },
      orderBy: { name: 'asc' },
    });

    const out: BookableOption[] = [];
    for (const rt of roomTypes) {
      const ratePlans = await scopedPrisma.ratePlan.findMany({
        where: { roomTypeId: rt.id, isActive: true },
        select: { id: true, name: true },
      });

      let best: BookableOption | null = null;
      for (const rp of ratePlans) {
        try {
          const quote = await quoteStay(propertyId, {
            roomTypeId: rt.id,
            ratePlanId: rp.id,
            checkIn: query.checkIn,
            checkOut: query.checkOut,
          });
          if (!quote.available) continue;
          const roomsLeft = quote.sellableRooms - quote.booked;
          const candidate: BookableOption = {
            roomTypeId: rt.id,
            roomTypeName: rt.name,
            description: rt.description,
            ratePlanId: rp.id,
            ratePlanName: rp.name,
            nights: quote.nights,
            totalMinor: quote.totalMinor,
            avgNightlyMinor: quote.nights > 0 ? Math.round(quote.totalMinor / quote.nights) : 0,
            roomsLeft,
          };
          if (!best || candidate.totalMinor < best.totalMinor) best = candidate;
        } catch {
          // A rate plan with no price set for the whole window (priceStay
          // throws) simply isn't bookable for these dates — skip it.
          continue;
        }
      }
      if (best) out.push(best);
    }
    // Cheapest options first.
    out.sort((a, b) => a.totalMinor - b.totalMinor);
    return out;
  });

  return { property: publicView, checkIn: toIso(query.checkIn), checkOut: toIso(query.checkOut), options };
}

/** What the guest gets back after a successful booking. */
export interface BookingConfirmation {
  reference: string;
  propertyName: string;
  roomTypeName: string;
  checkIn: string;
  checkOut: string;
  nights: number;
  totalMinor: number;
  guestName: string;
}

/**
 * Create a booking from the public engine. Resolves the property by slug, then
 * inside the property's system context: creates (or records) the guest and
 * creates a CONFIRMED reservation through the same audited, Serializable
 * `createReservation` the front desk uses — so pricing and availability are
 * re-validated and re-priced server-side at commit time (the client's quoted
 * price is never trusted), overselling is impossible, and the guest's booking
 * confirmation is queued exactly as a staff-made booking's is.
 */
export async function book(slug: string, input: BookRequest): Promise<BookingConfirmation> {
  const { id: propertyId, organizationId, publicView } = await resolveBySlug(slug);

  return runWithRequestContext(systemContextForOrganization(organizationId), async () => {
    const guest = await createGuest({
      firstName: input.guest.firstName,
      lastName: input.guest.lastName,
      ...(input.guest.email ? { email: input.guest.email } : {}),
      ...(input.guest.phone ? { phone: input.guest.phone } : {}),
    });

    const reservation = await createReservation(propertyId, {
      guestId: guest.id,
      roomTypeId: input.roomTypeId,
      ratePlanId: input.ratePlanId,
      checkIn: input.checkIn,
      checkOut: input.checkOut,
      ...(input.adults ? { adults: input.adults } : {}),
      ...(input.children !== undefined ? { children: input.children } : {}),
      ...(input.notes ? { notes: input.notes } : {}),
    });

    return {
      reference: reservation.reference,
      propertyName: publicView.name,
      roomTypeName: reservation.roomType?.name ?? '',
      checkIn: reservation.checkIn,
      checkOut: reservation.checkOut,
      nights: reservation.nights.length,
      totalMinor: reservation.totalAmountMinor,
      guestName: `${input.guest.firstName} ${input.guest.lastName}`.trim(),
    };
  });
}
