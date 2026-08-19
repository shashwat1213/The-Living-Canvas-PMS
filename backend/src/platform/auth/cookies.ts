import type { Response } from 'express';

import { env } from '../../config/env.js';

export const REFRESH_COOKIE_NAME = 'living_canvas_refresh';

/**
 * The refresh token is delivered as an httpOnly cookie (Phase 1 decision
 * #1) rather than in the JSON body — it's never readable from client-side
 * JS, which is what makes it worth having alongside a short-lived access
 * token. `secure` is tied to NODE_ENV rather than a separate env var: it
 * must be true whenever the app is served over HTTPS (production) and
 * false for local http://localhost dev, where the browser would silently
 * drop a `Secure` cookie.
 *
 * `sameSite: 'lax'` (Security review, Phase 1 — see DECISIONS.md): works
 * for frontend/backend on different ports of `localhost` (same "site" by
 * the SameSite spec) and works in production as long as the frontend and
 * API are deployed on the same registrable domain (e.g.
 * `app.example.com` / `api.example.com` — still same-site). It stops
 * working if they ever end up on genuinely different registrable
 * domains; that deployment topology would need `sameSite: 'none'` plus
 * `secure: true` (HTTPS-only) instead. Lax also means a truly
 * cross-*site* POST to `/auth/refresh`/`/auth/logout` never carries the
 * cookie at all — the CSRF exposure on those two routes is limited to
 * same-site-but-different-subdomain scenarios, and even then the
 * attacker can't read the response (blocked by CORS), only force a
 * logout/session rotation.
 */
export function setRefreshCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(REFRESH_COOKIE_NAME, token, {
    httpOnly: true,
    secure: env.nodeEnv === 'production',
    sameSite: 'lax',
    path: '/api/v1/auth',
    expires: expiresAt,
  });
}

export function clearRefreshCookie(res: Response): void {
  res.clearCookie(REFRESH_COOKIE_NAME, { path: '/api/v1/auth' });
}
