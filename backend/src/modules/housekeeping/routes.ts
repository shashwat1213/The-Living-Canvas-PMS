import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { boardQuerySchema, createTaskSchema, listTasksQuerySchema, setConditionSchema, updateTaskSchema } from './schemas.js';
import * as housekeepingService from './service.js';

/**
 * Housekeeping for a property.
 *
 * Mounted at /properties/:propertyId/housekeeping — everything here is
 * property-scoped, so `requirePropertyAccess` runs before every handler.
 * `housekeeping:read` to view the board and tasks, `housekeeping:manage` to
 * set a room's condition and create/update tasks. The scoped Prisma client
 * enforces tenancy through room → property independently of these guards.
 */
export const housekeepingRouter = Router({ mergeParams: true });

housekeepingRouter.use(authenticate, requirePropertyAccess());

/** The board: every room with its cleaning condition and derived occupancy. */
housekeepingRouter.get(
  '/board',
  requirePermission('housekeeping:read'),
  asyncHandler(async (req, res) => {
    const query = boardQuerySchema.parse(req.query);
    const board = await housekeepingService.getBoard(req.params.propertyId as string, query.date);
    res.json({ board });
  }),
);

/** Set a room's cleaning condition (mark dirty/cleaning/clean/inspected). */
housekeepingRouter.put(
  '/rooms/:roomId/condition',
  requirePermission('housekeeping:manage'),
  asyncHandler(async (req, res) => {
    const input = setConditionSchema.parse(req.body);
    const room = await housekeepingService.setRoomCondition(
      req.params.propertyId as string,
      req.params.roomId as string,
      input,
    );
    res.json({ room });
  }),
);

housekeepingRouter.get(
  '/tasks',
  requirePermission('housekeeping:read'),
  asyncHandler(async (req, res) => {
    const query = listTasksQuerySchema.parse(req.query);
    const { items, page } = await housekeepingService.listTasks(req.params.propertyId as string, query);
    res.json({ tasks: items, page });
  }),
);

housekeepingRouter.post(
  '/tasks',
  requirePermission('housekeeping:manage'),
  asyncHandler(async (req, res) => {
    const input = createTaskSchema.parse(req.body);
    const task = await housekeepingService.createTask(req.params.propertyId as string, input);
    res.status(201).json({ task });
  }),
);

housekeepingRouter.get(
  '/tasks/:taskId',
  requirePermission('housekeeping:read'),
  asyncHandler(async (req, res) => {
    const task = await housekeepingService.getTask(req.params.propertyId as string, req.params.taskId as string);
    res.json({ task });
  }),
);

housekeepingRouter.patch(
  '/tasks/:taskId',
  requirePermission('housekeeping:manage'),
  asyncHandler(async (req, res) => {
    const input = updateTaskSchema.parse(req.body);
    const task = await housekeepingService.updateTask(req.params.propertyId as string, req.params.taskId as string, input);
    res.json({ task });
  }),
);
