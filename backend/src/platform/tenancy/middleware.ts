import type { NextFunction, Request, Response } from 'express';

import { UnauthorizedError } from '../../lib/http-errors.js';
import type { Permission, SystemRoleName } from '../rbac/permissions.js';
import { getTokensValidAfter } from '../auth/revocation-cache.js';
import { verifyAccessToken } from '../auth/tokens.js';
import { runWithRequestContext } from './context.js';

// Same generic message for every rejection reason (missing header,
// malformed/expired signature, or revoked-since-issuance) — a distinct
// message per case would let a caller distinguish "your token is
// malformed" from "your account was deactivated," which nothing here
// needs to reveal.
const INVALID_TOKEN_MESSAGE = 'Invalid or expired access token.';

/**
 * Resolves the request's tenant context from the access token and runs
 * the rest of the middleware/handler chain inside it (AsyncLocalStorage —
 * see `context.ts`). Every route that needs to know "who is calling, and
 * for which organization" sits behind this — there is no route-level
 * fallback that reads a user ID off the request object directly.
 */
export async function authenticate(req: Request, _res: Response, next: NextFunction): Promise<void> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) {
    next(new UnauthorizedError('Missing or malformed Authorization header.'));
    return;
  }

  let payload;
  try {
    payload = verifyAccessToken(header.slice('Bearer '.length));
  } catch {
    next(new UnauthorizedError(INVALID_TOKEN_MESSAGE));
    return;
  }

  // Token-revocation watermark (see DECISIONS.md): rejects an
  // already-issued access token issued before the user's
  // `tokensValidAfter`, even though its signature and expiry are still
  // fine. Fails closed — a database error here (or the user no longer
  // existing) is treated the same as "revoked" rather than let through.
  //
  // `iatMs` is the millisecond issue time `signAccessToken` records, which
  // matches the watermark's own precision exactly. The `iat * 1000`
  // fallback covers a token minted by a previous deployment that predates
  // that claim: it truncates to the second and so can only ever reject
  // such a token too eagerly, never too late — the safe direction, and
  // self-clearing within one access-token lifetime after a deploy.
  try {
    const tokensValidAfter = await getTokensValidAfter(payload.sub);
    const issuedAtMs = payload.iatMs ?? payload.iat * 1000;
    if (tokensValidAfter && issuedAtMs < tokensValidAfter.getTime()) {
      next(new UnauthorizedError(INVALID_TOKEN_MESSAGE));
      return;
    }
  } catch (error) {
    console.error('[auth] revocation check failed, rejecting request', error);
    next(new UnauthorizedError(INVALID_TOKEN_MESSAGE));
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
