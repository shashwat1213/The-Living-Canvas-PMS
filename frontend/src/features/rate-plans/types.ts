/**
 * Domain types for rate plans, mirroring what
 * `backend/src/modules/rate-plans` returns and accepts.
 */

export interface RatePlan {
  id: string;
  roomTypeId: string;
  name: string;
  code: string | null;
  description: string | null;
  isRefundable: boolean;
  isActive: boolean;
  /** How many calendar dates currently have a price set on this plan. */
  pricedDates: number;
  createdAt: string;
  updatedAt: string;
}

/** One night's price on a plan, in INR minor units (paise). */
export interface RatePlanRate {
  date: string; // YYYY-MM-DD
  amountMinor: number;
}

export interface RatesResult {
  ratePlanId: string;
  from: string;
  to: string;
  rates: RatePlanRate[];
}

/** Server-side filters for the rate-plan list. */
export interface RatePlanListParams {
  search?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  page?: number;
  pageSize?: number;
}

export interface CreateRatePlanInput {
  name: string;
  code?: string;
  description?: string;
  isRefundable?: boolean;
  isActive?: boolean;
}

export type UpdateRatePlanInput = Partial<{
  name: string;
  code: string | null;
  description: string | null;
  isRefundable: boolean;
  isActive: boolean;
}>;

/** One row of a bulk rate edit. `amountMinor: null` clears that date. */
export interface RateEdit {
  date: string;
  amountMinor: number | null;
}

// Mirrors backend/src/modules/rate-plans/schemas.ts so the dialog can reject
// input before a round-trip. The server still re-validates.
export const RATE_PLAN_CODE_PATTERN = /^[A-Za-z0-9-]+$/;
export const RATE_PLAN_CODE_MAX_LENGTH = 12;
export const RATE_PLAN_NAME_MAX_LENGTH = 80;
export const RATE_PLAN_DESCRIPTION_MAX_LENGTH = 1000;
/** ₹1,000,000.00 per night ceiling (100,000,000 paise), matching the API. */
export const RATE_MAX_MINOR = 1_000_000_00;

export function ratePlanStatusLabel(plan: RatePlan): string {
  return plan.isActive ? 'Active' : 'Retired';
}
