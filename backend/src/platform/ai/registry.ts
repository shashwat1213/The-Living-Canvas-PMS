import type { AIContentProvider } from './provider.js';
import { stubContentProvider } from './stub-provider.js';

/**
 * The active AI content provider. Defaults to the deterministic stub; a real
 * LLM adapter replaces it with one call at startup
 * (`setContentProvider(openAiProvider)`), and everything downstream — the
 * generate job, the stored `provider` key, the studio — picks it up with no
 * other change. Kept as a single swappable instance rather than a per-key
 * map because the studio uses one provider at a time; the seam is the
 * interface, not a routing table.
 */
let active: AIContentProvider = stubContentProvider;

export function setContentProvider(provider: AIContentProvider): void {
  active = provider;
}

export function getContentProvider(): AIContentProvider {
  return active;
}

/** Test-only: restore the stub default so a suite starts from a known state. */
export function resetContentProvider(): void {
  active = stubContentProvider;
}
