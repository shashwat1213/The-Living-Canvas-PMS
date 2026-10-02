import { API_URL, apiFetch, getAccessToken } from '../../lib/api';
import type { AssistantChatMessage, AssistantChatResponse } from './types';

/**
 * The only place the assistant endpoints are named. Property-scoped and routed
 * through `lib/api` (never a hardcoded origin). The server composes the
 * grounding system prompt from the property's live data — the client only ever
 * sends the user/assistant conversation.
 */
export function sendChat(
  propertyId: string,
  messages: AssistantChatMessage[],
): Promise<AssistantChatResponse> {
  return apiFetch<AssistantChatResponse>(`/api/v1/properties/${propertyId}/assistant/chat`, {
    method: 'POST',
    body: { messages },
  });
}

/** Callbacks for a streamed assistant reply. */
export interface ChatStreamHandlers {
  onMeta?: (provider: string) => void;
  onDelta: (text: string) => void;
  onDone?: () => void;
  onError?: (message: string) => void;
  signal?: AbortSignal;
}

/**
 * Stream an assistant reply over Server-Sent Events. EventSource can't POST, so
 * this uses `fetch` with the bearer token and parses the `event:`/`data:` SSE
 * frames off the response body. Falls back cleanly: a non-OK response invokes
 * `onError`. The caller passes an AbortSignal to cancel an in-flight stream.
 */
export async function streamChat(
  propertyId: string,
  messages: AssistantChatMessage[],
  handlers: ChatStreamHandlers,
): Promise<void> {
  const token = getAccessToken();
  let res: Response;
  try {
    res = await fetch(`${API_URL}/api/v1/properties/${propertyId}/assistant/chat/stream`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({ messages }),
      signal: handlers.signal,
    });
  } catch {
    handlers.onError?.('Could not reach the assistant.');
    return;
  }

  if (!res.ok || !res.body) {
    handlers.onError?.(res.status === 401 ? 'Your session expired. Please sign in again.' : 'The assistant could not respond.');
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  const dispatch = (block: string) => {
    const lines = block.split('\n');
    let event = 'message';
    let data = '';
    for (const line of lines) {
      if (line.startsWith('event:')) event = line.slice(6).trim();
      else if (line.startsWith('data:')) data += line.slice(5).trim();
    }
    if (!data) return;
    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(data) as Record<string, unknown>;
    } catch {
      return;
    }
    if (event === 'meta') handlers.onMeta?.(String(parsed.provider ?? ''));
    else if (event === 'delta') handlers.onDelta(String(parsed.text ?? ''));
    else if (event === 'done') handlers.onDone?.();
    else if (event === 'error') handlers.onError?.(String(parsed.message ?? 'The assistant could not respond.'));
  };

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE frames are separated by a blank line.
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        dispatch(block);
      }
    }
  } catch {
    handlers.onError?.('The connection was interrupted.');
  }
}
