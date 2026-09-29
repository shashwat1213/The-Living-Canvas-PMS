import { createHmac, timingSafeEqual } from 'node:crypto';

import type {
  CreatedOrder,
  CreateOrderRequest,
  PaymentProvider,
  VerifiedPayment,
  VerifyPaymentRequest,
} from './provider.js';

/**
 * The real Razorpay adapter — code-ready, activated by credentials.
 *
 * It is deliberately NOT wired in by default: `platform/payments/registry.ts`
 * ships the stub provider, and this adapter is swapped in with
 * `setPaymentProvider(createRazorpayProvider({ keyId, keySecret }))` at startup
 * only when `RAZORPAY_KEY_ID` / `RAZORPAY_KEY_SECRET` are present. That keeps
 * the whole flow runnable in dev/CI with no account while the production path
 * is a one-line switch — the same shape the AI and notification seams use.
 *
 * Security posture (ARCHITECTURE.md: "Razorpay, tokenized only"):
 * - We never see or store raw card data — the client SDK collects it and the
 *   PMS only ever holds gateway references (order id, payment id).
 * - Verification is the security-critical step: the client return is signed by
 *   Razorpay with the secret key, and we recompute `HMAC_SHA256(order|payment)`
 *   and constant-time compare, per Razorpay's own `validatePaymentVerification`.
 *   A bad signature throws — success is never returned without proof.
 *
 * `createOrder` calls Razorpay's Orders API over HTTPS with Basic auth; no SDK
 * dependency is required (a single fetch), so adding this adapter pulls in no
 * new package.
 */
export interface RazorpayConfig {
  keyId: string;
  keySecret: string;
  /** Override for tests; defaults to Razorpay's live API base. */
  apiBase?: string;
}

export function createRazorpayProvider(config: RazorpayConfig): PaymentProvider {
  const apiBase = config.apiBase ?? 'https://api.razorpay.com/v1';

  return {
    key: 'razorpay',

    async createOrder(request: CreateOrderRequest): Promise<CreatedOrder> {
      const auth = Buffer.from(`${config.keyId}:${config.keySecret}`).toString('base64');
      const res = await fetch(`${apiBase}/orders`, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          amount: request.amountMinor, // Razorpay amounts are in paise, like ours.
          currency: request.currency,
          receipt: request.intentId, // ties the gateway order back to our intent.
          notes: { intentId: request.intentId },
        }),
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => '');
        throw new Error(`Razorpay order creation failed (${res.status}): ${detail.slice(0, 200)}`);
      }
      const order = (await res.json()) as { id: string };
      return { gatewayOrderId: order.id };
    },

    async verifyPayment(request: VerifyPaymentRequest): Promise<VerifiedPayment> {
      // Razorpay signs `${order_id}|${payment_id}` with the key secret.
      const expected = createHmac('sha256', config.keySecret)
        .update(`${request.gatewayOrderId}|${request.gatewayPaymentId}`)
        .digest('hex');
      const a = Buffer.from(expected);
      const b = Buffer.from(request.signature);
      if (a.length !== b.length || !timingSafeEqual(a, b)) {
        throw new Error('Razorpay signature verification failed.');
      }
      return { gatewayPaymentId: request.gatewayPaymentId };
    },
  };
}

/**
 * Wire the Razorpay provider from environment at startup, if configured.
 * Returns true when activated. Call from `index.ts`/app bootstrap; a missing
 * credential is a normal dev/CI state, not an error — the stub stays active.
 */
export function tryActivateRazorpayFromEnv(
  setProvider: (p: PaymentProvider) => void,
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const keyId = env.RAZORPAY_KEY_ID;
  const keySecret = env.RAZORPAY_KEY_SECRET;
  if (!keyId || !keySecret) return false;
  setProvider(createRazorpayProvider({ keyId, keySecret }));
  return true;
}
