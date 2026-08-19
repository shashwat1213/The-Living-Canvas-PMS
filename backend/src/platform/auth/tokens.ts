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

/** Short-lived, stateless JWT access token (Phase 1 decision #1). */
export function signAccessToken(payload: AccessTokenPayload): string {
  return jwt.sign(payload, env.auth.jwtSecret, {
    expiresIn: `${env.auth.accessTokenTtlMinutes}m`,
  });
}

export function verifyAccessToken(token: string): AccessTokenPayload {
  return jwt.verify(token, env.auth.jwtSecret) as AccessTokenPayload;
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
