import { apiFetch } from '../../lib/api';
import { toQueryString, type PageMeta } from '../../lib/pagination';
import type { CreateRoomInput, Room, RoomListParams, UpdateRoomInput } from './types';

/**
 * The only place room endpoints are named. Rooms live under a property,
 * so every call takes the `propertyId` that scopes it — the backend
 * resolves that property through the tenant-scoped client before touching
 * a room, which is what makes a cross-organization ID a 404.
 */

const base = (propertyId: string) => `/api/v1/properties/${propertyId}/rooms`;

export interface RoomListResult {
  rooms: Room[];
  page: PageMeta;
}

export function listRooms(propertyId: string, params: RoomListParams = {}): Promise<RoomListResult> {
  return apiFetch<RoomListResult>(`${base(propertyId)}${toQueryString({ ...params })}`);
}

export function createRoom(propertyId: string, input: CreateRoomInput): Promise<Room> {
  return apiFetch<{ room: Room }>(base(propertyId), { method: 'POST', body: input }).then((res) => res.room);
}

export function updateRoom(propertyId: string, roomId: string, input: UpdateRoomInput): Promise<Room> {
  return apiFetch<{ room: Room }>(`${base(propertyId)}/${roomId}`, { method: 'PATCH', body: input }).then(
    (res) => res.room,
  );
}

export function deleteRoom(propertyId: string, roomId: string): Promise<void> {
  return apiFetch<void>(`${base(propertyId)}/${roomId}`, { method: 'DELETE' });
}
