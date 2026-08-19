import type { Prisma, Property } from '@prisma/client';

import { NotFoundError } from '../../lib/http-errors.js';
import { isRecordNotFoundError } from '../../lib/prisma-errors.js';
import { scopedPrisma } from '../../platform/tenancy/scoped-prisma.js';
import type { CreatePropertyInput, UpdatePropertyInput } from './schemas.js';

/**
 * Every method here goes through `scopedPrisma`, never the base `prisma`
 * client — that's what makes the organization filter impossible to
 * forget (see `platform/tenancy/scoped-prisma.ts`).
 */
export const propertiesRepository = {
  list(): Promise<Property[]> {
    return scopedPrisma.property.findMany({ orderBy: { createdAt: 'asc' } });
  },

  findById(id: string): Promise<Property | null> {
    return scopedPrisma.property.findFirst({ where: { id } });
  },

  findBySlug(slug: string): Promise<Property | null> {
    return scopedPrisma.property.findFirst({ where: { slug } });
  },

  create(data: CreatePropertyInput): Promise<Property> {
    // `organizationId` is required by Prisma's generated type but is
    // injected at runtime by the tenant-scoping extension's `create`
    // handling (scoped-prisma.ts) — the cast reflects that seam, not a
    // missing field.
    return scopedPrisma.property.create({ data: data as Prisma.PropertyCreateInput });
  },

  async update(id: string, data: UpdatePropertyInput): Promise<Property> {
    try {
      return await scopedPrisma.property.update({ where: { id }, data });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Property not found.');
      }
      throw error;
    }
  },

  async remove(id: string): Promise<void> {
    try {
      await scopedPrisma.property.delete({ where: { id } });
    } catch (error) {
      if (isRecordNotFoundError(error)) {
        throw new NotFoundError('Property not found.');
      }
      throw error;
    }
  },
};
