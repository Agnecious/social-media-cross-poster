import { Router } from 'express';
import { requireCustomer } from '../middleware/requireCustomer.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { prisma } from '../db/prisma.js';
import { isValidPlan, getPlan, planIds } from '../config/plans.js';
import { logger, errInfo } from '../services/logger.js';
import { recordAudit } from '../services/audit.js';
import { isMailEnabled, sendSupportEmail } from '../services/MailService.js';

/** Support priority derived from the customer's plan (server-side source of truth). */
function priorityForPlan(plan) {
  switch ((plan || '').toLowerCase()) {
    case 'agency':
      return 'High';
    case 'pro':
      return 'Normal';
    default:
      return 'Standard';
  }
}

/** Max length of a support message (guards against abuse / oversized payloads). */
const SUPPORT_MESSAGE_MAX = 4000;

const router = Router();

/**
 * Build a normalized subscription view for a customer row: current plan, the
 * subscription lifecycle status, whether the trial is still active, and how
 * many whole days of trial remain (0 once expired or if there's no trial).
 */
function subscriptionView(customer) {
  const now = Date.now();
  const trialEnds = customer.trialEndsAt ? new Date(customer.trialEndsAt) : null;
  const trialActive = !!trialEnds && trialEnds.getTime() > now;
  const trialDaysLeft = trialActive ? Math.ceil((trialEnds.getTime() - now) / 86400000) : 0;
  return {
    plan: customer.plan,
    planDetails: getPlan(customer.plan) ?? null,
    subscriptionStatus: customer.subscriptionStatus,
    planStatus: customer.planStatus,
    trialEndsAt: trialEnds,
    trialActive,
    trialDaysLeft,
  };
}

/**
 * GET /api/customer/me
 * Returns the authenticated customer's profile. Also confirms auth is wired.
 */
router.get('/me', requireCustomer, (req, res) => {
  const { id, email, plan, planStatus, createdAt } = req.customer;
  res.json({ id, email, plan, planStatus, createdAt });
});

/**
 * GET /api/customer/subscription
 * The customer's current plan + trial status (plan, subscriptionStatus,
 * trialActive, trialDaysLeft, trialEndsAt, and the plan's price/features).
 */
router.get('/subscription', requireCustomer, (req, res) => {
  res.json(subscriptionView(req.customer));
});

/**
 * PUT /api/customer/plan
 * Body: { plan }
 * Self-service upgrade/downgrade to any valid tier, anytime (DB only, no
 * payment). Keeps the trial running if it hasn't expired; once the trial has
 * ended, choosing a plan marks the subscription active.
 */
router.put('/plan', requireCustomer, async (req, res) => {
  const { plan } = req.body || {};
  if (!isValidPlan(plan)) {
    return res.status(400).json({ error: `Invalid plan. Must be one of: ${planIds().join(', ')}` });
  }

  const trialEnds = req.customer.trialEndsAt ? new Date(req.customer.trialEndsAt) : null;
  const trialActive = !!trialEnds && trialEnds.getTime() > Date.now();
  // While trialing, keep 'trialing'; otherwise the chosen plan is 'active'.
  const subscriptionStatus = trialActive ? 'trialing' : 'active';

  const previousPlan = req.customer.plan;
  try {
    const updated = await prisma.customer.update({
      where: { id: req.customer.id },
      data: { plan, subscriptionStatus },
    });
    void recordAudit(req, {
      action: 'customer.plan.change',
      targetType: 'customer',
      targetId: req.customer.id,
      targetLabel: req.customer.email ?? req.customer.id,
      metadata: { from: previousPlan, to: plan, subscriptionStatus },
    });
    res.json(subscriptionView(updated));
  } catch (err) {
    (req.log ?? logger).error('plan change error', { error: errInfo(err) });
    res.status(500).json({ error: 'Could not update your plan.' });
  }
});

/**
 * GET /api/customer/activity
 * The customer's own post history — scoped to their customerId ONLY.
 */
router.get('/activity', requireCustomer, async (req, res) => {
  const posts = await prisma.post.findMany({
    where: { customerId: req.customer.id },
    orderBy: { createdAt: 'desc' },
    take: 100,
  });
  res.json({ posts });
});

/**
 * POST /api/customer/support
 * Body: { message }
 *
 * Sends a support email server-side (when SMTP is configured) with a subject
 * encoding the customer's name + plan + priority — all derived server-side from
 * the authenticated customer, so they can't be spoofed. Rate-limited to blunt
 * abuse. When mail isn't configured, returns 503 so the client falls back to
 * its mailto: behaviour.
 */
router.post(
  '/support',
  requireCustomer,
  rateLimit({ windowMs: 15 * 60 * 1000, max: 5, message: 'Too many support messages. Please try again later.' }),
  async (req, res) => {
    if (!isMailEnabled()) {
      // Not configured — tell the client to use the mailto: fallback.
      return res.status(503).json({ error: 'Server-side email is not configured.', fallback: 'mailto' });
    }

    const raw = typeof req.body?.message === 'string' ? req.body.message.trim() : '';
    if (!raw) {
      return res.status(400).json({ error: 'A message is required.' });
    }
    const message = raw.slice(0, SUPPORT_MESSAGE_MAX);

    const c = req.customer;
    const fromName = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || (c.email ?? 'Customer');
    const priority = priorityForPlan(c.plan);

    try {
      await sendSupportEmail({
        fromName,
        fromEmail: c.email ?? '',
        plan: c.plan,
        priority,
        message,
      });
      void recordAudit(req, {
        action: 'customer.support.email',
        targetType: 'customer',
        targetId: c.id,
        targetLabel: c.email ?? c.id,
        metadata: { plan: c.plan, priority },
      });
      res.json({ ok: true });
    } catch (err) {
      (req.log ?? logger).error('support email route error', { error: errInfo(err) });
      res.status(502).json({ error: err instanceof Error ? err.message : 'Could not send your message.' });
    }
  }
);

export default router;
