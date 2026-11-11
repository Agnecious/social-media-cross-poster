/**
 * Public plan catalogue route. Returns the tiers, prices (ZAR), features and
 * trial info from the central config (src/config/plans.js). Consumed by the
 * public pricing page and the customer Plan/Billing screen. No auth required.
 */
import { Router } from 'express';
import { plansPayload } from '../config/plans.js';

const router = Router();

/** GET /api/plans — the public plan catalogue. */
router.get('/', (_req, res) => {
  res.json(plansPayload());
});

export default router;
