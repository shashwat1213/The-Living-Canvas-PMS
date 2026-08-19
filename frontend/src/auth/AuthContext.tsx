import { createContext, useEffect, useState, type ReactNode } from 'react';

import { apiFetch, setAccessToken } from '../lib/api';

type AuthStatus = 'loading' | 'authenticated' | 'anonymous';

export interface AuthContextValue {
  status: AuthStatus;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');

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

  return <AuthContext.Provider value={{ status, login, logout }}>{children}</AuthContext.Provider>;
}
