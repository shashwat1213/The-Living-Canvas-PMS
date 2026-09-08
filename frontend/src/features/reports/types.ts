/**
 * Domain types for the revenue & occupancy report, mirroring what
 * `backend/src/modules/reports` returns for a property over a date range.
 * All money is integer INR minor units (paise); dates are date-only
 * `YYYY-MM-DD` strings. The window is half-open: `from` inclusive, `to`
 * exclusive.
 */

/** One night's line in the report. */
export interface ReportNight {
  date: string;
  roomRevenueMinor: number;
  roomsSold: number;
  roomsAvailable: number;
  occupancyPct: number;
  adrMinor: number;
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
    roomRevenueMinor: number;
    roomsSold: number;
    roomNightsAvailable: number;
    occupancyPct: number;
    adrMinor: number;
    revparMinor: number;
    paymentsCollectedMinor: number;
  };
  days: ReportNight[];
  paymentsByMethod: ReportPaymentMethod[];
}

/** How many nights the default report window spans, ending today (inclusive). */
export const DEFAULT_REPORT_NIGHTS = 30;

/** Today as a date-only `YYYY-MM-DD` string, in UTC. */
export function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Adds `days` to a date-only `YYYY-MM-DD` string, staying in UTC so the
 * result never shifts by a day across a local timezone or DST boundary.
 */
export function addDays(date: string, days: number): string {
  const ms = Date.parse(`${date}T00:00:00.000Z`);
  if (Number.isNaN(ms)) return date;
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** Human label for a payment method enum value. */
export const PAYMENT_METHOD_LABEL: Record<string, string> = {
  CASH: 'Cash',
  CARD: 'Card',
  UPI: 'UPI',
  BANK_TRANSFER: 'Bank transfer',
  OTHER: 'Other',
};
