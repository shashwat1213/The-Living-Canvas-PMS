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
 * compares `iat` against `User.tokensValidAfter` — use this type rather
 * than the plain `AccessTokenPayload` a caller signs with.
 */
export interface VerifiedAccessTokenPayload extends AccessTokenPayload {
  iat: number;
  exp: number;
}

/** Short-lived, stateless JWT access token (Phase 1 decision #1). */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.auth.jwtSecret, {
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
