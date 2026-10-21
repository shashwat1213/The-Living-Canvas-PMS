import { useCallback, useEffect, useState } from 'react';

import { ApiError, apiFetch } from './api';

export interface Profile {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  organizationId: string;
  emailVerifiedAt: string | null;
  createdAt: string;
  isDemo: boolean;
  organization: { id: string; name: string; slug: string };
}

export function fetchProfile(): Promise<Profile> {
  return apiFetch<{ user: Profile }>('/api/v1/auth/me').then((r) => r.user);
}

/** The signed-in user's profile (`GET /auth/me`), with loading/error state. */
export function useProfile() {
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    fetchProfile()
      .then((p) => !cancelled && setProfile(p))
      .catch((err: unknown) => !cancelled && setError(err instanceof ApiError ? err.message : 'Could not load your account.'));
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { profile, error, reload };
}
