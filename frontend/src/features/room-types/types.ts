/**
 * Domain types for room types, mirroring what
 * `backend/src/modules/room-types` returns.
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
