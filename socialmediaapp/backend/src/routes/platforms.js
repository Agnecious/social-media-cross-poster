import { Router } from 'express';
import { describeEnabledPlatforms, createPublisher } from '../platforms/PublisherFactory.js';
import { requireCustomer } from '../middleware/requireCustomer.js';
import { accountService } from '../services/AccountService.js';
import { logger, errInfo } from '../services/logger.js';

const router = Router();

/**
 * GET /api/platforms
 * Public capability info: which platforms are enabled, what each supports,
 * whether a target is required, scheduling support, and the account cap.
 * (No customer data here.)
 */
router.get('/', (_req, res) => {
  res.json({ platforms: describeEnabledPlatforms() });
});

/**
 * POST /api/platforms/:platform/targets
 * Body: { accountId }
 *
 * Returns the destinations (Facebook Pages, IG Business accounts) for one of
 * the CUSTOMER'S connected accounts. The token is looked up server-side from
 * the DB by (customerId, platform, accountId) — never sent by the browser.
 */

router.post('/:platform/targets', requireCustomer, async (req, res) => {
  try {
    const { platform } = req.params;
    const { accountId } = req.body || {};
    if (!accountId) return res.status(400).json({ error: 'accountId is required' });

    const auth = await accountService.getAuth(req.customer.id, platform, accountId);
    if (!auth) return res.status(404).json({ error: 'Connected account not found.' });

    const publisher = createPublisher(platform);
    const targets = await publisher.listTargets(auth);
    res.json({ targets });
  } catch (err) {
    // Log the platform's raw response server-side; return a generic message so
    // we don't leak upstream API internals to the browser.
    (req.log ?? logger).error('listTargets failed', { platform: req.params.platform, error: errInfo(err) });
    res.status(400).json({ error: 'Could not load destinations for this account. Please try reconnecting it.' });
  }
});

export default router;
