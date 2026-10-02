/**
 * The AI chat seam the in-app Assistant is built around.
 *
 * Parallel to the marketing `AIContentProvider` seam: the assistant module,
 * its route and the UI never name a vendor. A real LLM adapter (Groq, and any
 * future provider) is a drop-in implementation registered against a provider
 * key; until credentials exist, the deterministic `stub` driver stands in, so
 * the whole chat flow runs end-to-end in dev, tests and CI with no account and
 * no cost. Same shape as the content, payment and notification seams.
 *
 * This is deliberately a SEPARATE interface from `AIContentProvider`:
 * marketing generation is a single-shot "compose one piece from a brief",
 * while the assistant is a multi-turn chat grounded in a system prompt. One
 * interface forced to serve both would blur two different call shapes.
 */

/** One turn in a conversation. `system` is supplied separately (see
 * `ChatRequest.system`), so only user/assistant turns appear here. */
export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequest {
  /** The grounding system prompt (persona + the property's live data snapshot).
   * The provider sends it as the leading system message. */
  system: string;
  /** The conversation so far, oldest first, ending with the latest user turn. */
  messages: ChatMessage[];
}

export interface ChatResult {
  /** The assistant's reply text. */
  content: string;
}

export interface AIChatProvider {
  /** A stable key identifying the provider/model (e.g. "stub",
   * "groq:qwen/qwen3.8-27b"), returned alongside the reply so the client can
   * show what answered. */
  readonly key: string;
  chat(request: ChatRequest): Promise<ChatResult>;
}
