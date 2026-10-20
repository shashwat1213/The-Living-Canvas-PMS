import { setChatProvider } from './platform/ai/chat-registry.js';
import { tryActivateGroqChatFromEnv } from './platform/ai/groq-chat-provider.js';
import { tryActivateGroqFromEnv } from './platform/ai/groq-provider.js';
import { setContentProvider } from './platform/ai/registry.js';
import { initErrorTracking } from './platform/observability/sentry.js';
import { setPaymentProvider } from './platform/payments/registry.js';
import { tryActivateRazorpayFromEnv } from './platform/payments/razorpay-provider.js';

/**
 * Process-level wiring shared by the long-running server (`index.ts`) and
 * the serverless entry (`serverless.ts`): error tracking + the real
 * payment/AI providers when their credentials are configured (otherwise the
 * deterministic stubs stay active — a normal dev/CI state).
 */
let configured = false;

export function configureProviders(): void {
  if (configured) return;
  configured = true;
  initErrorTracking();

  console.log(
    tryActivateRazorpayFromEnv(setPaymentProvider)
      ? '[backend] payment provider: razorpay (live credentials detected)'
      : '[backend] payment provider: stub (no gateway credentials configured)',
  );
  const groqModel = tryActivateGroqFromEnv(setContentProvider);
  console.log(groqModel ? `[backend] AI content provider: groq (${groqModel})` : '[backend] AI content provider: stub');
  const groqChatModel = tryActivateGroqChatFromEnv(setChatProvider);
  console.log(groqChatModel ? `[backend] AI chat provider: groq (${groqChatModel})` : '[backend] AI chat provider: stub');
}
