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

export interface Room {
  id: string;
  propertyId: string;
  name: string;
  /** Legacy free-text label. Still returned, still searchable. */
  roomType: string;
  /** The structured type, once one has been assigned. */
  roomTypeId: string | null;
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
  /**
   * One of `roomType` or `roomTypeId` is required by the API. Sending
   * `roomTypeId` alone lets the server fill the label in from the type.
   */
  roomType?: string;
  roomTypeId?: string | null;
  floor?: string;
  capacity?: number;
  status?: RoomStatus;
  notes?: string;
}

export type UpdateRoomInput = Partial<CreateRoomInput>;
