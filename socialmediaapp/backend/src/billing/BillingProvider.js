/**
 * BillingProvider — the contract every payment provider adapter implements
 * (Strategy pattern, mirroring PlatformPublisher). The rest of the app depends
 * only on this shape, never on a concrete provider, so swapping Mock ↔ Peach
 * is a one-line factory change.
 *
 * The app NEVER handles raw card data. A provider hosts the payment page; the
 * customer is redirected there; the provider reports the outcome back to us via
 * a signed webhook. So the flow is:
 *   startCheckout() -> { redirectUrl | clientConfig }  (customer pays there)
 *   provider -> POST /api/billing/webhook              (we update state)
 */
export class BillingProvider {
  /** @param {object} cfg provider config slice from billingConfig() */
  constructor(cfg) {
    if (new.target === BillingProvider) {
      throw new Error('BillingProvider is abstract.');
    }
    this.cfg = cfg;
  }

  /** Stable provider key, e.g. 'mock' | 'peach'. */
  get key() {
    throw new Error('key not implemented');
  }

  /**
   * Begin subscribing a customer to a plan. Returns what the frontend needs to
   * collect payment — typically a hosted-checkout redirect URL.
   *
   * @param {object} args
   * @param {object} args.customer   { id, email }
   * @param {object} args.plan       the plan from the catalogue { id, name, priceZar }
   * @param {string} args.returnUrl  where the provider should send the user back
   * @returns {Promise<{ providerSubscriptionId?: string, providerCustomerId?: string, redirectUrl?: string, checkoutId?: string }>}
   */
  async startCheckout(_args) {
    throw new Error('startCheckout not implemented');
  }

  /** Cancel a subscription at the provider. */
  async cancelSubscription(_providerSubscriptionId) {
    throw new Error('cancelSubscription not implemented');
  }

  /**
   * Verify an inbound webhook's authenticity (signature/secret). Return true if
   * it genuinely came from the provider.
   * @param {object} req the Express request (headers + rawBody/body)
   * @returns {boolean}
   */
  verifyWebhook(_req) {
    throw new Error('verifyWebhook not implemented');
  }

  /**
   * Normalise a provider webhook body into our internal event shape.
   * @param {object} body parsed webhook JSON
   * @returns {{ eventId: string, type: string, providerSubscriptionId?: string, customerId?: string, plan?: string, status?: string, currentPeriodEnd?: Date }}
   *   `type` is one of: subscription.activated | payment.succeeded |
   *   payment.failed | subscription.canceled (providers map their own events
   *   onto these).
   */
  parseWebhookEvent(_body) {
    throw new Error('parseWebhookEvent not implemented');
  }
}
