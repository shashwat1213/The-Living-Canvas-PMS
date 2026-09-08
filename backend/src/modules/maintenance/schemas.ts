import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';

export const WORK_ORDER_STATUSES = ['OPEN', 'IN_PROGRESS', 'RESOLVED', 'CANCELLED'] as const;
export const WORK_ORDER_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT'] as const;
export const WORK_ORDER_CATEGORIES = [
  'HVAC',
  'PLUMBING',
  'ELECTRICAL',
  'APPLIANCE',
  'FURNITURE',
  'STRUCTURAL',
  'SAFETY',
  'OTHER',
] as const;

const status = z.enum(WORK_ORDER_STATUSES);
const priority = z.enum(WORK_ORDER_PRIORITIES);
const category = z.enum(WORK_ORDER_CATEGORIES);

/**
 * Create a maintenance work order. `roomId` is optional — a property-level
 * order (lobby, plant, grounds) has no room. `takeRoomOutOfService`, when true
 * AND a room is given, flips that room to MAINTENANCE (out of service) as part
 * of opening the order; it is ignored without a room.
 */
export const createWorkOrderSchema = z
  .object({
    title: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    roomId: z.string().uuid().nullable().optional(),
    category: category.optional(),
    priority: priority.optional(),
    assignedToId: z.string().uuid().nullable().optional(),
    takeRoomOutOfService: z.boolean().optional(),
  })
  .refine((v) => !(v.takeRoomOutOfService && !v.roomId), {
    message: 'takeRoomOutOfService requires a roomId — a property-level order has no room to block.',
    path: ['takeRoomOutOfService'],
  });

export type CreateWorkOrderInput = z.infer<typeof createWorkOrderSchema>;

/**
 * Update a work order. Every field optional. `status` drives the lifecycle;
 * moving to RESOLVED/CANCELLED returns the room to service if this order took
 * it out. `takeRoomOutOfService` can be toggled on an open order to block or
 * unblock its room without resolving it. `assignedToId`/`description` are
 * `.nullable()` so they can be explicitly cleared.
 */
export const updateWorkOrderSchema = z
  .object({
    title: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    category: category.optional(),
    priority: priority.optional(),
    status: status.optional(),
    assignedToId: z.string().uuid().nullable().optional(),
    takeRoomOutOfService: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' });

export type UpdateWorkOrderInput = z.infer<typeof updateWorkOrderSchema>;

/** Query for the work-order list: paginated, filterable, and text-searchable. */
export const listWorkOrdersQuerySchema = paginationQuerySchema.extend({
  status: status.optional(),
  priority: priority.optional(),
  category: category.optional(),
  roomId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
  search: z.string().trim().max(120).optional(),
});

export type ListWorkOrdersQuery = z.infer<typeof listWorkOrdersQuerySchema>;
