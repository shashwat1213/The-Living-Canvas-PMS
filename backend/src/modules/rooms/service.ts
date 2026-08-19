import type { Room } from '@prisma/client';

import { ConflictError, NotFoundError } from '../../lib/http-errors.js';
import { withUniqueConstraintGuard } from '../../lib/prisma-errors.js';
import { roomsRepository } from './repository.js';
import type { CreateRoomInput, UpdateRoomInput } from './schemas.js';

export function listRooms(propertyId: string): Promise<Room[]> {
  return roomsRepository.list(propertyId);
}

export async function getRoom(propertyId: string, id: string): Promise<Room> {
  const room = await roomsRepository.findById(propertyId, id);
  if (!room) {
    throw new NotFoundError('Room not found.');
  }
  return room;
}

// See properties/service.ts for why creates/updates check for an
// existing name proactively rather than relying solely on catching the
// database's unique-constraint error.
export async function createRoom(propertyId: string, input: CreateRoomInput): Promise<Room> {
  const existing = await roomsRepository.findByName(propertyId, input.name);
  if (existing) {
    throw new ConflictError('A room with that name already exists at this property.');
  }
  return withUniqueConstraintGuard(
    () => roomsRepository.create(propertyId, input),
    'A room with that name already exists at this property.',
  );
}

export async function updateRoom(propertyId: string, id: string, input: UpdateRoomInput): Promise<Room> {
  if (input.name) {
    const existing = await roomsRepository.findByName(propertyId, input.name);
    if (existing && existing.id !== id) {
      throw new ConflictError('A room with that name already exists at this property.');
    }
  }
  return withUniqueConstraintGuard(
    () => roomsRepository.update(propertyId, id, input),
    'A room with that name already exists at this property.',
  );
}

export function deleteRoom(propertyId: string, id: string): Promise<void> {
  return roomsRepository.remove(propertyId, id);
}
