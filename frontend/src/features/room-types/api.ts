import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';
import type { RoomType, RoomTypeListParams } from './types';

/**
 * The only place room-type endpoints are named. Like rooms, they live
 * under a property, so every call takes the `propertyId` that scopes it.
 *
 * Only the read used by the room dialog is here. The management screens
 * are task 2d — adding their endpoints before they exist would be naming
 * a contract nothing calls.
 */

const base = (propertyId: string) => `/api/v1/properties/${propertyId}/room-types`;

export interface RoomTypeListResult {
  roomTypes: RoomType[];
  page: PageMeta;
}

export function listRoomTypes(propertyId: string, params: RoomTypeListParams = {}): Promise<RoomTypeListResult> {
  return apiFetch<RoomTypeListResult>(`${base(propertyId)}${toQueryString({ ...params })}`);
}
