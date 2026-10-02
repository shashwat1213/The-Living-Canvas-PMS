import { afterEach, describe, expect, it, vi } from 'vitest';

import { createGroqProvider, tryActivateGroqFromEnv } from '../src/platform/ai/groq-provider.js';
import type { ContentGenerationRequest } from '../src/platform/ai/provider.js';

const request: ContentGenerationRequest = {
  format: 'TAGLINE',
  brief: 'A calm riverside retreat',
  tone: 'warm',
  property: { name: 'Grand Palace', city: 'Udaipur', country: 'India' },
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
  vi.restoreAllMocks();
});

describe('groq content provider', () => {
  it('sends the key + model and parses a clean JSON reply', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(groqResponse('{"title":"A Royal Welcome","body":"Stay where serenity meets the Aravallis."}'));
    vi.stubGlobal('fetch', fetchMock);

    const provider = createGroqProvider({ apiKey: 'gsk_test', model: 'qwen/qwen3.8-27b' });
    const result = await provider.generate(request);

    expect(result).toEqual({
      title: 'A Royal Welcome',
      body: 'Stay where serenity meets the Aravallis.',
    });
    // provider.key records the model for the stored row's provenance.
    expect(provider.key).toBe('groq:qwen/qwen3.8-27b');

    // Request shape: Groq's OpenAI-compatible endpoint, Bearer auth, our model.
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.groq.com/openai/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer gsk_test');
    const body = JSON.parse(init.body as string) as { model: string; messages: unknown[] };
    expect(body.model).toBe('qwen/qwen3.8-27b');
    expect(body.messages).toHaveLength(1);
  });

  it('tolerates JSON wrapped in prose / code fences', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        groqResponse('Here you go:\n```json\n{"title":null,"body":"Pure body copy."}\n```'),
      ),
    );
    const provider = createGroqProvider({ apiKey: 'k', model: 'm' });
    const result = await provider.generate(request);
    expect(result).toEqual({ title: null, body: 'Pure body copy.' });
  });

  it('falls back to the raw text as body when the reply is not JSON', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqResponse('Just a plain tagline, no JSON.')));
    const provider = createGroqProvider({ apiKey: 'k', model: 'm' });
    const result = await provider.generate(request);
    expect(result).toEqual({ title: null, body: 'Just a plain tagline, no JSON.' });
  });

  it('throws on a non-ok response so the job worker retries', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqResponse('rate limited', false, 429)));
    const provider = createGroqProvider({ apiKey: 'k', model: 'm' });
    await expect(provider.generate(request)).rejects.toThrow(/Groq generation failed \(429\)/);
  });

  it('throws on an empty completion', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(groqResponse('   ')));
    const provider = createGroqProvider({ apiKey: 'k', model: 'm' });
    await expect(provider.generate(request)).rejects.toThrow(/empty completion/);
  });
});

describe('tryActivateGroqFromEnv', () => {
  it('activates and returns the model when GROQ_API_KEY is set', () => {
    let set: string | null = null;
    const model = tryActivateGroqFromEnv((p) => {
      set = p.key;
    }, { GROQ_API_KEY: 'gsk_x', GROQ_MODEL: 'openai/gpt-oss-20b' } as NodeJS.ProcessEnv);
    expect(model).toBe('openai/gpt-oss-20b');
    expect(set).toBe('groq:openai/gpt-oss-20b');
  });

  it('defaults the model to qwen/qwen3.8-27b when GROQ_MODEL is unset', () => {
    const model = tryActivateGroqFromEnv(() => {}, { GROQ_API_KEY: 'gsk_x' } as NodeJS.ProcessEnv);
    expect(model).toBe('qwen/qwen3.8-27b');
  });

  it('returns null and does not activate when no key is present', () => {
    const setProvider = vi.fn();
    const model = tryActivateGroqFromEnv(setProvider, {} as NodeJS.ProcessEnv);
    expect(model).toBeNull();
    expect(setProvider).not.toHaveBeenCalled();
  });
});
