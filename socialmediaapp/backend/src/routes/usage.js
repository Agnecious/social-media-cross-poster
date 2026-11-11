import { Router } from 'express';
import { prisma } from '../db/prisma.js';

const router = Router();

const ALLOWED_TYPES = new Set(['pageview', 'login', 'signup', 'publish', 'schedule']);

/**
 * POST /api/usage
 * Records a lightweight usage event (built-in traffic counter). Public — the
 * frontend calls this on navigation. Best-effort; failures never block the UI.
 * Body: { type, path? } and optionally an auth token to attribute to a customer.
 */
router.post('/', async (req, res) => {
  const { type, path } = req.body || {};
  if (!ALLOWED_TYPES.has(type)) {
    return res.status(400).json({ error: 'Invalid event type.' });
  }
  try {
    await prisma.usageEvent.create({
      data: { type, path: typeof path === 'string' ? path.slice(0, 300) : null },
    });
    res.json({ ok: true });
  } catch (err) {
    // Never let analytics break the app.
    res.json({ ok: false });
  }
});

export default router;
