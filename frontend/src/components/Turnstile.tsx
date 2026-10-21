import { useEffect, useRef } from 'react';

/**
 * Cloudflare Turnstile CAPTCHA widget.
 *
 * Renders only when `VITE_TURNSTILE_SITE_KEY` is set at build time; otherwise
 * it renders nothing and reports "no token needed" so local dev and tests
 * work without keys. The backend enforces the check independently (only when
 * its own secret is set), so this component is a UX helper, not the control.
 */

const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (el: HTMLElement, opts: Record<string, unknown>) => string;
  reset: (id: string) => void;
  remove: (id: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Could not load the security check.'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

export const captchaEnabled = Boolean(SITE_KEY);

/** Header to attach to a protected request, or nothing when CAPTCHA is off. */
export function captchaHeaders(token: string | null): Record<string, string> {
  return token ? { 'cf-turnstile-response': token } : {};
}

interface Props {
  onToken: (token: string | null) => void;
  /** Change this value to force a fresh challenge (tokens are single-use). */
  resetKey?: number;
}

export function Turnstile({ onToken, resetKey = 0 }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const widgetId = useRef<string | null>(null);
  const onTokenRef = useRef(onToken);
  onTokenRef.current = onToken;

  useEffect(() => {
    if (!SITE_KEY || !ref.current) return;
    let cancelled = false;
    const el = ref.current;
    loadScript()
      .then(() => {
        if (cancelled || !window.turnstile) return;
        widgetId.current = window.turnstile.render(el, {
          sitekey: SITE_KEY,
          theme: 'light',
          size: 'flexible',
          callback: (token: string) => onTokenRef.current(token),
          'expired-callback': () => onTokenRef.current(null),
          'error-callback': () => onTokenRef.current(null),
        });
      })
      .catch(() => onTokenRef.current(null));
    return () => {
      cancelled = true;
      if (widgetId.current && window.turnstile) window.turnstile.remove(widgetId.current);
      widgetId.current = null;
    };
  }, []);

  useEffect(() => {
    if (resetKey > 0 && widgetId.current && window.turnstile) {
      window.turnstile.reset(widgetId.current);
      onTokenRef.current(null);
    }
  }, [resetKey]);

  if (!SITE_KEY) return null;
  return <div className="turnstile" ref={ref} />;
}
