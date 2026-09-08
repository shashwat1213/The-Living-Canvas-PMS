import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';
import type { CreateWorkOrderInput, UpdateWorkOrderInput, WorkOrder, WorkOrderListParams } from './types';

/**
 * The only place maintenance endpoints are named. Work orders live under a
 * property, so every call carries the property id — the backend resolves it
 * through the tenant-scoped client, which makes a cross-organization property
 * (or work order) a 404 rather than a leak.
 */
const base = (propertyId: string) => `/api/v1/properties/${propertyId}/maintenance/work-orders`;

export interface WorkOrderListResult {
  workOrders: WorkOrder[];
  page: PageMeta;
}

export function listWorkOrders(propertyId: string, params: WorkOrderListParams = {}): Promise<WorkOrderListResult> {
  return apiFetch<WorkOrderListResult>(`${base(propertyId)}${toQueryString({ ...params })}`);
}

export function createWorkOrder(propertyId: string, input: CreateWorkOrderInput): Promise<WorkOrder> {
  return apiFetch<{ workOrder: WorkOrder }>(base(propertyId), { method: 'POST', body: input }).then((res) => res.workOrder);
}

export function updateWorkOrder(propertyId: string, workOrderId: string, input: UpdateWorkOrderInput): Promise<WorkOrder> {
  return apiFetch<{ workOrder: WorkOrder }>(`${base(propertyId)}/${workOrderId}`, {
    method: 'PATCH',
    body: input,
  }).then((res) => res.workOrder);
}
