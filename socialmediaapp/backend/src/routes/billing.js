import { Router } from 'express';
import { requireCustomer } from '../middleware/requireCustomer.js';
import { prisma } from '../db/prisma.js';
import { getPlan, isValidPlan, trialMaxPosts } from '../config/plans.js';
import { billingConfig } from '../config/index.js';
import { getBillingProvider, isBillingEnabled } from '../billing/index.js';
import {
  beginCheckout,
  applyWebhookEvent,
  startTrial,
  accessState,
  trialPublishAllowance,
  cancelSubscription,
} from '../services/subscriptionState.js';
import { recordAudit } from '../services/audit.js';
import { logger, errInfo } from '../services/logger.js';

const router = Router();

/**
 * Billing routes (Layer 1).
 *  - Customer-scoped: start checkout, read billing status (require a customer).
 *  - Public: the provider webhook receiver + a dev-only mock "complete".
 *
 * The app never touches card data — a provider hosts payment; webhooks drive
 * the subscription state. When BILLING_ENABLED is false these are inert.
 */

/** Normalised billing status for the frontend. */
function billingView(customer, subscription) {
  const access = accessState(customer);
  const allowance = trialPublishAllowance(customer);
  return {
    enabled: isBillingEnabled(),
    provider: billingConfig().provider,
    plan: customer.plan,
    planDetails: getPlan(customer.plan) ?? null,
    subscriptionStatus: customer.subscriptionStatus,
    access, // { allowed, reason? }
    trial: {
      postsUsed: customer.trialPostsUsed ?? 0,
      maxPosts: trialMaxPosts(),
      trialEndsAt: customer.trialEndsAt ?? null,
      publishAllowed: allowance.allowed,
    },
    subscription: subscription
      ? { status: subscription.status, provider: subscription.provider, currentPeriodEnd: subscription.currentPeriodEnd }
      : null,
  };
}

/** GET /api/customer/billing — current billing/subscription status. */
router.get('/', requireCustomer, async (req, res) => {
  const subscription = await prisma.subscription.findUnique({ where: { customerId: req.customer.id } });
  res.json(billingView(req.customer, subscription));
});

/**
 * POST /api/customer/billing/subscribe  Body: { plan, returnUrl? }
 * Start checkout for the chosen plan. Returns what the frontend needs to
 * collect payment (a redirect URL). Records a pending subscription.
 */
router.post('/subscribe', requireCustomer, async (req, res) => {
  if (!isBillingEnabled()) {
    return res.status(503).json({ error: 'Billing is not enabled.' });
  }
  const { plan, returnUrl } = req.body || {};
  if (!isValidPlan(plan)) {
    return res.status(400).json({ error: 'Invalid plan.' });
  }
  try {
    const provider = getBillingProvider();
    const planObj = getPlan(plan);
    const checkout = await provider.startCheckout({
      customer: { id: req.customer.id, email: req.customer.email },
      plan: planObj,
      returnUrl: returnUrl || '',
    });
    await beginCheckout(req.customer, plan, provider.key, {
      providerSubscriptionId: checkout.providerSubscriptionId,
      providerCustomerId: checkout.providerCustomerId,
    });
    void recordAudit(req, {
      action: 'billing.checkout.start',
      targetType: 'customer',
      targetId: req.customer.id,
      targetLabel: req.customer.email ?? req.customer.id,
      metadata: { plan, provider: provider.key },
    });
    res.json({ redirectUrl: checkout.redirectUrl, checkoutId: checkout.checkoutId, provider: provider.key });
  } catch (err) {
    (req.log ?? logger).error('billing subscribe failed', { error: errInfo(err) });
    res.status(502).json({ error: err.message || 'Could not start checkout.' });
  }
});

/**
 * POST /api/customer/billing/cancel
 * Cancel the signed-in customer's subscription. Asks the provider to stop
 * future charges (best-effort), then marks the subscription canceled locally.
 */
router.post('/cancel', requireCustomer, async (req, res) => {
  if (!isBillingEnabled()) {
    return res.status(503).json({ error: 'Billing is not enabled.' });
  }
  try {
    const provider = getBillingProvider();
    const result = await cancelSubscription(req.customer, provider);
    void recordAudit(req, {
      action: 'billing.cancel',
      targetType: 'customer',
      targetId: req.customer.id,
      targetLabel: req.customer.email ?? req.customer.id,
      metadata: { provider: provider.key, remote: result.remote },
    });
    const subscription = await prisma.subscription.findUnique({ where: { customerId: req.customer.id } });
    const fresh = await prisma.customer.findUnique({ where: { id: req.customer.id } });
    res.json(billingView(fresh, subscription));
  } catch (err) {
    (req.log ?? logger).error('billing cancel failed', { error: errInfo(err) });
    res.status(502).json({ error: err.message || 'Could not cancel your subscription.' });
  }
});

