import { randomBytes, createHash } from 'node:crypto';

import jwt from 'jsonwebtoken';

import { env } from '../../config/env.js';
import type { Permission, SystemRoleName } from '../rbac/permissions.js';

export interface AccessTokenPayload {
  sub: string; // userId
  organizationId: string;
  permissions: Permission[];
  roleNames: SystemRoleName[];
  grantedPropertyIds: string[];
}

/**
 * What `verifyAccessToken` actually returns: `jwt.sign`/`jwt.verify` add
 * `iat`/`exp` automatically, on top of whatever was passed to
 * `signAccessToken`. Callers that need those claims — e.g. the
 * token-revocation watermark check in `tenancy/middleware.ts`, which
 * compares issue time against `User.tokensValidAfter` — use this type
 * rather than the plain `AccessTokenPayload` a caller signs with.
 */
export interface VerifiedAccessTokenPayload extends AccessTokenPayload {
  iat: number;
  exp: number;
  /**
   * Issue time in milliseconds, added by `signAccessToken`. Optional
   * because a token minted by a previous deployment won't carry it — see
   * the fallback in `tenancy/middleware.ts`.
   */
  iatMs?: number;
}

/**
 * Short-lived, stateless JWT access token (Phase 1 decision #1).
 *
 * `iatMs` is added alongside the standard second-granular `iat` because
 * the revocation watermark (`User.tokensValidAfter`) is a millisecond
 * timestamp, and comparing it against a truncated `iat` is wrong in one
 * direction or the other no matter how the comparison is written. With
 * whole seconds only, a token minted a fraction of a second *after* a
 * watermark bump truncates to an `iat` that looks earlier than the bump,
 * so it gets rejected even though it was issued after the revocation —
 * which matters now that role and property-access changes bump the
 * watermark (see `modules/staff/service.ts`) and the affected user is
 * expected to keep working with a freshly-issued token. Recording the
 * issue time at the same precision as the watermark removes the ambiguity
 * outright rather than trading a false rejection for a false acceptance.
 */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign({ ...payload, iatMs: Date.now() }, env.auth.jwtSecret, {
    expiresIn: `${env.auth.accessTokenTtlMinutes}m`,
  });
}

export function verifyAccessToken(token: string): VerifiedAccessTokenPayload {
  return jwt.verify(token, env.auth.jwtSecret) as VerifiedAccessTokenPayload;
}

/**
 * The refresh token itself is a random opaque value, never a JWT — only
 * its SHA-256 hash is stored in `Session.refreshTokenHash`, so a
 * database leak doesn't hand out usable refresh tokens.
 */
export function generateRefreshToken(): string {
  return randomBytes(48).toString('base64url');
}

export function hashRefreshToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
