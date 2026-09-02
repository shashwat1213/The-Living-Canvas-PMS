/**
 * Domain types for room types, mirroring what
 * `backend/src/modules/room-types` returns and accepts.
 */

export interface RoomType {
  id: string;
  propertyId: string;
  name: string;
  code: string | null;
  description: string | null;
  isActive: boolean;
  /** How many rooms currently reference this type. */
  roomCount: number;
  createdAt: string;
  updatedAt: string;
}

/** Server-side filters accepted by `GET /api/v1/properties/:id/room-types`. */
export interface RoomTypeListParams {
  search?: string;
  status?: 'ACTIVE' | 'INACTIVE';
  page?: number;
  pageSize?: number;
}

export interface CreateRoomTypeInput {
  name: string;
  code?: string;
  description?: string;
  isActive?: boolean;
}

export type UpdateRoomTypeInput = Partial<CreateRoomTypeInput>;

/**
 * What the API accepts in `code`, mirrored from
 * `backend/src/modules/room-types/schemas.ts` so the dialog can reject it
 * before a round-trip. The server still upper-cases and re-validates —
 * this only saves the user a request, it doesn't define the rule.
 */
export const ROOM_TYPE_CODE_PATTERN = /^[A-Za-z0-9-]+$/;
export const ROOM_TYPE_CODE_MAX_LENGTH = 12;
export const ROOM_TYPE_NAME_MAX_LENGTH = 80;
export const ROOM_TYPE_DESCRIPTION_MAX_LENGTH = 1000;

/** "Active"/"Retired" — a catalogue entry is either sellable or it isn't. */
export function roomTypeStatusLabel(roomType: RoomType): string {
  return roomType.isActive ? 'Active' : 'Retired';
}
