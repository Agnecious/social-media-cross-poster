import crypto from 'node:crypto';
import { BillingProvider } from './BillingProvider.js';
import { http } from '../services/http.js';
import { logger, errInfo } from '../services/logger.js';

/**
 * PaystackBillingProvider — Paystack adapter with RECURRING subscriptions
 * (auto-renews every interval until the customer cancels). REST via the shared
 * `http` client (no SDK).
 *
 * Recurring model:
 *   1. Each pricing tier maps to a Paystack **Plan** (amount + monthly interval).
 *      We resolve-or-create the Plan on demand and cache its plan_code.
 *   2. startCheckout → POST /transaction/initialize with { plan: <plan_code> }.
 *      When the customer pays the first charge, Paystack AUTO-CREATES a
 *      subscription on that card and keeps charging monthly until cancelled.
 *   3. Webhooks drive state: subscription.create (activated) + recurring
 *      charge.success (active), invoice.* (failed/upcoming), and
 *      subscription.disable / not_renew (canceled).
 *   4. cancelSubscription → POST /subscription/disable with the subscription
 *      code + email token (both captured from the subscription.create webhook).
 *
 * Config (billingConfig().paystack): { secretKey, publicKey, baseUrl, currency }.
 * The app never handles card data — Paystack hosts the payment page.
 */
export class PaystackBillingProvider extends BillingProvider {
  /** In-process cache of planId → Paystack plan_code (cleared on restart). */
  #planCache = new Map();

  get key() {
    return 'paystack';
  }

