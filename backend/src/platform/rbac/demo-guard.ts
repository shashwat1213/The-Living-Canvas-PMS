import type { NextFunction, Request, Response } from 'express';

import { env } from '../../config/env.js';
import { prisma } from '../../lib/prisma.js';
import { ForbiddenError } from '../../lib/http-errors.js';
import { getRequestContext } from '../tenancy/context.js';

export const DEMO_LOCKED_MESSAGE =
  'This action is disabled on the shared demo hotel so every visitor sees the same data. Create your own free workspace to try it.';

/**
 * Keeps the public, shared demo workspace intact for every visitor.
 *
 * The demo login (`env.demoEmail`) is an OWNER, so permissions alone would
 * let any visitor delete the property, wipe room types/rates/guests,
 * rename the organization or mint staff logins — breaking the demo for
 * everyone after them. Routes that change the workspace's *structure* add
 * this guard; day-to-day operations (bookings, check-in/out, folios, POS,
 * housekeeping, maintenance, marketing) stay open so the demo is still
 * hands-on.
 *
 * Must run after `authenticate`. Costs one primary-key lookup, and only
 * on the handful of rarely-called routes that use it.
 */
export async function denyDemoAccount(_req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const { userId } = getRequestContext();
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    if (user && user.email.toLowerCase() === env.demoEmail) {
      next(new ForbiddenError(DEMO_LOCKED_MESSAGE));
      return;
    }
    next();
  } catch (error) {
    next(error);
  }
}
