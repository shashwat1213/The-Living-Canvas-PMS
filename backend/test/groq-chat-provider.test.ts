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