  get #secret() {
    return this.cfg?.paystack?.secretKey || '';
  }

  get #baseUrl() {
    return this.cfg?.paystack?.baseUrl || 'https://api.paystack.co';
  }

  get #currency() {
    return this.cfg?.paystack?.currency || 'ZAR';
  }

  #headers() {
    return { Authorization: `Bearer ${this.#secret}`, 'Content-Type': 'application/json' };
  }

  /**
   * Resolve (or create) the Paystack Plan for a tier and return its plan_code.
   * Plans are keyed by a stable name derived from our plan id + price so a
   * price change creates a new plan rather than silently keeping the old amount.
   */
  async #resolvePlanCode(plan) {
    const priceZar = Number(plan?.priceZar);
    if (!Number.isFinite(priceZar) || priceZar <= 0) {
      throw new Error(`Plan "${plan?.id}" has no chargeable price for Paystack.`);
    }
    const amount = Math.round(priceZar * 100); // minor units
    const name = `${plan.id}-${this.#currency}-${amount}`; // stable identity
    if (this.#planCache.has(name)) return this.#planCache.get(name);

    // Try to find an existing plan with this name (idempotent across restarts).
    try {
      const { data: list } = await http.get(`${this.#baseUrl}/plan`, {
        headers: this.#headers(),
        params: { perPage: 100 },
      });
      const found = (list?.data || []).find((p) => p.name === name);
      if (found?.plan_code) {
        this.#planCache.set(name, found.plan_code);
        return found.plan_code;
      }
    } catch (err) {
      logger.warn('paystack plan list failed (will try create)', { error: errInfo(err) });
    }

    // Create it.
    const { data } = await http.post(
      `${this.#baseUrl}/plan`,
      { name, amount, interval: 'monthly', currency: this.#currency },
      { headers: this.#headers() }
    );
    const code = data?.data?.plan_code;
    if (!code) throw new Error(data?.message || 'Could not create Paystack plan.');
    this.#planCache.set(name, code);
    return code;
  }

  /**
   * Initialise a transaction tied to the tier's Plan. Paying it starts a
   * recurring subscription. `metadata` carries our ids for the webhook.
   */
  async startCheckout({ customer, plan, returnUrl }) {
    if (!this.#secret) {
      throw new Error('Paystack is not configured (missing PAYSTACK_SECRET_KEY).');
    }
    const priceZar = Number(plan?.priceZar);
    if (!Number.isFinite(priceZar) || priceZar <= 0) {
      throw new Error(`Plan "${plan?.id}" has no chargeable price for Paystack.`);
    }

    const planCode = await this.#resolvePlanCode(plan);
    const reference = `sub_${plan.id}_${customer.id.slice(0, 8)}_${crypto.randomBytes(5).toString('hex')}`;
    const body = {
      email: customer.email,
      amount: Math.round(priceZar * 100),
      currency: this.#currency,
      plan: planCode, // ← ties the charge to a recurring Plan (auto-renew)
      reference,
      callback_url: returnUrl || undefined,
      metadata: { customerId: customer.id, plan: plan.id },
    };

    try {
      const { data } = await http.post(`${this.#baseUrl}/transaction/initialize`, body, {
        headers: this.#headers(),
      });
      if (!data?.status || !data?.data?.authorization_url) {
        throw new Error(data?.message || 'Paystack did not return a checkout URL.');
      }
      return {
        providerSubscriptionId: data.data.reference || reference, // updated to sub code on subscription.create
        providerCustomerId: customer.id,
        redirectUrl: data.data.authorization_url,
        checkoutId: data.data.access_code || reference,
      };
    } catch (err) {
      logger.error('paystack initialize failed', { error: errInfo(err) });
      throw new Error(err?.response?.data?.message || 'Could not start Paystack checkout.');
    }
  }

  /**
   * Cancel (disable) a recurring subscription. Paystack requires BOTH the
   * subscription code and the email token (captured from the subscription.create
   * webhook and stored on our Subscription row as providerSubscriptionId +
   * providerToken). After this, Paystack stops future charges.
   *
   * @param {string} providerSubscriptionId the Paystack subscription_code
   * @param {object} opts { token } the email token
   */
  async cancelSubscription(providerSubscriptionId, opts = {}) {
    if (!this.#secret) throw new Error('Paystack is not configured.');
    const token = opts.token;
    if (!providerSubscriptionId || !token) {
      // Nothing to disable at the provider (e.g. the subscription.create webhook
      // never arrived). The app still marks it canceled locally.
      logger.warn('paystack cancel: missing subscription code or token — local-only cancel', {
        hasCode: !!providerSubscriptionId,
        hasToken: !!token,
      });
      return { ok: true, remote: false };
    }
    try {
      await http.post(
        `${this.#baseUrl}/subscription/disable`,
        { code: providerSubscriptionId, token },
        { headers: this.#headers() }
      );
      return { ok: true, remote: true };
    } catch (err) {
      logger.error('paystack subscription disable failed', { error: errInfo(err) });
      throw new Error(err?.response?.data?.message || 'Could not cancel the subscription at Paystack.');
    }
  }

  /** HMAC-SHA512(rawBody, secretKey) must equal x-paystack-signature. */
  verifyWebhook(req) {
    const secret = this.#secret;
    if (!secret) return false;
    const signature = req.headers['x-paystack-signature'];
    if (!signature) return false;
    const payload =
      req.rawBody instanceof Buffer ? req.rawBody : Buffer.from(JSON.stringify(req.body ?? {}));
    const expected = crypto.createHmac('sha512', secret).update(payload).digest('hex');
    const a = Buffer.from(String(signature));
    const b = Buffer.from(expected);
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }

  /**
   * Normalise a Paystack event. For recurring, the important ones:
   *   subscription.create   → subscription.activated; carries subscription_code
   *                           + email_token (we persist these for cancel) and
   *                           the plan.
   *   charge.success        → payment.succeeded (first + every renewal → active)
   *   invoice.payment_failed→ payment.failed (→ past_due)
   *   subscription.disable /
   *     subscription.not_renew → subscription.canceled
   */
  parseWebhookEvent(body) {
    const event = body?.event || '';
    const d = body?.data || {};
    const meta = d.metadata || {};

    let type;
    switch (event) {
      case 'charge.success':
        type = 'payment.succeeded';
        break;
      case 'subscription.create':
        type = 'subscription.activated';
        break;
      case 'invoice.payment_failed':
        type = 'payment.failed';
        break;
      case 'subscription.disable':
      case 'subscription.not_renew':
        type = 'subscription.canceled';
        break;
      default:
        type = event; // unknown → ignored by the state machine
    }

    // Paystack places plan/customer differently per event. Try the common spots.
    const planFromPlanObj = d.plan && (d.plan.name || d.plan.plan_code);
    const planId = meta.plan || extractPlanId(planFromPlanObj);
    const customerId = meta.customerId || undefined;

    // The subscription code + email token (present on subscription.* events).
    const subscriptionCode = d.subscription_code || undefined;
    const emailToken = d.email_token || undefined;

    const ref = subscriptionCode || d.reference || d.id || crypto.randomBytes(8).toString('hex');
    const periodEnd = d.next_payment_date || d.paid_at || undefined;

    return {
      eventId: `${event}:${ref}`,
      type,
      providerSubscriptionId: subscriptionCode || d.reference || undefined,
      providerToken: emailToken, // consumed by the state machine when present
      customerId,
      plan: isKnownPlanId(planId) ? planId : undefined,
      status: d.status || undefined,
      currentPeriodEnd: periodEnd ? new Date(periodEnd) : undefined,
    };
  }
}

/** Our plan names on Paystack are "<planId>-<CUR>-<amount>"; pull the planId. */
function extractPlanId(name) {
  if (!name || typeof name !== 'string') return undefined;
  const first = name.split('-')[0];
  return first || undefined;
}

/** Guard so a stray plan name never overwrites the customer's plan. */
function isKnownPlanId(id) {
  return id === 'starter' || id === 'pro' || id === 'agency';
}
