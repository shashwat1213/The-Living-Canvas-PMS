import type { AIChatProvider, ChatRequest, ChatResult } from './chat-provider.js';

/**
 * Deterministic, offline chat provider — the default until a real LLM adapter
 * is configured.
 *
 * It cannot reason, so it does the one honest thing an offline stub can: it
 * acknowledges the latest question and tells the user the live assistant is
 * not configured, without inventing hotel data. Deterministic on purpose, so
 * tests assert exact strings and the whole route (auth → RBAC → context build
 * → chat) is exercised end-to-end with no credentials. When a real adapter
 * lands it registers under its own key and this becomes the fallback.
 */
export const stubChatProvider: AIChatProvider = {
  key: 'stub',
  async chat(request: ChatRequest): Promise<ChatResult> {
    const lastUser = [...request.messages].reverse().find((m) => m.role === 'user');
    const question = lastUser?.content.trim() ?? '';
    const preview = question.length > 120 ? `${question.slice(0, 117)}…` : question;
    return {
      content:
        `The AI assistant isn't fully configured yet, so I can't answer live ` +
        `questions right now (no language-model credentials are set). ` +
        (preview ? `You asked: "${preview}". ` : '') +
        `Once a provider key is configured I'll be able to answer using this ` +
        `property's live data.`,
    };
  },
};
