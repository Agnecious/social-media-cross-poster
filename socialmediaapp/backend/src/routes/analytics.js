import { Router } from 'express';
import { requireCustomer } from '../middleware/requireCustomer.js';
import { accountService } from '../services/AccountService.js';
import { createPublisher } from '../platforms/PublisherFactory.js';
import { prisma } from '../db/prisma.js';

const router = Router();

/**
 * GET /api/analytics/:platform/:accountId?days=N&targetId=...
 *
 * Per-customer, per-account analytics. Resolves the account's token server-side
 * (scoped to the customer), asks the platform adapter for insights over the
 * window, and caches the result in analytics_snapshots (keyed to the customer).
 *
 * `days` is clamped by each adapter to 7–90. `targetId` selects a Page/IG
 * account for platforms that need one (Facebook, Instagram).
 */
router.get('/:platform/:accountId', requireCustomer, async (req, res) => {
  const { platform, accountId } = req.params;
  const days = Number(req.query.days) || 7;
  const targetId = req.query.targetId ? String(req.query.targetId) : null;

  try {
    const auth = await accountService.getAuth(req.customer.id, platform, accountId);
    if (!auth) return res.status(404).json({ error: 'Connected account not found.' });

    const publisher = createPublisher(platform);
    if (!publisher.supportsAnalytics()) {
      return res.json({ supported: false, metrics: [], note: 'Analytics not available for this platform.' });
    }

    // Resolve the chosen target (Page / IG account) if one was requested.
    let target = null;
    if (targetId) {
      const targets = await publisher.listTargets(auth);
      target = targets.find((t) => t.id === targetId) || null;
    }

    const result = await publisher.analytics(auth, { days, accountId, target });

    // Cache each metric (best-effort — never block the response).
    if (result.supported && Array.isArray(result.metrics) && result.metrics.length) {
      const now = new Date();
      const periodStart = new Date(Date.now() - days * 86400000);
      await Promise.allSettled(
        result.metrics.map((m) =>
          prisma.analyticsSnapshot.create({
            data: {
              customerId: req.customer.id,
              connectedAccountId: null,
              metric: `${platform}:${m.key}`,
              value: Number(m.value) || 0,
              periodStart,
              periodEnd: now,
              fetchedAt: now,
            },
          })
        )
      ).catch(() => {});
    }

    res.json(result);
  } catch (err) {
    // Surface the platform's own error message where possible (e.g. missing
    // scope / permission), not a raw object.
    const apiErr = err?.response?.data?.error;
    const message =
      (apiErr && (apiErr.message || apiErr.error_user_msg)) ||
      (err?.response?.data ? JSON.stringify(err.response.data) : err?.message) ||
      'Failed to load analytics.';
    res.status(400).json({ error: message });
  }
});

export default router;
