import crypto from 'node:crypto';
import { BillingProvider } from './BillingProvider.js';
import { http } from '../services/http.js';
import { logger } from '../services/logger.js';

/**
 * PeachBillingProvider — Peach Payments adapter (REST, no SDK, so it works
 * behind the corporate npm/SSL block via the shared `http` client).
 *
 * STATUS: STUB. Peach's recurring/subscription APIs and webhook format need to
 * be filled in once a merchant account + credentials exist. The method
 * signatures and the webhook normalisation are laid out so completing it is a
 * localized change — nothing else in the app needs to know.
 *
 * Config comes from billingConfig().peach: { entityId, accessToken, baseUrl }.
 */
export class PeachBillingProvider extends BillingProvider {
  get key() {
    return 'peach';
  }

  async startCheckout({ customer, plan, returnUrl }) {
    // TODO(peach): create a registration/checkout for a recurring subscription
    // via Peach's Checkout/Tokenization API and return its hosted redirect URL.
    // Shape (to confirm against Peach docs):
    //   const { data } = await http.post(`${this.cfg.baseUrl}/v2/checkout`, {...}, {
    //     headers: { Authorization: `Bearer ${this.cfg.accessToken}` } });
    //   return { providerSubscriptionId: data.id, redirectUrl: data.redirectUrl };
    logger.warn('PeachBillingProvider.startCheckout is a stub — configure Peach to enable real billing', {
      customerId: customer?.id,
      plan: plan?.id,
      returnUrl,
      hasCreds: !!(this.cfg?.peach?.entityId && this.cfg?.peach?.accessToken),
    });
    throw new Error('Peach billing is not configured yet. Set BILLING_PROVIDER=mock for testing.');
  }

  async cancelSubscription(_providerSubscriptionId) {
    // TODO(peach): call Peach's cancel endpoint.
    throw new Error('Peach billing is not configured yet.');
  }

  verifyWebhook(req) {
    // TODO(peach): verify Peach's webhook signature per their docs. For now,
    // fall back to the shared-secret header check so a configured secret still
    // gates inbound calls.
    const secret = this.cfg?.webhookSecret || '';
    if (!secret) return false; // never accept unverified webhooks for a real provider
    const sig = req.headers['x-billing-signature'] || '';
    // Constant-time compare to avoid timing leaks.
    const a = Buffer.from(String(sig));
    const b = Buffer.from(secret);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  parseWebhookEvent(body) {
    // TODO(peach): map Peach's event payload onto our normalised shape:
    //   { eventId, type: 'payment.succeeded'|'payment.failed'|'subscription.canceled'|'subscription.activated',
    //     providerSubscriptionId, customerId, plan, status, currentPeriodEnd }
    return {
      eventId: body.id || body.eventId,
      type: body.type,
      providerSubscriptionId: body.subscriptionId,
      customerId: body.customerId,
      plan: body.plan,
      status: body.status,
      currentPeriodEnd: body.currentPeriodEnd ? new Date(body.currentPeriodEnd) : undefined,
    };
  }
}
