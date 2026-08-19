import type { NextFunction, Request, Response } from 'express';

import { ForbiddenError } from '../../lib/http-errors.js';
import { canAccessProperty, hasPermission } from '../tenancy/context.js';
import type { Permission } from './permissions.js';

/**
 * Route-level permission guard. Handlers declare what they need; this
 * checks it against the resolved context (see `tenancy/context.ts`) —
 * no handler inlines an `if (role === 'ADMIN')` check itself.
 */
export function requirePermission(...permissions: Permission[]) {
  return (_req: Request, _res: Response, next: NextFunction): void => {
    const missing = permissions.filter((permission) => !hasPermission(permission));
    if (missing.length > 0) {
      next(new ForbiddenError(`Missing required permission(s): ${missing.join(', ')}`));
      return;
    }
    next();
  };
}

/**
 * Guards a route with a `:propertyId` param against PropertyAccess
 * (Phase 1 decision #2 — see DECISIONS.md). A property in a *different*
 * organization never reaches this guard at all: the tenant-scoping
 * Prisma extension makes it invisible further down, surfacing as a 404
 * from the repository layer instead. This guard only ever produces 403
 * — "this property exists in your organization, but you're not granted
 * onto it" — which is a meaningfully different, and safe to disclose,
 * signal from inside one's own organization.
 */
export function requirePropertyAccess(paramName = 'propertyId') {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const propertyId = req.params[paramName];
    if (!propertyId || !canAccessProperty(propertyId)) {
      next(new ForbiddenError("You don't have access to this property."));
      return;
    }
    next();
  };
}
