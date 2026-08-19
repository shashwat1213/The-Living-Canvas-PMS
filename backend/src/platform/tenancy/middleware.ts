import type { NextFunction, Request, Response } from 'express';

import { UnauthorizedError } from '../../lib/http-errors.js';
import type { Permission, SystemRoleName } from '../rbac/permissions.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { runWithRequestContext } from './context.js';

/**
 * Resolves the request's tenant context from the access token and runs
 * the rest of the middleware/handler chain inside it (AsyncLocalStorage —
 * see `context.ts`). Every route that needs to know "who is calling, and
 * for which organization" sits behind this — there is no route-level
 * fallback that reads a user ID off the request object directly.
 */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing or malformed Authorization header.'));
    return;
  }

  let payload;
  try {
    payload = verifyAccessToken(header.slice('Bearer '.length));
  } catch {
    next(new UnauthorizedError('Invalid or expired access token.'));
    return;
  }

  runWithRequestContext(
    {
      userId: payload.sub,
      organizationId: payload.organizationId,
      permissions: new Set(payload.permissions as Permission[]),
      roleNames: new Set(payload.roleNames as SystemRoleName[]),
      grantedPropertyIds: new Set(payload.grantedPropertyIds),
    },
    () => next(),
  );
}
