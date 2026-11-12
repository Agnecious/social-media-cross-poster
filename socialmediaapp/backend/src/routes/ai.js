import { Router } from 'express';
import { requireCustomer } from '../middleware/requireCustomer.js';
import { requireActiveAccess } from '../middleware/requireActiveAccess.js';
import { rateLimit } from '../middleware/rateLimit.js';
import { isAiEnabled, isAiConfigured } from '../ai/index.js';
import { aiConfig } from '../config/index.js';
import { planHasAi } from '../config/plans.js';
import { getUserFromToken } from '../services/SupabaseService.js';
import { prisma } from '../db/prisma.js';
import { logger, errInfo } from '../services/logger.js';
import { recordAudit } from '../services/audit.js';
import {
  generatePlatformContent,
  rewrite,
  generateHashtags,
  generateTitles,
  translate,
  generateCtas,
  analyzeContent,
  expandContent,
  shortenContent,
  completePack,
  proofread,
  seoKeywords,
  SUPPORTED_PLATFORMS,
  SUPPORTED_TONES,
  EXPAND_FORMATS,
  SHORTEN_FORMATS,
} from '../services/AiService.js';

/**
 * AI Content Assistant routes (customer-scoped, entitled, rate-limited).
 *
 * Every route runs behind:
 *   requireCustomer      — valid Supabase session (sets req.customer)
 *   requireActiveAccess  — a live subscription/trial (402 otherwise)
 *   requireAiAvailable   — AI_ENABLED + at least one provider key (503 otherwise)
 *   rateLimit            — blunt cost abuse (per IP, short window)
 *
 * MVP endpoints:
 *   GET  /api/ai/config          capabilities for the UI (enabled, platforms, tones)
 *   POST /api/ai/platform-content
 *   POST /api/ai/rewrite
 *   POST /api/ai/hashtags
 *   POST /api/ai/titles
 *   POST /api/ai/translate
 */
const router = Router();

/** 503 unless the AI feature is switched on AND a provider key exists. */
function requireAiAvailable(_req, res, next) {
  if (!isAiEnabled()) {
    return res.status(503).json({ error: 'The AI assistant is currently turned off.', reason: 'disabled' });
  }
  if (!isAiConfigured()) {
    return res
      .status(503)
      .json({ error: 'The AI assistant is not configured yet.', reason: 'not_configured' });
  }
  next();
}

/**
 * 403 unless the customer's PLAN includes the AI Content Assistant. Must run
 * AFTER requireCustomer (reads req.customer.plan). The `reason: 'upgrade_required'`
 * tells the UI to route the customer to the billing/plan screen.
 */
function requireAiPlan(req, res, next) {
  if (!planHasAi(req.customer?.plan)) {
    return res.status(403).json({
      error: 'The AI assistant is available on the Pro and Agency plans. Upgrade to use it.',
      reason: 'upgrade_required',
    });
  }
  next();
}

/**
 * GET /api/ai/config — lightweight capabilities probe for the UI. Behind auth
 * so we don't leak whether AI is configured to anonymous callers, but it does
 * NOT require active access (the UI can show the feature and prompt to upgrade).
 *
 * SOFT-authenticated: it returns non-sensitive global capability flags (feature
 * on/off + the static platform/tone lists) WITHOUT requiring auth, so it works
 * even when Supabase is unreachable (otherwise the UI can't tell "AI is off"
 * apart from "we couldn't check"). When a valid customer token IS present, it
 * additionally reports `planAllowed` + `plan` so the UI can show an upgrade
 * prompt for plans that don't include AI. A missing/invalid token just omits
 * those fields — never a 401.
 */
router.get('/config', async (req, res) => {
  const cfg = aiConfig();

  // Soft-resolve the customer's plan (best-effort; never blocks the response).
  let plan = null;
  let planAllowed = null;
  try {
    const [scheme, token] = (req.headers.authorization || '').split(' ');
    if (scheme === 'Bearer' && token) {
      const user = await getUserFromToken(token);
      if (user?.id) {
        const customer = await prisma.customer.findUnique({
          where: { id: user.id },
          select: { plan: true },
        });
        if (customer) {
          plan = customer.plan;
          planAllowed = planHasAi(customer.plan);
        }
      }
    }
  } catch (err) {
    // Egress block / DB blip — fall back to global flags only.
    (req.log ?? logger).warn('ai config: soft auth failed', { error: errInfo(err) });
  }

  res.json({
    enabled: cfg.enabled,
    configured: cfg.configured,
    available: cfg.enabled && cfg.configured,
    plan,
    planAllowed, // true | false | null(unknown — not signed in / unreachable)
    platforms: SUPPORTED_PLATFORMS,
    tones: SUPPORTED_TONES,
    expandFormats: EXPAND_FORMATS,
    shortenFormats: SHORTEN_FORMATS,
  });
});

// Shared guard chain for the generation endpoints. 20 calls / 5 min / IP.
const genGuards = [
  requireCustomer,
  requireActiveAccess,
  requireAiAvailable,
  requireAiPlan,
  rateLimit({ windowMs: 5 * 60 * 1000, max: 20, message: 'Too many AI requests. Please slow down.' }),
];

/**
 * Wrap an AiService call in uniform error handling: validation errors → 400,
 * provider/parse failures → 502, everything else → 500. Also records a light
 * audit line (which tool, which provider answered) without storing content.
 */
function handle(toolName, fn) {
  return async (req, res) => {
    const log = req.log ?? logger;
    try {
      const out = await fn(req.body || {}, log);
      // Audit: who used which tool, and which provider served it. No content.
      // recordAudit derives the actor from req and never throws.
      void recordAudit(req, {
        action: `ai.${toolName}`,
        metadata: { provider: out.provider },
      });
      res.json(out);
    } catch (err) {
      const msg = err?.message || 'AI request failed.';
      // Input/validation problems are the caller's fault → 400.
      const isValidation =
        /provide|too long|unsupported|no valid|specify|target language/i.test(msg);
      if (isValidation) {
        return res.status(400).json({ error: msg });
      }
      // Provider/parse failures.
      log.error(`ai ${toolName} failed`, { error: errInfo(err) });
      res.status(502).json({ error: 'The AI service could not complete your request. Please try again.' });
    }
  };
}

router.post('/platform-content', ...genGuards, handle('platform_content', generatePlatformContent));
router.post('/rewrite', ...genGuards, handle('rewrite', rewrite));
router.post('/hashtags', ...genGuards, handle('hashtags', generateHashtags));
router.post('/titles', ...genGuards, handle('titles', generateTitles));
router.post('/translate', ...genGuards, handle('translate', translate));
// Phase 2 tools.
router.post('/ctas', ...genGuards, handle('ctas', generateCtas));
router.post('/analyze', ...genGuards, handle('analyze', analyzeContent));
router.post('/expand', ...genGuards, handle('expand', expandContent));
router.post('/shorten', ...genGuards, handle('shorten', shortenContent));
router.post('/proofread', ...genGuards, handle('proofread', proofread));
router.post('/seo-keywords', ...genGuards, handle('seo_keywords', seoKeywords));
router.post('/complete-pack', ...genGuards, handle('complete_pack', completePack));

export default router;
