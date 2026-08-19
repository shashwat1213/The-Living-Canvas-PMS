import type { Room } from '@prisma/client';

import { NotFoundError } from '../../lib/http-errors.js';
import { isRecordNotFoundError } from '../../lib/prisma-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { CreateRoomInput, UpdateRoomInput } from './schemas.js';

export const roomsRepository = {
  /**
   * Verifies the parent Property exists (within the caller's org) before
   * listing, same as `create` below — without this, a property ID from
   * another organization would silently list as an empty array (200)
   * instead of 404, which is not a data leak (tenant scoping still zeroes
   * the result) but is an inconsistent signal next to every other
   * property sub-route, which does 404 on a cross-org ID.
   */
  async list(propertyId: string): Promise<Room[]> {
    const property = await scopedPrisma.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }
    return scopedPrisma.room.findMany({ where: { propertyId }, orderBy: { createdAt: 'asc' } });
  },

  findById(propertyId: string, id: string): Promise<Room | null> {
    return scopedPrisma.room.findFirst({ where: { id, propertyId } });
  },

  findByName(propertyId: string, name: string): Promise<Room | null> {
    return scopedPrisma.room.findFirst({ where: { propertyId, name } });
  },

  /**
   * Room has no `organizationId` column to scope a `create` by (see
   * `scoped-prisma.ts`'s comment on the room block), so this is where
   * the tenant boundary actually gets enforced for room creation: the
   * parent Property is looked up through the *scoped* client first — a
   * cross-organization `propertyId` resolves to nothing here and throws
   * `NotFoundError` before any room row is ever written.
   */
  async create(propertyId: string, data: CreateRoomInput): Promise<Room> {
    const property = await scopedPrisma.property.findFirst({ where: { id: propertyId } });
    if (!property) {
      throw new NotFoundError('Property not found.');
    }
    return scopedPrisma.room.create({ data: { ...data, propertyId } });
  },

  async update(propertyId: string, id: string, data: UpdateRoomInput): Promise<Room> {
    try {
      return await scopedPrisma.room.update({ where: { id, propertyId }, data });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Room not found.');
      }
      throw error;
    }
  },

  async remove(propertyId: string, id: string): Promise<void> {
    try {
      await scopedPrisma.room.delete({ where: { id, propertyId } });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Room not found.');
      }
      throw error;
    }
  },
};
