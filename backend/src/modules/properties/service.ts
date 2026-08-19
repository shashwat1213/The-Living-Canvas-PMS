import type { Property } from '@prisma/client';

import { ConflictError, NotFoundError } from '../../lib/http-errors.js';
import { isUniqueConstraintError } from '../../lib/prisma-errors.js';
import { getRequestContext } from '../../platform/tenancy/context.js';
import { ORG_WIDE_ROLES } from '../../platform/rbac/permissions.js';
import { propertiesRepository } from './repository.js';
import type { CreatePropertyInput, UpdatePropertyInput } from './schemas.js';

/**
 * Filters the org's properties down to the caller's granted subset.
 * OWNER/ADMIN see every property in the org (tenant scoping already
 * limits this to their own org); MANAGER/STAFF see only what they hold a
 * PropertyAccess grant for. Single-property routes (get/update/delete)
 * don't need this — they sit behind the `requirePropertyAccess` route
 * guard instead (see routes.ts), which is the same check applied to one
 * ID rather than a list.
 */
export async function listProperties(): Promise<Property[]> {
  const ctx = getRequestContext();
  const all = await propertiesRepository.list();
  const isOrgWide = [...ctx.roleNames].some((name) => ORG_WIDE_ROLES.has(name));
  return isOrgWide ? all : all.filter((property) => ctx.grantedPropertyIds.has(property.id));
}

export async function getProperty(id: string): Promise<Property> {
  const property = await propertiesRepository.findById(id);
  if (!property) {
    throw new NotFoundError('Property not found.');
  }
  return property;
}

/**
 * Checks for an existing slug before writing, rather than relying solely
 * on catching the database's unique-constraint error — gives a clean
 * `ConflictError` on the common path instead of depending on the
 * database round-tripping a well-formed constraint-violation error for
 * every write. The `isUniqueConstraintError` catch below stays in place
 * as a backstop for the narrow race between the check and the write.
 */
export async function createProperty(input: CreatePropertyInput): Promise<Property> {
  const existing = await propertiesRepository.findBySlug(input.slug);
  if (existing) {
    throw new ConflictError('A property with that slug already exists.');
  }
  try {
    return await propertiesRepository.create(input);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError('A property with that slug already exists.');
    }
    throw error;
  }
}

export async function updateProperty(id: string, input: UpdatePropertyInput): Promise<Property> {
  if (input.slug) {
    const existing = await propertiesRepository.findBySlug(input.slug);
    if (existing && existing.id !== id) {
      throw new ConflictError('A property with that slug already exists.');
    }
  }
  try {
    return await propertiesRepository.update(id, input);
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      throw new ConflictError('A property with that slug already exists.');
    }
    throw error;
  }
}

export async function deleteProperty(id: string): Promise<void> {
  await propertiesRepository.remove(id);
}
