import { prisma } from '../db/prisma.js';
import { trialDays, trialMaxPosts, isValidPlan } from '../config/plans.js';
import { logger } from './logger.js';

/**
 * subscriptionState — the single place that owns how a customer's billing
 * lifecycle moves, and what each state is allowed to do.
 *
 * States (Customer.subscriptionStatus):
 *   pending_setup — signed up, no plan/billing yet → BLOCKED from the app.
 *   trialing      — billing on file, in trial window → allowed, but capped at
 *                   TRIAL_MAX_POSTS successful cross-posts.
 *   active        — paying → full access.
 *   past_due      — a renewal payment failed → BLOCKED until resolved.
 *   canceled      — subscription ended → BLOCKED.
 *
 * Transitions are driven by provider webhook events, never by ad-hoc toggles.
 */

/** Begin a checkout: record the chosen plan + a pending subscription row. */
export async function beginCheckout(customer, plan, provider, ids = {}) {
  if (!isValidPlan(plan)) throw new Error(`Invalid plan: ${plan}`);
  await prisma.subscription.upsert({
    where: { customerId: customer.id },
    update: {
      provider,
      plan,
      status: 'pending',
      providerSubscriptionId: ids.providerSubscriptionId ?? undefined,
      providerCustomerId: ids.providerCustomerId ?? undefined,
    },
    create: {
      customerId: customer.id,
      provider,
      plan,
      status: 'pending',
      providerSubscriptionId: ids.providerSubscriptionId ?? null,
      providerCustomerId: ids.providerCustomerId ?? null,
    },
  });
  // Record the chosen plan on the customer now; access stays gated until a
  // webhook activates the trial/subscription.
  await prisma.customer.update({ where: { id: customer.id }, data: { plan } });
}

/**
 * Apply a normalised webhook event to the customer's subscription + status.
 * Returns the resulting subscriptionStatus. Idempotency is handled by the
 * caller (PaymentEvent unique constraint); this just maps event → state.
 *
 * @param {object} evt normalised event from provider.parseWebhookEvent
 * @param {object} customer the resolved Customer row
 */
export async function applyWebhookEvent(evt, customer) {
  let subscriptionStatus;
  let subStatus;
  const data = {};

  switch (evt.type) {
    case 'subscription.activated':
    case 'payment.succeeded': {
      // First successful payment starts (or continues) the trial window if the
      // customer hasn't trialed yet; a later renewal moves them to active.
      // Simpler + predictable: a succeeded payment means they're paid → active.
      subscriptionStatus = 'active';
      subStatus = 'active';
      data.trialEndsAt = customer.trialEndsAt ?? null;
      break;
    }
    case 'trial.started': {
      subscriptionStatus = 'trialing';
      subStatus = 'trialing';
      data.trialEndsAt = new Date(Date.now() + trialDays() * 86400000);
      data.trialPostsUsed = 0;
      break;
    }
    case 'payment.failed': {
      subscriptionStatus = 'past_due';
      subStatus = 'past_due';
      break;
    }
    case 'subscription.canceled': {
      subscriptionStatus = 'canceled';
      subStatus = 'canceled';
      break;
    }
    default:
      logger.warn('billing: unknown webhook event type', { type: evt.type });
      return customer.subscriptionStatus;
  }

  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customer.id },
      data: { subscriptionStatus, ...data },
    }),
    prisma.subscription.updateMany({
      where: { customerId: customer.id },
      data: {
        status: subStatus,
        plan: evt.plan && isValidPlan(evt.plan) ? evt.plan : undefined,
        currentPeriodEnd: evt.currentPeriodEnd ?? undefined,
        // Capture the provider's subscription code + management token when they
        // arrive (e.g. Paystack's subscription.create) so we can cancel later.
        providerSubscriptionId: evt.providerSubscriptionId ?? undefined,
        providerToken: evt.providerToken ?? undefined,
      },
    }),
  ]);

  return subscriptionStatus;
}

/**
 * Start the trial for a customer whose billing setup just completed. Used by
 * the mock "complete" flow (and real providers that signal trial start). Moves
 * pending_setup → trialing with a fresh window + zeroed post count.
 */
export async function startTrial(customer) {
  const trialEndsAt = new Date(Date.now() + trialDays() * 86400000);
  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customer.id },
      data: { subscriptionStatus: 'trialing', trialEndsAt, trialPostsUsed: 0 },
    }),
    prisma.subscription.updateMany({
      where: { customerId: customer.id },
      data: { status: 'trialing' },
    }),
  ]);
  return 'trialing';
}

/**
 * Cancel a customer's subscription: ask the provider to disable future charges
 * (best-effort), then mark the local subscription + customer `canceled`. The
 * customer keeps access until their paid period ends only if you choose to —
 * here we gate immediately on canceled (accessState blocks it), which is the
 * simplest predictable behaviour.
 *
 * @param {object} customer the Customer row
 * @param {import('../billing/BillingProvider.js').BillingProvider} provider
 * @returns {Promise<{ status: string, remote: boolean }>}
 */
export async function cancelSubscription(customer, provider) {
  const sub = await prisma.subscription.findUnique({ where: { customerId: customer.id } });

  let remote = false;
  if (sub?.providerSubscriptionId) {
    // Best-effort provider cancel; never block the local cancel on a provider error.
    try {
      const res = await provider.cancelSubscription(sub.providerSubscriptionId, {
        token: sub.providerToken ?? undefined,
      });
      remote = !!res?.remote;
    } catch (err) {
      logger.warn('provider cancel failed — proceeding with local cancel', { error: String(err?.message || err) });
    }
  }

  await prisma.$transaction([
    prisma.customer.update({
      where: { id: customer.id },
      data: { subscriptionStatus: 'canceled' },
    }),
    prisma.subscription.updateMany({
      where: { customerId: customer.id },
      data: { status: 'canceled' },
    }),
  ]);

  return { status: 'canceled', remote };
}

/**
 * Access decision for the app's gated actions.
 * @param {object} customer
 * @returns {{ allowed: boolean, reason?: string }}
 *   reason: 'pending_setup' | 'trial_expired' | 'past_due' | 'canceled'
 */
export function accessState(customer) {
  const status = customer?.subscriptionStatus;
  if (status === 'active') return { allowed: true };
  if (status === 'trialing') {
    const ends = customer.trialEndsAt ? new Date(customer.trialEndsAt) : null;
    if (ends && ends.getTime() <= Date.now()) return { allowed: false, reason: 'trial_expired' };
    return { allowed: true };
  }
  if (status === 'past_due') return { allowed: false, reason: 'past_due' };
  if (status === 'canceled') return { allowed: false, reason: 'canceled' };
  // pending_setup (default for new signups) or anything unexpected.
  return { allowed: false, reason: 'pending_setup' };
}

/**
 * Whether a trialing customer may still publish (hasn't hit the post cap).
 * Active customers are unlimited. Returns { allowed, used, max }.
 */
export function trialPublishAllowance(customer) {
  if (customer?.subscriptionStatus !== 'trialing') {
    return { allowed: true, used: 0, max: 0, trialing: false };
  }
  const max = trialMaxPosts();
  const used = customer.trialPostsUsed ?? 0;
  return { allowed: used < max, used, max, trialing: true };
}
