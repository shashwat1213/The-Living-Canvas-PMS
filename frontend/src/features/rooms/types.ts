/**
 * Domain types for rooms, mirroring what `backend/src/modules/rooms`
 * returns and accepts.
 */

export const ROOM_STATUSES = ['ACTIVE', 'INACTIVE', 'MAINTENANCE'] as const;

export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const ROOM_STATUS_LABEL: Record<RoomStatus, string> = {
  ACTIVE: 'Active',
  INACTIVE: 'Inactive',
  MAINTENANCE: 'Maintenance',
};

/** The room's category, embedded from the property's RoomType catalogue. */
export interface RoomTypeRef {
  id: string;
  name: string;
  code: string | null;
}

export interface Room {
  id: string;
  propertyId: string;
  name: string;
  /** The room's category. Every room has one. */
  roomTypeId: string;
  roomType: RoomTypeRef;
  floor: string | null;
  capacity: number;
  status: RoomStatus;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Server-side filters accepted by `GET /api/v1/properties/:id/rooms`. */
export interface RoomListParams {
  search?: string;
  status?: RoomStatus;
  page?: number;
  pageSize?: number;
}

export interface CreateRoomInput {
  name: string;
  /** Required: rooms are assigned a type from the property's catalogue. */
  roomTypeId: string;
  floor?: string;
  capacity?: number;
  status?: RoomStatus;
  notes?: string;
}

export type UpdateRoomInput = Partial<CreateRoomInput>;
