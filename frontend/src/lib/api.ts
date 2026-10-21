// Production builds talk to the API on the same origin (SPA + API are one
// Vercel deployment → first-party cookies, no CORS). Dev defaults to the
// local backend; VITE_API_URL overrides either.
const API_URL: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? (import.meta.env.PROD ? '' : 'http://localhost:4000');

/**
 * The access token lives only in this module's memory, never
 * localStorage — it's lost on a full page reload by design (see
 * `auth/AuthContext.tsx`'s silent-refresh-on-load), which is what keeps
 * it out of reach of an XSS payload that can read localStorage.
 */
let accessToken: string | null = null;

/**
 * Notified whenever the access token changes — including the silent
 * refresh this module performs internally on a 401, which no caller
 * initiates. `AuthContext` subscribes so the session claims it derives
 * from the token (see `auth/session.ts`) can't go stale: if a staff
 * member's role is changed while they're using the app, the backend
 * revokes their current token, the retry below mints a new one with the
 * new permissions, and the UI needs to follow.
 */
const tokenListeners = new Set<(token: string | null) => void>();

export function onAccessTokenChange(listener: (token: string | null) => void): () => void {
  tokenListeners.add(listener);
  return () => tokenListeners.delete(listener);
}

export function setAccessToken(token: string | null): void {
  accessToken = token;
  for (const listener of tokenListeners) listener(token);
}

/**
 * The current access token, for deriving display-only session claims.
 * Deliberately not exported anywhere near a security decision — the
 * backend is the only authority on what the caller may do.
 */
export function getAccessToken(): string | null {
  return accessToken;
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
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  body?: unknown;
  /** Skip the automatic refresh-and-retry on a 401 — used by the auth
   * endpoints themselves to avoid a refresh loop. */
  skipAuthRetry?: boolean;
  /** Extra request headers (e.g. the Turnstile CAPTCHA token). */
  headers?: Record<string, string>;
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
        ...options.headers,
      },
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

  let res: Response;
  try {
    res = await doFetch();
  } catch {
    // fetch only rejects on network failure (offline, DNS, CORS, server down).
    throw new ApiError(
      0,
      'network_error',
      "Can't reach the server. Check your internet connection and try again.",
    );
  }

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
      body?.error?.message ?? friendlyStatusMessage(res.status),
      body?.error?.issues,
    );
  }

  if (res.status === 204) {
    return undefined as T;
  }
  return res.json() as Promise<T>;
}

/** Human wording for an error response that carried no message of its own. */
function friendlyStatusMessage(status: number): string {
  if (status === 429) return 'Too many requests — please wait a moment and try again.';
  if (status >= 500) return 'Something went wrong on our side. Please try again in a moment.';
  if (status === 404) return 'We couldn’t find what you were looking for.';
  if (status === 403) return 'You don’t have permission to do that.';
  return `Request failed (${status}).`;
}

/**
 * The first field-level validation message for `field` (e.g. "owner.password"),
 * so forms can show the server's reason next to the right input.
 */
export function fieldError(error: unknown, field: string): string | undefined {
  if (!(error instanceof ApiError) || !error.issues) return undefined;
  return error.issues.find((issue) => issue.path === field || issue.path.endsWith(`.${field}`))?.message;
}

export { API_URL };
