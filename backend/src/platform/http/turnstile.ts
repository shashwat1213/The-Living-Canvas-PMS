import type { NextFunction, Request, Response } from 'express';

import { env } from '../../config/env.js';
import { HttpError } from '../../lib/http-errors.js';

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Cloudflare Turnstile (CAPTCHA) check for public, abuse-prone forms
 * (signup, forgot-password, public booking).
 *
 * Enforced only when `TURNSTILE_SECRET_KEY` is set — local dev, CI and tests
 * run without it. The client sends the widget token in the
 * `cf-turnstile-response` header (body field also accepted).
 */
export async function verifyTurnstileToken(token: string | undefined, remoteIp?: string): Promise<boolean> {
  const secret = env.turnstileSecretKey;
  if (!secret) return true;
  if (!token) return false;
  try {
    const body = new URLSearchParams({ secret, response: token });
    if (remoteIp) body.set('remoteip', remoteIp);
    const res = await fetch(VERIFY_URL, { method: 'POST', body, signal: AbortSignal.timeout(8000) });
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch (error) {
    console.error('[turnstile] verification request failed', error);
    return false;
  }
}

export function requireHuman(req: Request, _res: Response, next: NextFunction): void {
  const header = req.headers['cf-turnstile-response'];
  const token =
    (typeof header === 'string' ? header : undefined) ??
    (typeof req.body?.turnstileToken === 'string' ? (req.body.turnstileToken as string) : undefined);
  verifyTurnstileToken(token, req.ip)
    .then((ok) => {
      if (!ok) {
        next(new HttpError(400, 'captcha_failed', 'Please complete the security check and try again.'));
        return;
      }
      next();
    })
    .catch(next);
}
