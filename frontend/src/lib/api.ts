const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:4000';

/**
 * The access token lives only in this module's memory, never
 * localStorage — it's lost on a full page reload by design (see
 * `auth/AuthContext.tsx`'s silent-refresh-on-load), which is what keeps
 * it out of reach of an XSS payload that can read localStorage.
 */
let accessToken: string | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: { path: string; message: string }[];

  constructor(status: number, code: string, message: string, issues?: { path: string; message: string }[]) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.issues = issues;
  }
}

interface ApiErrorBody {
  error?: { code?: string; message?: string; issues?: { path: string; message: string }[] };
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the automatic refresh-and-retry on a 401 — used by the auth
   * endpoints themselves to avoid a refresh loop. */
  skipAuthRetry?: boolean;
}

// Coalesces concurrent 401s into a single refresh call rather than
// firing one refresh request per failed request.
let refreshInFlight: Promise<boolean> | null = null;

async function refreshAccessToken(): Promise<boolean> {
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${API_URL}/api/v1/auth/refresh`, { method: 'POST', credentials: 'include' });
        if (!res.ok) {
          setAccessToken(null);
          return false;
        }
        const body = (await res.json()) as { accessToken: string };
        setAccessToken(body.accessToken);
        return true;
      } catch {
        setAccessToken(null);
        return false;
      } finally {
        refreshInFlight = null;
      }
    })();
  }
  return refreshInFlight;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const doFetch = () =>
    fetch(`${API_URL}${path}`, {
      method: options.method ?? 'GET',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}),
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

  let res = await doFetch();

  if (res.status === 401 && !options.skipAuthRetry) {
    const refreshed = await refreshAccessToken();
    if (refreshed) {
      res = await doFetch();
    }
  }

  if (!res.ok) {
    let body: ApiErrorBody | null = null;
    try {
      body = (await res.json()) as ApiErrorBody;
    } catch {
      // Response had no JSON body — fall through to the generic message below.
    }
    throw new ApiError(
      res.status,
      body?.error?.code ?? 'unknown_error',
      body?.error?.message ?? `Request failed (${res.status}).`,
      body?.error?.issues,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

export { API_URL };
