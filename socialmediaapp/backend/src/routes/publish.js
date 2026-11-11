import { Router } from 'express';
import multer from 'multer';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import { publishService } from '../services/PublishService.js';
import { requireCustomer } from '../middleware/requireCustomer.js';
import { requireActiveAccess } from '../middleware/requireActiveAccess.js';
import { accountService } from '../services/AccountService.js';
import { prisma } from '../db/prisma.js';
import { logger, errInfo } from '../services/logger.js';
import { trialPublishAllowance } from '../services/subscriptionState.js';
import { billingConfig } from '../config/index.js';

const router = Router();

/**
 * Files are written to the OS temp dir ONLY for the duration of the upload,
 * then deleted in a `finally` block. Media is never persisted.
 *
 * Upload size is capped to prevent abuse. The cap is configurable via
 * MAX_UPLOAD_MB (default 100 MB), and only a single file per request is
 * accepted. Oversize uploads surface as a 413 from the central error handler.
 */
const MAX_UPLOAD_MB = Number(process.env.MAX_UPLOAD_MB) || 100;
const upload = multer({
  dest: os.tmpdir(),
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 1 },
});

/**
 * POST /api/publish  (requires a signed-in customer)
 * multipart/form-data:
 *   - file        (optional) the image/video
 *   - text        post caption/body
 *   - mediaType   'none' | 'image' | 'video'
 *   - mediaUrl    (optional) public URL, required for Instagram
 *   - scheduledAt (optional) ISO time for native scheduling
 *   - targets     JSON string: [{ platform, accountId, label, options }]
 *
 * Each target references one of THIS customer's connected accounts by
 * accountId; the OAuth token is resolved server-side from the DB (scoped to the
 * customer) — the browser never sends tokens. Each result is logged to `posts`.
 */
router.post('/', requireCustomer, requireActiveAccess, upload.single('file'), async (req, res) => {
  const filePath = req.file?.path;
  try {
    const { text = '', mediaType = 'none', mediaUrl, scheduledAt } = req.body;

    let requested;
    try {
      requested = JSON.parse(req.body.targets || '[]');
    } catch {
      return res.status(400).json({ error: 'targets must be valid JSON' });
    }
    if (!Array.isArray(requested) || requested.length === 0) {
      return res.status(400).json({ error: 'At least one target account is required.' });
    }

    // Resolve each target's token from the DB, scoped to this customer.
    const targets = [];
    for (const t of requested) {
      const auth = await accountService.getAuth(req.customer.id, t.platform, t.accountId);
      if (!auth) {
        return res.status(404).json({ error: `Connected account not found: ${t.platform}` });
      }
      targets.push({
        platform: t.platform,
        accountId: t.accountId,
        label: t.label,
        auth,
        options: t.options ?? {},
      });
    }

    // Trial cap: a trialing customer may make only TRIAL_MAX_POSTS successful
    // cross-posts (one compose -> fan-out = one). Enforced only when billing is
    // enabled; active/unlimited customers pass straight through.
    if (billingConfig().enabled) {
      const allowance = trialPublishAllowance(req.customer);
      if (allowance.trialing && !allowance.allowed) {
        return res.status(402).json({
          error: `Your trial allows ${allowance.max} post(s). Upgrade your plan to keep posting.`,
          reason: 'trial_post_limit',
          used: allowance.used,
          max: allowance.max,
        });
      }
    }

    const post = { text, mediaType, mediaUrl, filePath, scheduledAt: scheduledAt || undefined };
    const results = await publishService.publishToMany(post, targets);

    // Log each attempt to the customer's activity history (best-effort).
    await Promise.allSettled(
      results.map((r) =>
        prisma.post.create({
          data: {
            customerId: req.customer.id,
            platform: r.platform,
            accountId: r.accountId ?? '',
            text: text || null,
            mediaType,
            scheduledAt: scheduledAt ? new Date(scheduledAt) : null,
            status: r.ok ? (scheduledAt ? 'scheduled' : 'published') : 'failed',
            resultUrl: r.result?.url ?? null,
            error: r.ok ? null : String(r.error ?? '').slice(0, 500),
          },
        })
      )
    );

    // Log any per-target failures with their reason (the 502/partial-fail
    // detail that was previously only returned to the browser / written to the
    // posts table). This is what tells us WHY a publish failed.
    const failures = results.filter((r) => !r.ok);
    if (failures.length) {
      (req.log ?? logger).warn('publish: some targets failed', {
        failures: failures.map((r) => ({
          platform: r.platform,
          accountId: r.accountId,
          error: String(r.error ?? '').slice(0, 500),
        })),
      });
    }

    const anyOk = results.some((r) => r.ok);

    // Count a successful cross-post against the trial quota (one compose ->
    // fan-out = one). Only while trialing + billing enabled; best-effort.
    if (anyOk && !scheduledAt && billingConfig().enabled && req.customer.subscriptionStatus === 'trialing') {
      prisma.customer
        .update({ where: { id: req.customer.id }, data: { trialPostsUsed: { increment: 1 } } })
        .catch((e) => (req.log ?? logger).error('trial post count increment failed', { error: errInfo(e) }));
    }

    res.status(anyOk ? 200 : 502).json({ results });
  } catch (err) {
    // Log the detail server-side; return a generic message to the client.
    (req.log ?? logger).error('publish error', { error: errInfo(err) });
    res.status(500).json({ error: 'Could not publish. Please try again.' });
  } finally {
    if (filePath) {
      fs.promises.unlink(path.resolve(filePath)).catch(() => {});
    }
  }
});

export default router;
