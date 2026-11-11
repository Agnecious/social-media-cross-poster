import { Router } from 'express';
import { PLATFORM_KEYS, getPlatforms, billingConfig } from '../config/index.js';
import { planIds, isValidPlan, getPlan, DEFAULT_TRIAL_PLAN } from '../config/plans.js';
import { envFileService } from '../services/EnvFileService.js';
import { prisma } from '../db/prisma.js';
import { recordAudit } from '../services/audit.js';
import { checkReadiness, processMetrics } from '../services/monitoring.js';
import { http } from '../services/http.js';
import { logger, errInfo } from '../services/logger.js';
import { createAuthUser, deleteAuthUser } from '../services/SupabaseService.js';

const router = Router();

/** Valid subscription plan ids (from the central plans config). */
const PLANS = planIds();

/** Fields the Admin UI can edit, per platform. */
const EDITABLE_FIELDS = ['enabled', 'clientId', 'clientSecret', 'redirectUri', 'scopes', 'apiVersion'];

/** Map a config field name to its .env key suffix. */
const FIELD_TO_ENV = {
  enabled: 'ENABLED',
  clientId: 'CLIENT_ID',
  clientSecret: 'CLIENT_SECRET',
  redirectUri: 'REDIRECT_URI',
  scopes: 'SCOPES',
  apiVersion: 'API_VERSION',
};

/** Show only the last 4 characters of a secret, the rest masked. */
function maskSecret(secret) {
  if (!secret) return '';
  if (secret.length <= 4) return '••••';
  return '••••' + secret.slice(-4);
}

/**
 * GET /api/admin/config
 * Returns the current per-platform config with secrets MASKED. Never returns
 * the raw client secret to the browser.
 */
router.get('/config', (_req, res) => {
  const platforms = getPlatforms();
  const out = Object.entries(platforms).map(([key, p]) => ({
    key,
    enabled: p.enabled,
    clientId: p.clientId,
    clientSecretMasked: maskSecret(p.clientSecret),
    hasClientSecret: !!p.clientSecret,
    redirectUri: p.redirectUri,
    scopes: p.scopes,
    apiVersion: p.apiVersion,
  }));
  res.json({ platforms: out, envFileExists: envFileService.exists() });
});

/**
 * PUT /api/admin/config/:platform
 * Body: partial { enabled, clientId, clientSecret, redirectUri, scopes[], apiVersion }
 *
 * Writes the provided fields to .env. Omitted fields are left unchanged; an
 * empty-string clientSecret is treated as "leave as-is" so the masked value in
 * the UI doesn't accidentally wipe the real secret.
 */
router.put('/config/:platform', (req, res) => {
  const platform = req.params.platform;
  const prefix = PLATFORM_KEYS[platform];
  if (!prefix) {
    return res.status(404).json({ error: `Unknown platform: ${platform}` });
  }

  const body = req.body || {};
  const updates = {};

  for (const field of EDITABLE_FIELDS) {
    if (!(field in body)) continue;
    let value = body[field];

    if (field === 'clientSecret') {
      // Don't overwrite the stored secret with a blank/placeholder value.
      if (value === '' || value == null || String(value).includes('•')) continue;
    }
    if (field === 'enabled') {
      value = value === true || value === 'true' ? 'true' : 'false';
    }
    if (field === 'scopes') {
      value = Array.isArray(value) ? value.join(',') : String(value ?? '');
    }
    if (value == null) value = '';

    updates[`${prefix}_${FIELD_TO_ENV[field]}`] = String(value);
  }

  if (Object.keys(updates).length === 0) {
    return res.status(400).json({ error: 'No editable fields provided.' });
  }

  try {
    envFileService.update(updates);
    // Audit WHICH fields changed — never the values (secrets must not be logged).
    const changedFields = Object.keys(updates).map((k) => k.replace(`${prefix}_`, ''));
    void recordAudit(req, {
      action: 'admin.config.update',
      targetType: 'platform',
      targetId: platform,
      targetLabel: platform,
      metadata: { fields: changedFields },
    });
    // Config is recomputed from process.env on each read, so the change is
    // already live. Return the fresh, masked config for this platform.
    const p = getPlatforms()[platform];
    res.json({
      key: platform,
      enabled: p.enabled,
      clientId: p.clientId,
      clientSecretMasked: maskSecret(p.clientSecret),
      hasClientSecret: !!p.clientSecret,
      redirectUri: p.redirectUri,
      scopes: p.scopes,
      apiVersion: p.apiVersion,
    });
  } catch (err) {
    res.status(500).json({ error: `Failed to update .env: ${err.message}` });
  }
});

