import { availabilityRepository } from './repository.js';
import type { AvailabilityQuery } from './schemas.js';

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Every night in [from, to) — `to` is exclusive, mirroring a stay's checkOut. */
function nightsBetween(from: Date, to: Date): Date[] {
  const nights: Date[] = [];
  for (let d = new Date(from); d < to; d.setUTCDate(d.getUTCDate() + 1)) {
    nights.push(new Date(d));
  }
  return nights;
}

/** A single night's numbers for one room type. */
export interface RoomTypeDay {
  date: string;
  booked: number;
  available: number;
}

/** A single night's rolled-up numbers across all room types. */
export interface TotalsDay {
  date: string;
  totalRooms: number;
  booked: number;
  available: number;
  occupancyPct: number;
}

export interface RoomTypeAvailability {
  id: string;
  name: string;
  code: string | null;
  totalRooms: number;
  days: RoomTypeDay[];
}

export interface AvailabilityView {
  from: string;
  to: string;
  dates: string[];
  roomTypes: RoomTypeAvailability[];
  totals: { days: TotalsDay[] };
}

/**
 * The availability grid for a property over [from, to).
 *
 * Read-only: it writes nothing and takes no audit entry. The grid is computed
 * in TypeScript from a bounded set of queries — the ACTIVE room-type list, the
 * ACTIVE room counts grouped by type, and every occupying reservation
 * overlapping the window — rather than one query per (type, night) cell.
 *
 * For each night, a room type's `booked` count is the number of occupying
 * reservations of that type whose stay covers that night (checkIn <= night AND
 * checkOut > night — the same half-open convention as the stay itself), and
 * `available` is the sellable rooms of that type minus that, floored at zero.
 */
export async function getAvailability(propertyId: string, query: AvailabilityQuery): Promise<AvailabilityView> {
  // Scoped visibility check first: a cross-org property 404s here, exactly
  // like the reservations list, rather than returning an empty grid.
  await availabilityRepository.assertPropertyVisible(propertyId);

  const [roomTypes, roomCounts, stays] = await Promise.all([
    availabilityRepository.listActiveRoomTypes(propertyId),
    availabilityRepository.activeRoomCountsByType(propertyId),
    availabilityRepository.listOccupyingStays(propertyId, query.from, query.to),
  ]);

  const nights = nightsBetween(query.from, query.to);
  const dates = nights.map(toIsoDate);
  const nightTimes = nights.map((n) => n.getTime());

  // booked[roomTypeId][nightIndex] — one pass over the stays, incrementing
  // every night in the intersection of the stay with the window.
  const bookedByType = new Map<string, number[]>();
  for (const rt of roomTypes) {
    bookedByType.set(rt.id, new Array(nights.length).fill(0));
  }
  for (const stay of stays) {
    const perNight = bookedByType.get(stay.roomTypeId);
    // A stay of a room type that isn't an ACTIVE row (e.g. an archived type)
    // has no row to contribute to; skip it.
    if (!perNight) continue;
    const inStart = stay.checkIn.getTime();
    const inEnd = stay.checkOut.getTime();
    for (let i = 0; i < nightTimes.length; i += 1) {
      const t = nightTimes[i] as number;
      // checkIn <= night AND checkOut > night.
      if (inStart <= t && inEnd > t) {
        perNight[i] = (perNight[i] as number) + 1;
      }
    }
  }

  const roomTypeViews: RoomTypeAvailability[] = roomTypes.map((rt) => {
    const totalRooms = roomCounts.get(rt.id) ?? 0;
    const perNight = bookedByType.get(rt.id) as number[];
    return {
      id: rt.id,
      name: rt.name,
      code: rt.code,
      totalRooms,
      days: dates.map((date, i) => {
        const booked = perNight[i] as number;
        return { date, booked, available: Math.max(0, totalRooms - booked) };
      }),
    };
  });

  const totalsDays: TotalsDay[] = dates.map((date, i) => {
    let totalRooms = 0;
    let booked = 0;
    for (const rt of roomTypeViews) {
      totalRooms += rt.totalRooms;
      booked += (rt.days[i] as RoomTypeDay).booked;
    }
    return {
      date,
      totalRooms,
      booked,
      available: Math.max(0, totalRooms - booked),
      occupancyPct: totalRooms === 0 ? 0 : Math.round((booked / totalRooms) * 100),
    };
  });

  return {
    from: toIsoDate(query.from),
    to: toIsoDate(query.to),
    dates,
    roomTypes: roomTypeViews,
    totals: { days: totalsDays },
  };
}
