import { z } from 'zod';

import { paginationQuerySchema } from '../../lib/pagination.js';

/** The four cleaning conditions a room can be set to (see `HousekeepingStatus`). */
export const HOUSEKEEPING_STATUSES = ['DIRTY', 'CLEANING', 'CLEAN', 'INSPECTED'] as const;

/** Task lifecycle and kind, mirroring the Prisma enums. */
export const TASK_STATUSES = ['PENDING', 'IN_PROGRESS', 'DONE', 'CANCELLED'] as const;
export const TASK_TYPES = ['DEPARTURE', 'STAYOVER', 'TURNDOWN', 'OTHER'] as const;

const housekeepingStatus = z.enum(HOUSEKEEPING_STATUSES);
const taskStatus = z.enum(TASK_STATUSES);
const taskType = z.enum(TASK_TYPES);

/**
 * The housekeeping board is read for a single calendar date (defaulting to
 * today). Occupancy — arrivals, departures, stayovers — is derived from the
 * reservations assigned to each room that touch that date, so the board a
 * supervisor reads at the start of a shift shows which rooms turn over today.
 * Date-only, consistent with the project's stay-date convention.
 */
export const boardQuerySchema = z.object({
  date: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD.')
    .optional(),
});

export type BoardQuery = z.infer<typeof boardQuerySchema>;

/** Set a room's cleaning condition directly (housekeeping:manage). */
export const setConditionSchema = z.object({
  housekeepingStatus,
});

export type SetConditionInput = z.infer<typeof setConditionSchema>;

/**
 * Create a housekeeping task against a room. `assignedToId`, when given, must
 * be a staff member of the caller's organization (validated in the service);
 * a task can also be left unassigned for a supervisor to hand out later.
 */
export const createTaskSchema = z.object({
  roomId: z.string().uuid(),
  type: taskType.optional(),
  assignedToId: z.string().uuid().nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
});

export type CreateTaskInput = z.infer<typeof createTaskSchema>;

/**
 * Update a task: move it through its lifecycle, (re)assign it, or edit its
 * notes/type. Every field is optional — a caller may be only changing status.
 * `assignedToId` is `.nullable()` so a task can be explicitly un-assigned
 * (set back to no one), distinct from an omitted key which leaves it unchanged.
 */
export const updateTaskSchema = z
  .object({
    status: taskStatus.optional(),
    type: taskType.optional(),
    assignedToId: z.string().uuid().nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Provide at least one field to update.' });

export type UpdateTaskInput = z.infer<typeof updateTaskSchema>;

/** Query for the task list: paginated, filterable by status, type, room and assignee. */
export const listTasksQuerySchema = paginationQuerySchema.extend({
  status: taskStatus.optional(),
  type: taskType.optional(),
  roomId: z.string().uuid().optional(),
  assignedToId: z.string().uuid().optional(),
});

export type ListTasksQuery = z.infer<typeof listTasksQuerySchema>;