/**
 * GET /api/admin/dashboard
 * Owner-only business metrics: customers (total / active / new), plan
 * breakdown, and website traffic totals from usage_events.
 * "Active" = at least one usage event in the last 30 days.
 */
router.get('/dashboard', async (_req, res) => {
  try {
    const now = Date.now();
    const dayMs = 86400000;
    const since = (days) => new Date(now - days * dayMs);
    const startOfToday = new Date(new Date().setHours(0, 0, 0, 0));

    const [totalCustomers, newThisMonth, planGroups, payingGroups, activeRows, pv1, pv7, pv30, signups7] =
      await Promise.all([
        prisma.customer.count(),
        prisma.customer.count({ where: { createdAt: { gte: since(30) } } }),
        prisma.customer.groupBy({ by: ['plan'], _count: { _all: true } }),
        // Paying customers grouped by plan — used to compute recurring revenue.
        // Only 'active' subscriptions are billed; trialing/pending/past_due are not.
        prisma.customer.groupBy({
          by: ['plan'],
          where: { subscriptionStatus: 'active' },
          _count: { _all: true },
        }),
        // distinct customers with any usage event in the last 30 days
        prisma.usageEvent.findMany({
          where: { createdAt: { gte: since(30) }, customerId: { not: null } },
          distinct: ['customerId'],
          select: { customerId: true },
        }),
        prisma.usageEvent.count({ where: { type: 'pageview', createdAt: { gte: startOfToday } } }),
        prisma.usageEvent.count({ where: { type: 'pageview', createdAt: { gte: since(7) } } }),
        prisma.usageEvent.count({ where: { type: 'pageview', createdAt: { gte: since(30) } } }),
        prisma.usageEvent.count({ where: { type: 'signup', createdAt: { gte: since(7) } } }),
      ]);

    const planBreakdown = {};
    for (const p of PLANS) planBreakdown[p] = 0;
    // Include any legacy/unknown plan values (e.g. old "free" rows) so the
    // totals still add up in the dashboard.
    for (const g of planGroups) planBreakdown[g.plan] = (planBreakdown[g.plan] || 0) + g._count._all;

    // Monthly recurring revenue: for each paying (active) customer, add their
    // plan's monthly ZAR price. Custom-priced plans (priceZar === null) and
    // unknown plan ids contribute 0 so the figure never guesses.
    let mrrZar = 0;
    let payingCustomers = 0;
    for (const g of payingGroups) {
      const count = g._count._all;
      payingCustomers += count;
      const price = getPlan(g.plan)?.priceZar;
      if (typeof price === 'number') mrrZar += price * count;
    }

    res.json({
      customers: {
        total: totalCustomers,
        active30d: activeRows.length,
        newThisMonth,
        planBreakdown,
      },
      revenue: {
        // Monthly recurring revenue from active subscriptions, in ZAR.
        mrrZar,
        payingCustomers,
        currency: 'ZAR',
      },
      traffic: {
        pageviewsToday: pv1,
        pageviews7d: pv7,
        pageviews30d: pv30,
        signups7d: signups7,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * GET /api/admin/billing-check
 * Diagnostic: can the backend actually reach the configured payment provider's
 * API? Useful on restricted networks (corporate SSL / egress blocks) where
 * outbound calls to the provider silently fail. Makes a cheap authenticated
 * call and reports reachable/auth status + a readable reason.
 */
router.get('/billing-check', async (_req, res) => {
  const cfg = billingConfig();
  const result = { provider: cfg.provider, enabled: cfg.enabled };

  if (cfg.provider !== 'paystack') {
    return res.json({ ...result, reachable: null, note: `No external check for provider "${cfg.provider}".` });
  }

  const secret = cfg.paystack.secretKey;
  if (!secret) {
    return res.json({ ...result, reachable: null, note: 'PAYSTACK_SECRET_KEY is not set.' });
  }

  const started = Date.now();
  try {
    // /balance is a cheap authenticated endpoint. 200 = reachable + key valid.
    await http.get(`${cfg.paystack.baseUrl}/balance`, {
      headers: { Authorization: `Bearer ${secret}` },
    });
    res.json({ ...result, reachable: true, authOk: true, latencyMs: Date.now() - started });
  } catch (err) {
    const status = err?.response?.status;
    if (status === 401) {
      // We reached Paystack, but the key was rejected — network is FINE.
      return res.json({
        ...result,
        reachable: true,
        authOk: false,
        latencyMs: Date.now() - started,
        note: 'Reached Paystack but the secret key was rejected (check sk_test_/sk_live_).',
      });
    }
    const code = err?.code; // ECONNREFUSED / ETIMEDOUT / ENOTFOUND → egress blocked
    res.json({
      ...result,
      reachable: false,
      error: code || err?.message || 'request failed',
      note:
        code === 'ETIMEDOUT' || code === 'ECONNREFUSED' || code === 'ENOTFOUND'
          ? 'Could not reach api.paystack.co — this network likely blocks outbound HTTPS to Paystack. Test from an unrestricted network.'
          : 'Could not reach Paystack.',
      detail: errInfo(err)?.message,
    });
  }
});

/**
 * GET /api/admin/customers?limit=100
 * List customers with their plan and connected-account count.
 */
router.get('/customers', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const customers = await prisma.customer.findMany({
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
        phone: true,
        plan: true,
        planStatus: true,
        createdAt: true,
        _count: { select: { connectedAccounts: true, posts: true } },
      },
    });
    res.json({
      customers: customers.map((c) => ({
        id: c.id,
        email: c.email,
        firstName: c.firstName,
        lastName: c.lastName,
        phone: c.phone,
        plan: c.plan,
        planStatus: c.planStatus,
        createdAt: c.createdAt,
        accounts: c._count.connectedAccounts,
        posts: c._count.posts,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /api/admin/customers
 * Body: { email, password, firstName?, lastName?, phone?, plan? }
 * Create a new customer: a Supabase Auth login (so they can sign in) + the
 * local Customer row. Email is auto-confirmed. Requires the backend to reach
 * Supabase (fails clearly on a blocked network).
 */
router.post('/customers', async (req, res) => {
  const { email, password, firstName, lastName, phone, plan } = req.body || {};
  if (!email || !/.+@.+\..+/.test(String(email))) {
    return res.status(400).json({ error: 'A valid email is required.' });
  }
  if (!password || String(password).length < 6) {
    return res.status(400).json({ error: 'A password of at least 6 characters is required.' });
  }
  const chosenPlan = isValidPlan(plan) ? plan : DEFAULT_TRIAL_PLAN;

  try {
    // 1) Create the Supabase Auth user (the login identity).
    const authUser = await createAuthUser(String(email).trim().toLowerCase(), String(password), {
      firstName: firstName ?? null,
      lastName: lastName ?? null,
      phone: phone ?? null,
    });

    // 2) Create/ensure the local Customer row (id matches the Supabase user id).
    const customer = await prisma.customer.upsert({
      where: { id: authUser.id },
      update: {
        email: authUser.email,
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        phone: phone ?? undefined,
      },
      create: {
        id: authUser.id,
        email: authUser.email,
        firstName: firstName ?? null,
        lastName: lastName ?? null,
        phone: phone ?? null,
        plan: chosenPlan,
      },
    });

    void recordAudit(req, {
      action: 'admin.customer.create',
      targetType: 'customer',
      targetId: customer.id,
      targetLabel: customer.email ?? customer.id,
      metadata: { plan: chosenPlan },
    });

    res.status(201).json({
      id: customer.id,
      email: customer.email,
      firstName: customer.firstName,
      lastName: customer.lastName,
      phone: customer.phone,
      plan: customer.plan,
      planStatus: customer.planStatus,
      createdAt: customer.createdAt,
      accounts: 0,
      posts: 0,
    });
  } catch (err) {
    // Duplicate email (Supabase or our unique constraint) → 409.
    const msg = err?.message || 'Could not create the customer.';
    const dup = /already.*registered|already exists|duplicate|unique/i.test(msg);
    res.status(dup ? 409 : 502).json({ error: dup ? 'A user with that email already exists.' : msg });
  }
});

/**
 * DELETE /api/admin/customers/:id
 * Remove a customer: delete the local Customer row (cascades to their
 * connected accounts/posts) and best-effort delete the Supabase Auth login.
 */
router.delete('/customers/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const existing = await prisma.customer.findUnique({
      where: { id },
      select: { id: true, email: true },
    });
    if (!existing) return res.status(404).json({ error: 'Customer not found.' });

    // Best-effort: remove the Supabase Auth login. Don't block the local delete
    // if Supabase is unreachable — log it so the orphaned login can be cleaned
    // up later from an unrestricted network.
    let authDeleted = false;
    try {
      await deleteAuthUser(id);
      authDeleted = true;
    } catch (authErr) {
      (req.log ?? logger).warn('admin delete: Supabase auth delete failed (removing local row anyway)', {
        customerId: id,
        reason: authErr?.message,
      });
    }

    await prisma.customer.delete({ where: { id } });

    void recordAudit(req, {
      action: 'admin.customer.delete',
      targetType: 'customer',
      targetId: id,
      targetLabel: existing.email ?? id,
      metadata: { authDeleted },
    });

    res.json({ ok: true, authDeleted });
  } catch (err) {
    (req.log ?? logger).error('admin delete customer failed', { error: errInfo(err) });
    res.status(500).json({ error: 'Could not delete the customer.' });
  }
});

/**
 * PATCH /api/admin/customers/:id/plan
 * Body: { plan }
 * Change a customer's subscription plan.
 */
router.patch('/customers/:id/plan', async (req, res) => {
  const { plan } = req.body || {};
  if (!isValidPlan(plan)) {
    return res.status(400).json({ error: `Invalid plan. Must be one of: ${PLANS.join(', ')}` });
  }
  try {
    // Capture the previous plan for an auditable before/after.
    const before = await prisma.customer.findUnique({
      where: { id: req.params.id },
      select: { plan: true, email: true },
    });
    const updated = await prisma.customer.update({
      where: { id: req.params.id },
      data: { plan },
      select: { id: true, email: true, plan: true },
    });
    void recordAudit(req, {
      action: 'admin.customer.plan.change',
      targetType: 'customer',
      targetId: updated.id,
      targetLabel: updated.email ?? before?.email ?? updated.id,
      metadata: { from: before?.plan ?? null, to: plan },
    });
    res.json(updated);
  } catch (err) {
    res.status(404).json({ error: 'Customer not found.' });
  }
});

/**
 * GET /api/admin/audit?limit=&action=&actorType=
 * Recent audit-trail entries (who did what). Admin-only.
 */
router.get('/audit', async (req, res) => {
  try {
    const limit = Math.min(500, Math.max(1, Number(req.query.limit) || 100));
    const where = {};
    if (req.query.action) where.action = String(req.query.action);
    if (req.query.actorType) where.actorType = String(req.query.actorType);

    const entries = await prisma.auditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    res.json({
      entries: entries.map((e) => ({
        id: e.id,
        actorType: e.actorType,
        actorId: e.actorId,
        actorLabel: e.actorLabel,
        action: e.action,
        targetType: e.targetType,
        targetId: e.targetId,
        targetLabel: e.targetLabel,
        metadata: e.metadata ? safeParseJson(e.metadata) : null,
        ip: e.ip,
        createdAt: e.createdAt,
      })),
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

/** Parse stored JSON metadata, tolerating malformed values. */
function safeParseJson(s) {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

/**
 * GET /api/admin/health
 * System status for the admin dashboard: readiness (DB/Supabase) + runtime
 * metrics. Admin-only. Always 200 (it's a report, not a probe) — the `ready`
 * flag conveys health.
 */
router.get('/health', async (_req, res) => {
  try {
    const [readiness, metrics] = await Promise.all([
      checkReadiness({ deep: true }), // deep = also network-probe Supabase Auth
      Promise.resolve(processMetrics()),
    ]);
    res.json({ ...readiness, metrics, timestamp: new Date().toISOString() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
