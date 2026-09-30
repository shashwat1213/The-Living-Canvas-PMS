import { reportsRepository, type MonthlyRow, type NightRevenueRow, type PaymentsByMethodRow } from './repository.js';
import type { MonthlyAnalyticsQuery, ReportQuery } from './schemas.js';

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

/** One month's line in the analytics trend — everything the dashboard charts. */
export interface MonthlyAnalyticsPoint {
  /** First day of the month, ISO (YYYY-MM-01). */
  month: string;
  /** Short label for the axis, e.g. "Oct 2026". */
  label: string;
  /** Accrued room revenue, INR paise. */
  roomRevenueMinor: number;
  /** Settled POS revenue, INR paise. */
  posRevenueMinor: number;
  /** Room + POS revenue, INR paise. */
  grossRevenueMinor: number;
  /** Payments collected (cash basis), INR paise. */
  paymentsCollectedMinor: number;
  /** Refunds issued (cash basis, shown positive), INR paise. */
  refundsMinor: number;
  /** Collected − refunds, INR paise — net cash taken. */
  netCollectedMinor: number;
  roomsSold: number;
  /** Room-nights available: sellableRooms × days in month. */
  roomNightsAvailable: number;
  /** roomsSold / roomNightsAvailable, 0–100. */
  occupancyPct: number;
  /** Average Daily Rate: roomRevenue / roomsSold, 0 when none sold. */
  adrMinor: number;
  /** Revenue per available room: roomRevenue / roomNightsAvailable. */
  revparMinor: number;
}

export interface MonthlyAnalytics {
  from: string;
  to: string;
  sellableRooms: number;
  months: MonthlyAnalyticsPoint[];
  summary: {
    grossRevenueMinor: number;
    roomRevenueMinor: number;
    posRevenueMinor: number;
    netCollectedMinor: number;
    refundsMinor: number;
    occupancyPct: number;
    adrMinor: number;
    revparMinor: number;
    /** Month-over-month gross-revenue change vs the previous month, %, or null. */
    revenueMomPct: number | null;
  };
}

const MONTH_LABELS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** Days in the calendar month that `d` falls in (UTC). */
function daysInMonth(year: number, monthIndex: number): number {
  return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
}

/**
 * Monthly performance analytics — the board-grade revenue trend the dashboard
 * charts. Real figures only: room revenue is accrual (per-night ledger), POS is
 * settled orders, and collections/refunds are cash basis. Deliberately *not* a
 * profit-and-loss: the system has no expense ledger, so it reports revenue,
 * occupancy and the standard hotel yield metrics (ADR, RevPAR) — never an
 * invented cost or margin. Zero-filled so every month in the window is a point.
 */
export async function getMonthlyAnalytics(propertyId: string, query: MonthlyAnalyticsQuery): Promise<MonthlyAnalytics> {
  await reportsRepository.assertPropertyVisible(propertyId);

  // Window: first day of (current month − months + 1) up to first day of next
  // month, all in UTC, so the current partial month is included.
  const now = new Date();
  const curYear = now.getUTCFullYear();
  const curMonth = now.getUTCMonth();
  const from = new Date(Date.UTC(curYear, curMonth - (query.months - 1), 1));
  const to = new Date(Date.UTC(curYear, curMonth + 1, 1));

  const [rollup, sellableRooms] = await Promise.all([
    reportsRepository.monthlyRollup(propertyId, from, to),
    reportsRepository.countSellableRooms(propertyId),
  ]);

  const byMonth = new Map<string, MonthlyRow>();
  for (const r of rollup) byMonth.set(r.month, r);

  const months: MonthlyAnalyticsPoint[] = [];
  for (let i = 0; i < query.months; i += 1) {
    const d = new Date(Date.UTC(curYear, curMonth - (query.months - 1) + i, 1));
    const iso = toIsoDate(d);
    const row = byMonth.get(iso);
    const roomRevenueMinor = row?.roomRevenueMinor ?? 0;
    const posRevenueMinor = row?.posRevenueMinor ?? 0;
    const roomsSold = row?.roomsSold ?? 0;
    const collected = row?.paymentsCollectedMinor ?? 0;
    const refunds = row?.refundsMinor ?? 0;
    const roomNightsAvailable = sellableRooms * daysInMonth(d.getUTCFullYear(), d.getUTCMonth());
    months.push({
      month: iso,
      label: `${MONTH_LABELS[d.getUTCMonth()]} ${d.getUTCFullYear()}`,
      roomRevenueMinor,
      posRevenueMinor,
      grossRevenueMinor: roomRevenueMinor + posRevenueMinor,
      paymentsCollectedMinor: collected,
      refundsMinor: refunds,
      netCollectedMinor: collected - refunds,
      roomsSold,
      roomNightsAvailable,
      occupancyPct: occupancy(roomsSold, roomNightsAvailable),
      adrMinor: ratePerUnit(roomRevenueMinor, roomsSold),
      revparMinor: ratePerUnit(roomRevenueMinor, roomNightsAvailable),
    });
  }

  const roomRevenueMinor = months.reduce((a, m) => a + m.roomRevenueMinor, 0);
  const posRevenueMinor = months.reduce((a, m) => a + m.posRevenueMinor, 0);
  const roomsSold = months.reduce((a, m) => a + m.roomsSold, 0);
  const roomNightsAvailable = months.reduce((a, m) => a + m.roomNightsAvailable, 0);
  const refundsMinor = months.reduce((a, m) => a + m.refundsMinor, 0);
  const netCollectedMinor = months.reduce((a, m) => a + m.netCollectedMinor, 0);

  // Month-over-month gross revenue change: last full comparison in the window.
  const n = months.length;
  let revenueMomPct: number | null = null;
  const prevMonth = months[n - 2];
  const lastMonth = months[n - 1];
  if (prevMonth && lastMonth) {
    const prev = prevMonth.grossRevenueMinor;
    const last = lastMonth.grossRevenueMinor;
    revenueMomPct = prev === 0 ? null : Math.round(((last - prev) / prev) * 100);
  }

  return {
    from: toIsoDate(from),
    to: toIsoDate(to),
    sellableRooms,
    months,
    summary: {
      grossRevenueMinor: roomRevenueMinor + posRevenueMinor,
      roomRevenueMinor,
      posRevenueMinor,
      netCollectedMinor,
      refundsMinor,
      occupancyPct: occupancy(roomsSold, roomNightsAvailable),
      adrMinor: ratePerUnit(roomRevenueMinor, roomsSold),
      revparMinor: ratePerUnit(roomRevenueMinor, roomNightsAvailable),
      revenueMomPct,
    },
  };
}
