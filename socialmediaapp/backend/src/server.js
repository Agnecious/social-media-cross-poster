/**
 * Backend entry point. Configures Express (CORS to the frontend origin, body
 * parsers), mounts the API routes, and starts the server. Admin config routes
 * are guarded by the requireAdmin JWT middleware. See ARCHITECTURE.md §4.
 */
import express from 'express';
import cors from 'cors';
import { serverConfig, enabledPlatformKeys } from './config/index.js';
import authRoutes from './routes/auth.js';
import platformRoutes from './routes/platforms.js';
import publishRoutes from './routes/publish.js';
import adminRoutes from './routes/admin.js';
import adminAuthRoutes from './routes/adminAuth.js';
import tokenRoutes from './routes/tokens.js';
import customerRoutes from './routes/customer.js';
import usageRoutes from './routes/usage.js';
import analyticsRoutes from './routes/analytics.js';
import plansRoutes from './routes/plans.js';
import appConfigRoutes from './routes/appConfig.js';
import billingRoutes from './routes/billing.js';
import aiRoutes from './routes/ai.js';
import { requireAdmin } from './middleware/requireAdmin.js';
import { securityHeaders } from './middleware/securityHeaders.js';
import { rateLimit } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { logger, errInfo } from './services/logger.js';
import {
  captureException,
  installProcessHandlers,
  checkReadiness,
  appVersion,
  uptimeSeconds,
} from './services/monitoring.js';

const app = express();

// Behind nginx/Docker (and any TLS-terminating proxy) so req.ip and
// X-Forwarded-Proto reflect the real client and scheme.
app.set('trust proxy', 1);
// Don't advertise Express.
app.disable('x-powered-by');

app.use(securityHeaders);
app.use(requestLogger);
app.use(cors({ origin: serverConfig.frontendOrigin, credentials: true }));
// Cap request bodies to limit abuse. Publishing uses multipart (handled by
// multer with its own limits), so JSON/form payloads here are small.
// The `verify` hook stashes the raw body bytes on `req.rawBody` — needed to
// verify provider webhook signatures (e.g. Paystack's HMAC-SHA512, which is
// computed over the exact raw payload, not a re-serialised object).
app.use(
  express.json({
    limit: '100kb',
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: true, limit: '100kb' }));

/**
 * Liveness — is the process up and serving? Cheap, no dependency checks, so a
 * load balancer won't kill the pod just because the DB blipped. Always 200
 * while the event loop is responsive.
 */
app.get('/api/health', (_req, res) => {
  res.json({
    status: 'ok',
    version: appVersion(),
    uptimeSeconds: uptimeSeconds(),
    timestamp: new Date().toISOString(),
    enabledPlatforms: enabledPlatformKeys(),
  });
});

/**
 * Readiness — can the app actually serve traffic? Probes dependencies (DB
 * ping, Supabase config). Returns 200 when ready, 503 when not, so an
 * orchestrator can hold traffic until the app is truly up.
 */
app.get('/api/ready', async (_req, res) => {
  const { ready, checks } = await checkReadiness();
  res.status(ready ? 200 : 503).json({ ready, checks, timestamp: new Date().toISOString() });
});

// Admin login (issues a JWT). Unprotected by design — it IS the login.
// Rate-limited to blunt brute-force (per IP, fixed window).
// Mounted before the generic /api/auth platform routes to avoid path clashes.
app.use(
  '/api/auth/admin',
  rateLimit({ windowMs: 15 * 60 * 1000, max: 10, message: 'Too many login attempts. Please try again later.' }),
  adminAuthRoutes
);
app.use('/api/auth', authRoutes);
app.use('/api/platforms', platformRoutes);
app.use('/api/publish', publishRoutes);
app.use('/api/tokens', tokenRoutes);
// Customer routes (Supabase-authenticated, scoped per customer).
app.use('/api/customer', customerRoutes);
// Built-in usage/traffic counter (public, best-effort).
app.use('/api/usage', usageRoutes);
// Public plan catalogue (prices, features, trial info).
app.use('/api/plans', plansRoutes);
// Public UI config (theme, etc.).
app.use('/api/app-config', appConfigRoutes);
// Per-customer, per-account analytics.
app.use('/api/analytics', analyticsRoutes);
// AI Content Assistant (customer-scoped, entitled, rate-limited).
app.use('/api/ai', aiRoutes);
// Billing: customer-scoped routes (subscribe/status/mock-complete) and the
// public provider webhook. The same router serves both mounts; webhook is
// reached at /api/billing/webhook, customer actions under /api/customer/billing.
app.use('/api/customer/billing', billingRoutes);
app.use('/api/billing', billingRoutes);
// Admin config routes read/write .env — protected by the admin JWT.
app.use('/api/admin', requireAdmin, adminRoutes);

// Central error handler — never leak stack traces to clients.
app.use((err, req, res, _next) => {
  (req.log ?? logger).error('unhandled error', { error: errInfo(err) });
  // Funnel to the monitoring hook (and an external tracker when configured).
  captureException(err, { where: 'express', reqId: req.id, path: req.originalUrl?.split('?')[0] });
  // Payload / upload too large (body-parser or multer).
  if (err?.type === 'entity.too.large' || err?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'Request is too large.' });
  }
  // Other multer rejections (too many files/parts, unexpected field).
  if (typeof err?.code === 'string' && err.code.startsWith('LIMIT_')) {
    return res.status(400).json({ error: 'Upload rejected.' });
  }
  res.status(500).json({ error: 'Internal server error' });
});

// Capture crashes / dropped promises instead of dying silently.
installProcessHandlers();

app.listen(serverConfig.port, () => {
  logger.info('backend started', {
    port: serverConfig.port,
    version: appVersion(),
    enabledPlatforms: enabledPlatformKeys(),
    logLevel: (process.env.LOG_LEVEL || 'info').toLowerCase(),
  });
});
