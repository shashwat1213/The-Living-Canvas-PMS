import type { AIChatProvider } from './chat-provider.js';
import { stubChatProvider } from './stub-chat-provider.js';

/**
 * The active AI chat provider. Defaults to the deterministic stub; a real LLM
 * adapter replaces it with one call at startup
 * (`setChatProvider(groqChatProvider)`), and the assistant route picks it up
 * with no other change. One swappable instance — the seam is the interface,
 * not a routing table — mirroring the content and payment registries.
 */
let active: AIChatProvider = stubChatProvider;

export function setChatProvider(provider: AIChatProvider): void {
  active = provider;
}

export function getChatProvider(): AIChatProvider {
  return active;
}

/** Test-only: restore the stub default so a suite starts from a known state. */
export function resetChatProvider(): void {
  active = stubChatProvider;
}
