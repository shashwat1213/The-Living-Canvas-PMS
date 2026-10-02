import { z } from 'zod';

/**
 * A chat turn as the client sends it. Only user/assistant roles — the system
 * prompt is composed server-side from the property's live data and is never
 * client-supplied (a client-provided system prompt would let the user rewrite
 * the assistant's instructions and its data grounding).
 */
const chatMessageSchema = z.object({
  role: z.enum(['user', 'assistant']),
  content: z.string().trim().min(1, 'A message cannot be empty.').max(4000, 'Message is too long.'),
});

/**
 * The assistant chat request: the conversation so far (oldest first), ending
 * with the latest user turn. Bounded in length so a client can't push an
 * unbounded history (cost + prompt-injection surface). The last message must
 * be from the user — the assistant replies to a user turn.
 */
export const chatRequestSchema = z.object({
  messages: z
    .array(chatMessageSchema)
    .min(1, 'At least one message is required.')
    .max(20, 'Conversation is too long; start a new chat.')
    .refine((m) => m[m.length - 1]?.role === 'user', {
      message: 'The last message must be from the user.',
    }),
});

export type ChatRequestInput = z.infer<typeof chatRequestSchema>;
