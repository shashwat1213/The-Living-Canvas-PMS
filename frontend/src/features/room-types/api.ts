import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';
import type { CreateRoomTypeInput, RoomType, RoomTypeListParams, UpdateRoomTypeInput } from './types';

/**
 * The only place room-type endpoints are named. Like rooms, they live
 * under a property, so every call takes the `propertyId` that scopes it —
 * the backend resolves that property through the tenant-scoped client
 * before touching a type, which is what makes a cross-organization ID a
 * 404 rather than an empty page.
 */

const base = (propertyId: string) => `/api/v1/properties/${propertyId}/room-types`;

export interface RoomTypeListResult {
  roomTypes: RoomType[];
  page: PageMeta;
}

export function listRoomTypes(propertyId: string, params: RoomTypeListParams = {}): Promise<RoomTypeListResult> {
  return apiFetch<RoomTypeListResult>(`${base(propertyId)}${toQueryString({ ...params })}`);
}

export function createRoomType(propertyId: string, input: CreateRoomTypeInput): Promise<RoomType> {
  return apiFetch<{ roomType: RoomType }>(base(propertyId), { method: 'POST', body: input }).then(
    (res) => res.roomType,
  );
}

export function updateRoomType(
  propertyId: string,
  roomTypeId: string,
  input: UpdateRoomTypeInput,
): Promise<RoomType> {
  return apiFetch<{ roomType: RoomType }>(`${base(propertyId)}/${roomTypeId}`, {
    method: 'PATCH',
    body: input,
  }).then((res) => res.roomType);
}

export function deleteRoomType(propertyId: string, roomTypeId: string): Promise<void> {
  return apiFetch<void>(`${base(propertyId)}/${roomTypeId}`, { method: 'DELETE' });
}