/**
 * POST /api/billing/webhook  (PUBLIC — provider calls this)
 * Verifies the signature, records the event idempotently, and drives the
 * subscription state machine. Always returns 200 quickly for known events so
 * the provider doesn't retry needlessly; 400 for unverified.
 */
router.post('/webhook', async (req, res) => {
  const provider = getBillingProvider();
  if (!provider.verifyWebhook(req)) {
    (req.log ?? logger).warn('billing webhook: signature verification failed', { provider: provider.key });
    return res.status(400).json({ error: 'Invalid signature.' });
  }

  let evt;
  try {
    evt = provider.parseWebhookEvent(req.body || {});
  } catch (err) {
    (req.log ?? logger).error('billing webhook: parse failed', { error: errInfo(err) });
    return res.status(400).json({ error: 'Unparseable event.' });
  }
  if (!evt?.eventId || !evt?.type) {
    return res.status(400).json({ error: 'Missing event id/type.' });
  }

  // Idempotency: the unique (provider, eventId) makes a duplicate a no-op.
  try {
    await prisma.paymentEvent.create({
      data: {
        provider: provider.key,
        eventId: evt.eventId,
        type: evt.type,
        customerId: evt.customerId ?? null,
        payload: safeJson(evt),
      },
    });
  } catch (err) {
    if (err?.code === 'P2002') {
      // Already processed — acknowledge and stop.
      return res.json({ ok: true, duplicate: true });
    }
    (req.log ?? logger).error('billing webhook: store failed', { error: errInfo(err) });
    return res.status(500).json({ error: 'Could not record event.' });
  }

  // Resolve the affected customer (by id, or via the subscription id).
  let customer = null;
  if (evt.customerId) {
    customer = await prisma.customer.findUnique({ where: { id: evt.customerId } });
  }
  if (!customer && evt.providerSubscriptionId) {
    const sub = await prisma.subscription.findFirst({
      where: { providerSubscriptionId: evt.providerSubscriptionId },
    });
    if (sub) customer = await prisma.customer.findUnique({ where: { id: sub.customerId } });
  }
  if (!customer) {
    (req.log ?? logger).warn('billing webhook: no matching customer', { eventId: evt.eventId });
    return res.json({ ok: true, matched: false });
  }

  try {
    const status = await applyWebhookEvent(evt, customer);
    (req.log ?? logger).info('billing webhook applied', { type: evt.type, customerId: customer.id, status });
    res.json({ ok: true, status });
  } catch (err) {
    (req.log ?? logger).error('billing webhook: apply failed', { error: errInfo(err) });
    res.status(500).json({ error: 'Could not apply event.' });
  }
});

/**
 * POST /api/billing/mock/complete  (DEV-ONLY, mock provider)
 * Simulates the provider finishing checkout: starts the trial, or emits a
 * paid/failed/canceled outcome. Only works when BILLING_PROVIDER=mock.
 * Body: { outcome: 'trial'|'paid'|'failed'|'canceled' }  (requires a customer)
 */
router.post('/mock/complete', requireCustomer, async (req, res) => {
  if (billingConfig().provider !== 'mock') {
    return res.status(404).json({ error: 'Not found.' });
  }
  const outcome = (req.body?.outcome || 'trial').toLowerCase();
  try {
    let status;
    if (outcome === 'trial') {
      status = await startTrial(req.customer);
    } else {
      const typeMap = {
        paid: 'payment.succeeded',
        failed: 'payment.failed',
        canceled: 'subscription.canceled',
      };
      const type = typeMap[outcome];
      if (!type) return res.status(400).json({ error: 'Invalid outcome.' });
      status = await applyWebhookEvent({ eventId: `mock_${Date.now()}`, type, customerId: req.customer.id }, req.customer);
    }
    void recordAudit(req, {
      action: 'billing.mock.complete',
      targetType: 'customer',
      targetId: req.customer.id,
      targetLabel: req.customer.email ?? req.customer.id,
      metadata: { outcome, status },
    });
    const subscription = await prisma.subscription.findUnique({ where: { customerId: req.customer.id } });
    const fresh = await prisma.customer.findUnique({ where: { id: req.customer.id } });
    res.json(billingView(fresh, subscription));
  } catch (err) {
    (req.log ?? logger).error('mock complete failed', { error: errInfo(err) });
    res.status(500).json({ error: 'Could not complete mock checkout.' });
  }
});

function safeJson(obj) {
  try {
    const s = JSON.stringify(obj);
    return s.length > 4000 ? s.slice(0, 4000) : s;
  } catch {
    return null;
  }
}

export default router;
