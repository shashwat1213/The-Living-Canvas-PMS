import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';
import type {
  CreateRatePlanInput,
  RateEdit,
  RatePlan,
  RatePlanListParams,
  RatesResult,
  UpdateRatePlanInput,
} from './types';

/**
 * The only place rate-plan endpoints are named. Rate plans live under a room
 * type, which lives under a property, so every call carries both ids — the
 * backend resolves that chain through the tenant-scoped client before
 * touching a plan, which is what makes a cross-organization id a 404.
 */
const base = (propertyId: string, roomTypeId: string) =>
  `/api/v1/properties/${propertyId}/room-types/${roomTypeId}/rate-plans`;

export interface RatePlanListResult {
  ratePlans: RatePlan[];
  page: PageMeta;
}

export function listRatePlans(
  propertyId: string,
  roomTypeId: string,
  params: RatePlanListParams = {},
): Promise<RatePlanListResult> {
  return apiFetch<RatePlanListResult>(`${base(propertyId, roomTypeId)}${toQueryString({ ...params })}`);
}

export function createRatePlan(
  propertyId: string,
  roomTypeId: string,
  input: CreateRatePlanInput,
): Promise<RatePlan> {
  return apiFetch<{ ratePlan: RatePlan }>(base(propertyId, roomTypeId), { method: 'POST', body: input }).then(
    (res) => res.ratePlan,
  );
}

export function updateRatePlan(
  propertyId: string,
  roomTypeId: string,
  ratePlanId: string,
  input: UpdateRatePlanInput,
): Promise<RatePlan> {
  return apiFetch<{ ratePlan: RatePlan }>(`${base(propertyId, roomTypeId)}/${ratePlanId}`, {
    method: 'PATCH',
    body: input,
  }).then((res) => res.ratePlan);
}

export function deleteRatePlan(propertyId: string, roomTypeId: string, ratePlanId: string): Promise<void> {
  return apiFetch<void>(`${base(propertyId, roomTypeId)}/${ratePlanId}`, { method: 'DELETE' });
}

export function listRates(
  propertyId: string,
  roomTypeId: string,
  ratePlanId: string,
  from: string,
  to: string,
): Promise<RatesResult> {
  return apiFetch<RatesResult>(
    `${base(propertyId, roomTypeId)}/${ratePlanId}/rates${toQueryString({ from, to })}`,
  );
}

export function setRates(
  propertyId: string,
  roomTypeId: string,
  ratePlanId: string,
  rates: RateEdit[],
): Promise<{ set: number; cleared: number }> {
  return apiFetch<{ set: number; cleared: number }>(`${base(propertyId, roomTypeId)}/${ratePlanId}/rates`, {
    method: 'PUT',
    body: { rates },
  });
}
