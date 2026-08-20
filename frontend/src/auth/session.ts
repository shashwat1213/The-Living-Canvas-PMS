import { getAccessToken } from '../lib/api';

/**
 * Who the current user is, as far as the UI needs to know.
 *
 * ## This is presentation data, not a security boundary
 *
 * These claims are read out of the access token's payload **without
 * verifying its signature** — the browser has no key to verify with, and
 * verification here would prove nothing anyway, since anything running in
 * the page could skip it. The backend re-derives all of this from the
 * signed token on every single request and is the only thing that decides
 * what actually happens.
 *
 * What this is for: not rendering buttons that would only produce a 403.
 * Hiding a control the user can't use is a courtesy; it is never what
 * stops them. Every mutation in this app is sent to the server and its
 * answer is displayed honestly, including when that answer is "forbidden".
 */
export interface SessionClaims {
  userId: string;
  organizationId: string;
  permissions: ReadonlySet<string>;
  roleNames: readonly string[];
  grantedPropertyIds: ReadonlySet<string>;
}

interface RawTokenPayload {
  sub?: unknown;
  organizationId?: unknown;
  permissions?: unknown;
  roleNames?: unknown;
  grantedPropertyIds?: unknown;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
}

/**
 * Decodes a JWT's payload segment. Returns null for anything unexpected
 * rather than throwing: a malformed token means "we don't know who this
 * is", which callers render as "no permissions" — the safe direction for
 * a UI, and one the backend would enforce regardless.
 */
function decodePayload(token: string): RawTokenPayload | null {
  const segment = token.split('.')[1];
  if (!segment) return null;

  try {
    // base64url → base64, then decode. `atob` handles the rest; the
    // percent-encoding round-trip is what keeps non-ASCII names intact.
    const base64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const json = decodeURIComponent(
      atob(base64)
        .split('')
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, '0')}`)
        .join(''),
    );
    const parsed: unknown = JSON.parse(json);
    return typeof parsed === 'object' && parsed !== null ? (parsed as RawTokenPayload) : null;
  } catch {
    return null;
  }
}

export function readSessionClaims(token: string | null = getAccessToken()): SessionClaims | null {
  if (!token) return null;

  const payload = decodePayload(token);
  if (!payload || typeof payload.sub !== 'string' || typeof payload.organizationId !== 'string') {
    return null;
  }

  return {
    userId: payload.sub,
    organizationId: payload.organizationId,
    permissions: new Set(stringArray(payload.permissions)),
    roleNames: stringArray(payload.roleNames),
    grantedPropertyIds: new Set(stringArray(payload.grantedPropertyIds)),
  };
}

/** Convenience for the common `session?.permissions.has(...)` check. */
export function hasPermission(session: SessionClaims | null, permission: string): boolean {
  return session?.permissions.has(permission) ?? false;
}
