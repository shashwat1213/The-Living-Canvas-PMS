import { createApp } from './app.js';
import { env } from './config/env.js';
import { setContentProvider } from './platform/ai/registry.js';
import { tryActivateGroqFromEnv } from './platform/ai/groq-provider.js';
import { setChatProvider } from './platform/ai/chat-registry.js';
import { tryActivateGroqChatFromEnv } from './platform/ai/groq-chat-provider.js';
import { startJobWorker } from './platform/jobs/worker.js';
import { setPaymentProvider } from './platform/payments/registry.js';
import { tryActivateRazorpayFromEnv } from './platform/payments/razorpay-provider.js';

const app = createApp();

// Activate the real Razorpay payment provider if credentials are configured;
// otherwise the deterministic stub stays active (a normal dev/CI state). The
// whole online-payment flow runs either way — this is a one-line switch.
if (tryActivateRazorpayFromEnv(setPaymentProvider)) {
  console.log('[backend] payment provider: razorpay (live credentials detected)');
} else {
  console.log('[backend] payment provider: stub (no gateway credentials configured)');
}

// Activate the real Groq LLM content provider if GROQ_API_KEY is configured;
// otherwise the deterministic stub stays active. Same one-line switch — the
// Marketing Studio (and the AI assistant) use whichever is active.
const groqModel = tryActivateGroqFromEnv(setContentProvider);
if (groqModel) {
  console.log(`[backend] AI content provider: groq (${groqModel})`);
} else {
  console.log('[backend] AI content provider: stub (no GROQ_API_KEY configured)');
}

// Activate the real Groq chat provider (the in-app AI assistant) from the same
// GROQ_API_KEY; otherwise the deterministic stub stays active.
const groqChatModel = tryActivateGroqChatFromEnv(setChatProvider);
if (groqChatModel) {
  console.log(`[backend] AI chat provider: groq (${groqChatModel})`);
} else {
  console.log('[backend] AI chat provider: stub (no GROQ_API_KEY configured)');
}

app.listen(env.port, () => {
  console.log(`[backend] listening on port ${env.port} (${env.nodeEnv})`);
  // Start the in-process background-job worker (DB-backed queue). It polls
  // for ready jobs and drains them; safe to run in every app instance —
  // `FOR UPDATE SKIP LOCKED` guarantees no job is processed twice.
  startJobWorker();
  console.log('[backend] background job worker started');
});
