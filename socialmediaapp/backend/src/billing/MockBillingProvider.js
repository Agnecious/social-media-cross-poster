import crypto from 'node:crypto';
import { BillingProvider } from './BillingProvider.js';

/**
 * MockBillingProvider — a fully working billing provider that charges NO real
 * money. It lets you exercise the entire subscribe → webhook → state-change
 * loop in development without a provider account.
 *
 * - startCheckout returns a fake subscription id and a redirect to the app's
 *   own mock-checkout screen (where the dev confirms/declines).
 * - The dev-only endpoint POST /api/billing/mock/complete emits a normalised
 *   webhook event (payment.succeeded / payment.failed / subscription.canceled).
 * - verifyWebhook accepts events carrying the configured BILLING_WEBHOOK_SECRET.
 */
export class MockBillingProvider extends BillingProvider {
  get key() {
    return 'mock';
  }

  async startCheckout({ customer, plan, returnUrl }) {
    const providerSubscriptionId = `mock_sub_${crypto.randomBytes(6).toString('hex')}`;
    // Point the browser at the app's own simulated hosted-checkout page. It
    // shows a fake card form (no real payment) and, on "Pay", completes the
    // checkout and sends the browser back to `returnUrl`. This mirrors how a
    // real provider redirects to its hosted page and back.
    const origin = deriveOrigin(returnUrl);
    const params = new URLSearchParams({
      plan: plan.id,
      sub: providerSubscriptionId,
      ret: returnUrl || `${origin}/billing`,
    });
    const redirectUrl = `${origin}/mock-checkout?${params.toString()}`;
    return {
      providerSubscriptionId,
      providerCustomerId: `mock_cus_${customer.id.slice(0, 8)}`,
      redirectUrl,
      checkoutId: providerSubscriptionId,
    };
  }

  async cancelSubscription(_providerSubscriptionId) {
    // Nothing to call — state is driven by the webhook the caller will emit.
    return { ok: true };
  }

  verifyWebhook(req) {
    // Accept if the shared secret matches (or if no secret is configured, in
    // which case we're clearly in a dev/mock setup).
    const secret = this.cfg?.webhookSecret || '';
    if (!secret) return true;
    return req.headers['x-billing-signature'] === secret;
  }

  parseWebhookEvent(body) {
    // The mock emits already-normalised events, so just pass through with
    // sensible defaults.
    return {
      eventId: body.eventId || `mock_evt_${crypto.randomBytes(6).toString('hex')}`,
      type: body.type,
      providerSubscriptionId: body.providerSubscriptionId,
      customerId: body.customerId,
      plan: body.plan,
      status: body.status,
      currentPeriodEnd: body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : undefined,
    };
  }
}

/**
 * Derive the app origin from the returnUrl the frontend passed (e.g.
 * "http://localhost:4200/billing" → "http://localhost:4200"). Falls back to the
 * localhost dev origin if none/parse fails.
 */
function deriveOrigin(returnUrl) {
  try {
    if (returnUrl) return new URL(returnUrl).origin;
  } catch {
    // ignore
  }
  return 'http://localhost:4200';
}
