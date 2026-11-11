import { Router } from 'express';
import { requireCustomer } from '../middleware/requireCustomer.js';
import { requireActiveAccess } from '../middleware/requireActiveAccess.js';
import { accountService, effectiveAccountCap } from '../services/AccountService.js';
import { recordAudit } from '../services/audit.js';

const router = Router();

/**
 * Per-customer connected accounts. All routes require a signed-in customer and
 * are scoped to that customer's id — no customer can see or touch another's.
 * Tokens are stored AES-encrypted in the DB (connected_accounts).
 */

/** GET /api/tokens — this customer's connected accounts (auth included for the UI session). */
router.get('/', requireCustomer, async (req, res) => {
  const accounts = await accountService.list(req.customer.id);
  // The authoritative per-platform account cap for THIS customer's plan
  // (0 = unlimited). The UI uses this to show "X of N" and disable Connect at
  // the limit, matching what the backend actually enforces on add.
  res.json({ enabled: true, accounts, maxAccountsPerPlatform: effectiveAccountCap(req.customer.plan) });
});

/** PUT /api/tokens/:platform/:accountId — add/replace one account for this customer. */
router.put('/:platform/:accountId', requireCustomer, requireActiveAccess, async (req, res) => {
  const { auth, label, scopes } = req.body || {};
  if (!auth?.accessToken) {
    return res.status(400).json({ error: 'auth.accessToken is required' });
  }
  const result = await accountService.add(req.customer.id, {
    platform: req.params.platform,
    accountId: req.params.accountId,
    label: label || `${req.params.platform} account`,
    auth,
    scopes,
    plan: req.customer.plan,
  });
  if (!result.ok && result.reason === 'limit') {
    return res.status(409).json({
      error: `Account limit reached: your plan allows at most ${result.max} ${req.params.platform} account(s). Upgrade your plan to connect more.`,
      reason: 'limit',
      max: result.max,
    });
  }
  void recordAudit(req, {
    action: 'account.connect',
    targetType: 'account',
    targetId: `${req.params.platform}:${req.params.accountId}`,
    targetLabel: `${req.params.platform} — ${label || req.params.accountId}`,
    metadata: { platform: req.params.platform },
  });
  res.json({ saved: true });
});

/** DELETE /api/tokens/:platform/:accountId — remove one account for this customer. */
router.delete('/:platform/:accountId', requireCustomer, async (req, res) => {
  await accountService.remove(req.customer.id, req.params.platform, req.params.accountId);
  void recordAudit(req, {
    action: 'account.disconnect',
    targetType: 'account',
    targetId: `${req.params.platform}:${req.params.accountId}`,
    targetLabel: `${req.params.platform} — ${req.params.accountId}`,
    metadata: { platform: req.params.platform },
  });
  res.json({ deleted: true });
});

export default router;
