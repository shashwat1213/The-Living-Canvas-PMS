/**
 * Types for the monthly performance analytics that power the dashboard charts.
 * Mirrors `backend/src/modules/reports` (getMonthlyAnalytics). All money is
 * integer INR paise. These are REVENUE analytics (room + POS, occupancy, ADR,
 * RevPAR, collections vs refunds) — not a profit-and-loss: the system has no
 * expense ledger, so no cost or margin is reported or invented.
 */

export interface MonthlyPoint {
  month: string; // YYYY-MM-01
  label: string; // "Oct 2026"
  roomRevenueMinor: number;
  posRevenueMinor: number;
  grossRevenueMinor: number;
  paymentsCollectedMinor: number;
  refundsMinor: number;
  netCollectedMinor: number;
  roomsSold: number;
  roomNightsAvailable: number;
  occupancyPct: number;
  adrMinor: number;
  revparMinor: number;
}

export interface MonthlyAnalytics {
  from: string;
  to: string;
  sellableRooms: number;
  months: MonthlyPoint[];
  summary: {
    grossRevenueMinor: number;
    roomRevenueMinor: number;
    posRevenueMinor: number;
    netCollectedMinor: number;
    refundsMinor: number;
    occupancyPct: number;
    adrMinor: number;
    revparMinor: number;
    revenueMomPct: number | null;
  };
}
