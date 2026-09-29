import { Router } from 'express';

import { asyncHandler } from '../../middleware/error-handler.js';
import { requirePermission, requirePropertyAccess } from '../../platform/rbac/guard.js';
import { authenticate } from '../../platform/tenancy/middleware.js';
import { calendarQuerySchema } from './schemas.js';
import * as calendarService from './service.js';

/**
 * A property's reservation calendar (tape chart): rooms down, dates across,
 * reservations as bars.
 *
 * Mounted at /properties/:propertyId/calendar — the calendar is a property
 * concern, so `requirePropertyAccess` runs before the handler. This is a
 * read-only view of the same bookings the reservations list shows, arranged
 * per-room per-night, so it reuses the existing `reservations:read` permission
 * rather than adding its own.
 */
export const calendarRouter = Router({ mergeParams: true });

calendarRouter.use(authenticate, requirePropertyAccess());

calendarRouter.get(
  '/',
  requirePermission('reservations:read'),
  asyncHandler(async (req, res) => {
    const query = calendarQuerySchema.parse(req.query);
    const calendar = await calendarService.getCalendar(req.params.propertyId as string, query);
    res.json(calendar);
  }),
);
