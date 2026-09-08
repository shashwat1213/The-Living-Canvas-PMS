import { reportsRepository, type NightRevenueRow, type PaymentsByMethodRow } from './repository.js';
import type { ReportQuery } from './schemas.js';

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

/** One night's line in the revenue/occupancy report. */
export interface ReportNight {
  date: string;
  /** Room revenue earned that night, INR paise (occupying reservations only). */
  roomRevenueMinor: number;
  /** Rooms sold (occupied) that night. */
  roomsSold: number;
  /** Sellable rooms that night — the property's ACTIVE room count. */
  roomsAvailable: number;
  /** roomsSold / roomsAvailable, 0–100, rounded. */
  occupancyPct: number;
  /** Average Daily Rate that night: roomRevenue / roomsSold, 0 when none sold. */
  adrMinor: number;
  /** Revenue per available room that night: roomRevenue / roomsAvailable. */
  revparMinor: number;
}

/** A payment-method row in the collected-payments breakdown. */
export interface ReportPaymentMethod {
  method: string;
  amountMinor: number;
  count: number;
}

export interface RevenueReport {
  from: string;
  to: string;
  nights: number;
  sellableRooms: number;
  summary: {
    /** Total room revenue across the window, INR paise (accrual basis). */
    roomRevenueMinor: number;
    /** Room-nights sold across the window. */
    roomsSold: number;
    /** Room-nights available: sellableRooms × nights. */
    roomNightsAvailable: number;
    /** Overall occupancy: roomsSold / roomNightsAvailable, 0–100. */
    occupancyPct: number;
    /** Portfolio ADR: roomRevenue / roomsSold, 0 when nothing sold. */
    adrMinor: number;
    /** Portfolio RevPAR: roomRevenue / roomNightsAvailable. */
    revparMinor: number;
    /** Total payments collected in the window (cash basis), INR paise. */
    paymentsCollectedMinor: number;
  };
  days: ReportNight[];
  paymentsByMethod: ReportPaymentMethod[];
}

/** Integer-paise division rounded to the nearest paisa; 0 when the divisor is 0. */
function ratePerUnit(totalMinor: number, units: number): number {
  return units === 0 ? 0 : Math.round(totalMinor / units);
}

function occupancy(sold: number, available: number): number {
  return available === 0 ? 0 : Math.round((sold / available) * 100);
}

/**
 * A property's revenue & occupancy report over [from, to): the manager's
 * night-audit / flash view. Room revenue is accrual-based (earned per stay
 * night from the locked per-night ledger), while payments collected is
 * cash-based (when money was taken) — the two are deliberately separate axes
 * and are never conflated. Read-only and computed from a bounded set of
 * grouped queries; it writes nothing and takes no audit entry. A cross-org
 * property 404s, like every other property sub-route.
 */
export async function getRevenueReport(propertyId: string, query: ReportQuery): Promise<RevenueReport> {
  await reportsRepository.assertPropertyVisible(propertyId);

  const { from, to } = query;
  const [revenueRows, sellableRooms, paymentRows] = await Promise.all([
    reportsRepository.nightlyRoomRevenue(propertyId, from, to),
    reportsRepository.countSellableRooms(propertyId),
    reportsRepository.paymentsByMethod(propertyId, from, to),
  ]);

  const byDate = new Map<string, NightRevenueRow>();
  for (const row of revenueRows) byDate.set(toIsoDate(row.date), row);

  // Zero-fill every night in the window so the series is continuous — a night
  // with no sales is a real data point (0% occupancy), not a gap.
  const days: ReportNight[] = nightsBetween(from, to).map((night) => {
    const iso = toIsoDate(night);
    const row = byDate.get(iso);
    const roomRevenueMinor = row?.roomRevenueMinor ?? 0;
    const roomsSold = row?.roomsSold ?? 0;
    return {
      date: iso,
      roomRevenueMinor,
      roomsSold,
      roomsAvailable: sellableRooms,
      occupancyPct: occupancy(roomsSold, sellableRooms),
      adrMinor: ratePerUnit(roomRevenueMinor, roomsSold),
      revparMinor: ratePerUnit(roomRevenueMinor, sellableRooms),
    };
  });

  const nights = days.length;
  const roomRevenueMinor = days.reduce((a, d) => a + d.roomRevenueMinor, 0);
  const roomsSold = days.reduce((a, d) => a + d.roomsSold, 0);
  const roomNightsAvailable = sellableRooms * nights;
  const paymentsByMethod: ReportPaymentMethod[] = paymentRows
    .map((r: PaymentsByMethodRow) => ({ method: r.method, amountMinor: r.amountMinor, count: r.count }))
    .sort((a, b) => b.amountMinor - a.amountMinor);
  const paymentsCollectedMinor = paymentsByMethod.reduce((a, p) => a + p.amountMinor, 0);

  return {
    from: toIsoDate(from),
    to: toIsoDate(to),
    nights,
    sellableRooms,
    summary: {
      roomRevenueMinor,
      roomsSold,
      roomNightsAvailable,
      occupancyPct: occupancy(roomsSold, roomNightsAvailable),
      adrMinor: ratePerUnit(roomRevenueMinor, roomsSold),
      revparMinor: ratePerUnit(roomRevenueMinor, roomNightsAvailable),
      paymentsCollectedMinor,
    },
    days,
    paymentsByMethod,
  };
}
