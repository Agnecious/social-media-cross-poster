import { Router } from 'express';
import crypto from 'node:crypto';
import { publishService } from '../services/PublishService.js';
import { serverConfig, getPlatformConfig } from '../config/index.js';
import { logger, errInfo } from '../services/logger.js';

const router = Router();

/**
 * GET /api/auth/:platform/start
 * Returns the platform's OAuth URL. The frontend opens it so the user logs in
 * ON THE PLATFORM'S SITE. `state` is a CSRF token echoed back on callback.
 */
router.get('/:platform/start', (req, res) => {
  const { platform } = req.params;
  const log = req.log ?? logger;
  try {
    // Validate the platform is actually configured BEFORE building a URL — an
    // unconfigured platform would otherwise produce a URL with an empty
    // client_id/redirect_uri and the popup would show a blank/error page.
    let cfg;
    try {
      cfg = getPlatformConfig(platform);
    } catch {
      log.warn('oauth start: unknown platform', { platform });
      return res.status(404).json({ error: `Unknown platform: ${platform}` });
    }
    const missing = [];
    if (!cfg.enabled) missing.push('enabled');
    if (!cfg.clientId) missing.push('clientId');
    if (!cfg.clientSecret) missing.push('clientSecret');
    if (!cfg.redirectUri) missing.push('redirectUri');
    if (missing.length) {
      log.error('oauth start: platform not configured', { platform, missing });
      return res.status(400).json({
        error: `${platform} is not fully configured (${missing.join(', ')}). Set its credentials in the Administrator screen.`,
      });
    }

    const state = crypto.randomBytes(16).toString('hex');
    const url = publishService.getAuthUrl(platform, state);
    log.info('oauth start', { platform, redirectUri: cfg.redirectUri });
    res.json({ url, state });
  } catch (err) {
    log.error('oauth start failed', { platform, error: errInfo(err) });
    res.status(400).json({ error: err.message });
  }
});

/**
 * GET /api/auth/:platform/callback
 * The platform redirects here with `?code=...`. We exchange it for a token
 * and hand the token back to the browser via a small HTML bridge that
 * postMessages it to the opener window. Nothing is stored server-side.
 */
router.get('/:platform/callback', async (req, res) => {
  const { platform } = req.params;
  const { code, error, state } = req.query;
  const log = req.log ?? logger;

  if (error) {
    log.warn('oauth callback: platform returned error', { platform, error: String(error) });
    return sendBridge(res, { platform, error: String(error) }, 400);
  }
  if (!code) {
    log.warn('oauth callback: missing code', { platform });
    return sendBridge(res, { platform, error: 'missing_code' }, 400);
  }

  try {
    const token = await publishService.exchangeCode(
      platform,
      String(code),
      state !== undefined ? String(state) : undefined
    );
    // Resolve who just logged in, so multiple accounts can be labelled.
    let accountId = `${platform}:${Date.now()}`;
    let label = `${platform} account`;
    try {
      const id = await publishService.identity(platform, token);
      accountId = id.accountId || accountId;
      label = id.label || label;
    } catch (idErr) {
      // Identity is best-effort — fall back to a generic label.
      log.warn('oauth identity lookup failed (using generic label)', { platform, error: errInfo(idErr) });
    }
    // NB: the bridge posts the result to serverConfig.frontendOrigin. If the
    // app is open on a DIFFERENT origin, the browser silently drops the
    // message and the popup appears to "do nothing" — log the origin so that
    // mismatch is visible here.
    log.info('oauth callback ok', { platform, accountId, postMessageOrigin: serverConfig.frontendOrigin });
    sendBridge(res, { platform, token, accountId, label });
  } catch (err) {
    log.error('oauth callback: token exchange failed', { platform, error: errInfo(err) });
    // Return a generic reason to the popup; details are in the server log.
    sendBridge(res, { platform, error: 'authorization_failed' }, 400);
  }
});

/**
 * Send the OAuth bridge HTML page.
 *
 * This page runs a small INLINE script to postMessage the result to the opener
 * and close itself. The global API CSP (`default-src 'none'`) would block that
 * inline script, so we override the CSP for THIS response with a per-request
 * nonce that allows exactly this one script — nothing else. Without this the
 * popup stays blank because the browser silently refuses to run the script.
 */
function sendBridge(res, payload, status = 200) {
  const nonce = crypto.randomBytes(16).toString('base64');
  res.setHeader(
    'Content-Security-Policy',
    `default-src 'none'; script-src 'nonce-${nonce}'; frame-ancestors 'none'`
  );
  res.status(status).type('html').send(renderBridge(payload, nonce));
}

/**
 * Tiny HTML page that passes the auth result to the app window that opened
 * the popup, then closes itself. The token lives only in the browser session.
 */
function renderBridge(payload, nonce) {
  const json = JSON.stringify(payload).replace(/</g, '\\u003c');
  return `<!doctype html><html><body><script nonce="${nonce}">
    (function () {
      var data = ${json};
      if (window.opener) {
        window.opener.postMessage({ source: 'socialmediaapp-oauth', payload: data }, '${serverConfig.frontendOrigin}');
        window.close();
      } else {
        document.body.textContent = 'You can close this window.';
      }
    })();
  </script></body></html>`;
}

export default router;
