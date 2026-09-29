import { createApp } from './app.js';
import { env } from './config/env.js';
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

app.listen(env.port, () => {
  console.log(`[backend] listening on port ${env.port} (${env.nodeEnv})`);
  // Start the in-process background-job worker (DB-backed queue). It polls
  // for ready jobs and drains them; safe to run in every app instance —
  // `FOR UPDATE SKIP LOCKED` guarantees no job is processed twice.
  startJobWorker();
  console.log('[backend] background job worker started');
});
