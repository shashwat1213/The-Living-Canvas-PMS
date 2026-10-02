import type { AIChatProvider, ChatRequest, ChatResult } from './chat-provider.js';

/**
 * The real Groq chat adapter — code-ready, activated by credentials.
 *
 * Parallel to `createGroqProvider` (marketing content): a single `fetch` to
 * Groq's OpenAI-compatible Chat Completions endpoint, no SDK dependency. The
 * grounding system prompt is sent as the leading `system` message, then the
 * conversation turns. `temperature` is kept low so answers stay close to the
 * supplied data rather than inventing. An error or empty completion throws, so
 * the route surfaces a clean failure rather than a blank reply.
 */
export interface GroqChatConfig {
  apiKey: string;
  /** Groq model id, e.g. "qwen/qwen3.8-27b". */
  model: string;
  /** Override for tests; defaults to Groq's live API base. */
  apiBase?: string;
}

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

export function createGroqChatProvider(config: GroqChatConfig): AIChatProvider {
  const apiBase = config.apiBase ?? 'https://api.groq.com/openai/v1';

  function buildMessages(request: ChatRequest) {
    return [
      { role: 'system' as const, content: request.system },
      ...request.messages.map((m) => ({ role: m.role, content: m.content })),
    ];
  }

  return {
    key: `groq:${config.model}`,

    async chat(request: ChatRequest): Promise<ChatResult> {
      const res = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: buildMessages(request),
          temperature: 0.3,
          max_tokens: 800,
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Groq chat failed (${res.status}): ${detail.slice(0, 200)}`);
      }

      const data = (await res.json()) as GroqChatResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content || !content.trim()) {
        throw new Error('Groq returned an empty chat completion.');
      }
      return { content: content.trim() };
    },

    /**
     * Streaming variant: requests `stream: true` and yields each content delta
     * as Groq's OpenAI-compatible SSE arrives. Each line is `data: {json}`, with
     * a final `data: [DONE]`; we pull `choices[0].delta.content` from each JSON
     * chunk. Partial lines are buffered across reads.
     */
    async *stream(request: ChatRequest): AsyncIterable<string> {
      const res = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: buildMessages(request),
          temperature: 0.3,
          max_tokens: 800,
          stream: true,
        }),
      });

      if (!res.ok || !res.body) {
        const detail = res.body ? await res.text().catch(() => '') : '';
        throw new Error(`Groq chat stream failed (${res.status}): ${detail.slice(0, 200)}`);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        // Process complete SSE lines; keep the trailing partial in the buffer.
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
          const line = buffer.slice(0, newlineIndex).trim();
          buffer = buffer.slice(newlineIndex + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') return;
          try {
            const json = JSON.parse(payload) as {
              choices?: Array<{ delta?: { content?: string | null } }>;
            };
            const delta = json.choices?.[0]?.delta?.content;
            if (delta) yield delta;
          } catch {
            // Ignore keep-alive / unparseable lines.
          }
        }
      }
    },
  };
}

/**
 * Wire the Groq chat provider from environment at startup, if configured.
 * Returns the activated model id (for logging), or null when no key is set —
 * the stub stays active. Reuses the same GROQ_API_KEY / GROQ_MODEL env the
 * marketing adapter uses, so one key powers both.
 */
export function tryActivateGroqChatFromEnv(
  setProvider: (p: AIChatProvider) => void,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return null;
  const model = env.GROQ_MODEL?.trim() || 'qwen/qwen3.8-27b';
  setProvider(createGroqChatProvider({ apiKey, model }));
  return model;
}
