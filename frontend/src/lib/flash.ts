/**
 * One-shot message carried across a redirect (e.g. "You've been signed out"),
 * for flows where the destination is reached via an auth redirect rather than
 * our own navigate() — router state would be lost there.
 */
const KEY = 'lc-flash';

export function setFlash(message: string): void {
  try {
    sessionStorage.setItem(KEY, message);
  } catch {
    // Storage disabled: the message is a nicety, not required.
  }
}

export function takeFlash(): string | null {
  try {
    const message = sessionStorage.getItem(KEY);
    if (message) sessionStorage.removeItem(KEY);
    return message;
  } catch {
    return null;
  }
}
