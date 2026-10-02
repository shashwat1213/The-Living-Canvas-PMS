import type {
  AIContentProvider,
  ContentGenerationRequest,
  GeneratedContent,
  MarketingFormat,
} from './provider.js';

/**
 * The real Groq LLM adapter — code-ready, activated by credentials.
 *
 * Like the Razorpay adapter, this is deliberately NOT wired in by default:
 * `platform/ai/registry.ts` ships the deterministic stub, and this adapter is
 * swapped in with `setContentProvider(createGroqProvider({ apiKey, model }))`
 * at startup only when `GROQ_API_KEY` is present. That keeps the whole
 * generate → review → approve pipeline runnable in dev/CI with no account and
 * no cost, while the production path is a one-line switch — the same shape the
 * payment and notification seams use.
 *
 * It talks to Groq's OpenAI-compatible Chat Completions API over HTTPS with a
 * single `fetch` (no SDK dependency, so this adapter pulls in no new package).
 * The model is asked for a strict JSON object `{ "title", "body" }` so the
 * result maps cleanly onto `GeneratedContent`; if the model ever returns
 * non-JSON, we fall back to treating the whole reply as the body rather than
 * failing the job.
 */
export interface GroqConfig {
  apiKey: string;
  /** Groq model id, e.g. "qwen/qwen3.8-27b". */
  model: string;
  /** Override for tests; defaults to Groq's live API base. */
  apiBase?: string;
}

/** Human-readable label for each marketing format, used in the prompt. */
const FORMAT_LABEL: Record<MarketingFormat, string> = {
  SOCIAL_POST: 'a social media post (with relevant hashtags)',
  EMAIL: 'a marketing email (with a subject line as the title)',
  PROMO_DESCRIPTION: 'a promotional description',
  TAGLINE: 'a short, punchy tagline',
};

function buildPrompt(req: ContentGenerationRequest): string {
  const { name, city, country } = req.property;
  const where = [city, country].filter(Boolean).join(', ');
  const locationLine = where ? `Location: ${where}\n` : '';
  const toneLine = req.tone ? `Desired tone: ${req.tone}\n` : '';

  return (
    `You are a hospitality marketing copywriter for a hotel property management ` +
    `system. Write ${FORMAT_LABEL[req.format]} for the property below.\n\n` +
    `Property: ${name}\n` +
    locationLine +
    toneLine +
    `Brief from the hotel's marketing staff: ${req.brief}\n\n` +
    `Ground the copy in THIS property — do not invent facilities or awards not ` +
    `implied by the brief. Keep it professional and ready to publish.\n\n` +
    `Respond with ONLY a JSON object, no markdown fences, in exactly this shape:\n` +
    `{"title": "<a short title or email subject, or null>", "body": "<the copy>"}`
  );
}

interface GroqChatResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
}

/** Pull the first JSON object out of a model reply that may include stray
 * prose or code fences, then coerce it to GeneratedContent. Falls back to the
 * raw text as the body if no valid JSON title/body is found. */
function parseGenerated(raw: string): GeneratedContent {
  const text = raw.trim();
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end > start) {
    try {
      const obj = JSON.parse(text.slice(start, end + 1)) as {
        title?: unknown;
        body?: unknown;
      };
      const body = typeof obj.body === 'string' ? obj.body.trim() : '';
      if (body) {
        const title = typeof obj.title === 'string' && obj.title.trim() ? obj.title.trim() : null;
        return { title, body };
      }
    } catch {
      // fall through to raw-text fallback
    }
  }
  return { title: null, body: text };
}

export function createGroqProvider(config: GroqConfig): AIContentProvider {
  const apiBase = config.apiBase ?? 'https://api.groq.com/openai/v1';

  return {
    // The stored key records which model produced a piece, so an old row still
    // shows its origin after the default model changes (e.g. "groq:qwen/qwen3.8-27b").
    key: `groq:${config.model}`,

    async generate(request: ContentGenerationRequest): Promise<GeneratedContent> {
      const res = await fetch(`${apiBase}/chat/completions`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: 'user', content: buildPrompt(request) }],
          temperature: 0.7,
          max_tokens: 1024,
        }),
      });

      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Groq generation failed (${res.status}): ${detail.slice(0, 200)}`);
      }

      const data = (await res.json()) as GroqChatResponse;
      const content = data.choices?.[0]?.message?.content;
      if (!content || !content.trim()) {
        throw new Error('Groq returned an empty completion.');
      }
      return parseGenerated(content);
    },
  };
}

/**
 * Wire the Groq provider from environment at startup, if configured. Returns
 * the activated model id (for logging), or null when no key is set — a normal
 * dev/CI state, not an error, in which case the stub stays active. Mirrors
 * `tryActivateRazorpayFromEnv`.
 */
export function tryActivateGroqFromEnv(
  setProvider: (p: AIContentProvider) => void,
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const apiKey = env.GROQ_API_KEY;
  if (!apiKey) return null;
  const model = env.GROQ_MODEL?.trim() || 'qwen/qwen3.8-27b';
  setProvider(createGroqProvider({ apiKey, model }));
  return model;
}
