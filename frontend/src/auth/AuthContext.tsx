import { createContext, useEffect, useState, type ReactNode } from 'react';

import { apiFetch, onAccessTokenChange, setAccessToken } from '../lib/api';
import { readSessionClaims, type SessionClaims } from './session';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  /**
   * Display-only claims about the signed-in user, derived from the access
   * token. Features use this to avoid rendering controls that would only
   * earn a 403 — never to decide whether something is allowed. See
   * `auth/session.ts`.
   */
  session: SessionClaims | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<SessionClaims | null>(null);

  // Track the token rather than snapshotting it at login: `lib/api.ts`
  // silently refreshes on a 401, which re-mints the token (with
  // potentially different permissions) without going through any function
  // here. Subscribing keeps the derived claims honest in that case.
  useEffect(() => onAccessTokenChange((token) => setSession(readSessionClaims(token))), []);

  useEffect(() => {
    let cancelled = false;

    // The access token lives only in memory (see lib/api.ts), so every
    // full page load starts from here: try a silent refresh against the
    // httpOnly cookie before deciding whether the visitor is logged in.
    apiFetch<{ accessToken: string }>('/api/v1/auth/refresh', { method: 'POST', skipAuthRetry: true })
      .then((res) => {
        if (cancelled) return;
        setAccessToken(res.accessToken);
        setStatus('authenticated');
      })
      .catch(() => {
        if (!cancelled) setStatus('anonymous');
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function login(email: string, password: string): Promise<void> {
    const res = await apiFetch<{ accessToken: string }>('/api/v1/auth/login', {
      method: 'POST',
      body: { email, password },
      skipAuthRetry: true,
    });
    setAccessToken(res.accessToken);
    setStatus('authenticated');
  }

  async function logout(): Promise<void> {
    try {
      await apiFetch('/api/v1/auth/logout', { method: 'POST', skipAuthRetry: true });
    } finally {
      setAccessToken(null);
      setStatus('anonymous');
    }
  }

  return <AuthContext.Provider value={{ status, session, login, logout }}>{children}</AuthContext.Provider>;
}
