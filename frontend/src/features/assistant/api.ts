import { apiFetch } from '../../lib/api';
import type { AssistantChatMessage, AssistantChatResponse } from './types';

/**
 * The only place the assistant endpoint is named. Property-scoped and routed
 * through `lib/api` (never raw fetch, never a hardcoded origin). The server
 * composes the grounding system prompt from the property's live data — the
 * client only ever sends the user/assistant conversation.
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
