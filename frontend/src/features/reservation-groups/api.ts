import { apiFetch } from '../../lib/api';
import type {
  CreateBlockInput,
  ReservationGroupDetail,
  ReservationGroupSummary,
} from './types';

const base = (propertyId: string) => `/api/v1/properties/${propertyId}/reservation-groups`;

export function listReservationGroups(propertyId: string): Promise<ReservationGroupSummary[]> {
  return apiFetch<{ groups: ReservationGroupSummary[] }>(base(propertyId)).then((res) => res.groups);
}

export function getReservationGroup(propertyId: string, groupId: string): Promise<ReservationGroupDetail> {
  return apiFetch<{ group: ReservationGroupDetail }>(`${base(propertyId)}/${groupId}`).then((res) => res.group);
}

export function createReservationGroup(propertyId: string, input: CreateBlockInput): Promise<ReservationGroupDetail> {
  return apiFetch<{ group: ReservationGroupDetail }>(base(propertyId), {
    method: 'POST',
    body: input,
  }).then((res) => res.group);
}

export function cancelReservationGroup(propertyId: string, groupId: string, reason?: string): Promise<ReservationGroupDetail> {
  return apiFetch<{ group: ReservationGroupDetail }>(`${base(propertyId)}/${groupId}/cancel`, {
    method: 'POST',
    body: reason ? { reason } : {},
  }).then((res) => res.group);
}
