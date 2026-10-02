import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createGroqChatProvider,
  tryActivateGroqChatFromEnv,
} from '../src/platform/ai/groq-chat-provider.js';
import type { ChatRequest } from '../src/platform/ai/chat-provider.js';

const req: ChatRequest = {
  system: 'You are the assistant for Grand Palace. Occupancy: 80%.',
  messages: [{ role: 'user', content: 'What is our occupancy?' }],
};

function groqResponse(content: string, ok = true, status = ok ? 200 : 500) {
  return {
    ok,
    status,
    json: () => Promise.resolve({ choices: [{ message: { content } }] }),
    text: () => Promise.resolve(content),
  } as Response;
}

/** A mocked Groq SSE stream Response: emits one `data:` line per delta. */
function groqStreamResponse(deltas: string[], ok = true, status = ok ? 200 : 500) {
  const encoder = new TextEncoder();
  const lines = [
    ...deltas.map(
      (d) => `data: ${JSON.stringify({ choices: [{ delta: { content: d } }] })}\n\n`,
    ),
    'data: [DONE]\n\n',
  ];
  let i = 0;
  const body = ok
    ? {
        getReader() {
          return {
            read() {
              if (i < lines.length) {
                const value = encoder.encode(lines[i]);
                i += 1;
                return Promise.resolve({ done: false, value });
              }
              return Promise.resolve({ done: true, value: undefined });
            },
          };
        },
      }
    : null;
  return { ok, status, body, text: () => Promise.resolve('error') } as unknown as Response;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('groq chat provider', () => {
  it('sends system + turns and returns the reply', async () => {
    const fetchMock = vi.fn().mockResolvedValue(groqResponse('Occupancy is 80% today.'));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createGroqChatProvider({ apiKey: 'gsk_test', model: 'qwen/qwen3.8-27b' });
    const result = await provider.chat(req);

    expect(result.content).toBe('Occupancy is 80% today.');
    expect(provider.key).toBe('groq:qwen/qwen3.8-27b');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test');
    const body = JSON.parse(init.body as string) as {
      model: string;
      messages: Array<{ role: string; content: string }>;
    };
    expect(body.model).toBe('qwen/qwen3.8-27b');
    // Leading system message carries the grounding prompt, then the user turn.
    expect(body.messages[0]).toEqual({ role: 'system', content: req.system });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'What is our occupancy?' });
  });

  it('throws on a non-ok response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqResponse('rate limited', false, 429)));
    const provider = createGroqChatProvider({ apiKey: 'k', model: 'm' });
    await expect(provider.chat(req)).rejects.toThrow(/Groq chat failed \(429\)/);
  });

  it('throws on an empty completion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqResponse('   ')));
    const provider = createGroqChatProvider({ apiKey: 'k', model: 'm' });
    await expect(provider.chat(req)).rejects.toThrow(/empty chat completion/);
  });
});

describe('groq chat provider streaming', () => {
  async function collect(iter: AsyncIterable<string>): Promise<string[]> {
    const out: string[] = [];
    for await (const d of iter) out.push(d);
    return out;
  }

  it('yields content deltas parsed from the SSE stream', async () => {
    const fetchMock = vi.fn().mockResolvedValue(groqStreamResponse(['Occ', 'upancy ', 'is 80%.']));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createGroqChatProvider({ apiKey: 'gsk_test', model: 'qwen/qwen3.8-27b' });
    const deltas = await collect(provider.stream!(req));

    expect(deltas).toEqual(['Occ', 'upancy ', 'is 80%.']);
    expect(deltas.join('')).toBe('Occupancy is 80%.');
    // Requested a streaming completion.
    const body = JSON.parse((fetchMock.mock.calls[0]![1] as RequestInit).body as string) as { stream: boolean };
    expect(body.stream).toBe(true);
  });

  it('stops at [DONE] and tolerates split chunks', async () => {
    const fetchMock = vi.fn().mockResolvedValue(groqStreamResponse(['Hello', ' world']));
    vi.stubGlobal('fetch', fetchMock);
    const provider = createGroqChatProvider({ apiKey: 'k', model: 'm' });
    expect((await collect(provider.stream!(req))).join('')).toBe('Hello world');
  });

  it('throws on a non-ok stream response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqStreamResponse([], false, 429)));
    const provider = createGroqChatProvider({ apiKey: 'k', model: 'm' });
    await expect(collect(provider.stream!(req))).rejects.toThrow(/Groq chat stream failed \(429\)/);
  });
});

describe('tryActivateGroqChatFromEnv', () => {
  it('activates and returns the model when GROQ_API_KEY is set', () => {
    let key: string | null = null;
    const model = tryActivateGroqChatFromEnv((p) => {
      key = p.key;
    }, { GROQ_API_KEY: 'gsk_x', GROQ_MODEL: 'openai/gpt-oss-20b' } as NodeJS.ProcessEnv);
    expect(model).toBe('openai/gpt-oss-20b');
    expect(key).toBe('groq:openai/gpt-oss-20b');
  });

  it('defaults the model when GROQ_MODEL is unset', () => {
    const model = tryActivateGroqChatFromEnv(() => {}, { GROQ_API_KEY: 'gsk_x' } as NodeJS.ProcessEnv);
    expect(model).toBe('qwen/qwen3.8-27b');
  });

  it('returns null and does not activate without a key', () => {
    const setProvider = vi.fn();
    const model = tryActivateGroqChatFromEnv(setProvider, {} as NodeJS.ProcessEnv);
    expect(model).toBeNull();
    expect(setProvider).not.toHaveBeenCalled();
  });
});
