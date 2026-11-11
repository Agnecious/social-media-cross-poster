import { prisma } from '../db/prisma.js';
import { isSupabaseConfigured, checkSupabaseReachable } from './SupabaseService.js';
import { isAiEnabled, isAiConfigured, checkAiReachable } from '../ai/index.js';
import { logger, errInfo } from './logger.js';

/**
 * monitoring — lightweight, dependency-free observability helpers:
 *  - captureException: a single choke point for "something went wrong" that
 *    always logs, and is structured so an error tracker (e.g. Sentry) can be
 *    bolted on later without touching call sites.
 *  - checkReadiness: probes the things the app depends on (the database, and
 *    whether Supabase is configured) so a readiness endpoint can gate traffic.
 *  - processMetrics: cheap runtime stats for an ops view.
 *
 * SENTRY-READY: if SENTRY_DSN is set we log that capture would be forwarded.
 * Actually sending requires the @sentry/node dependency (not installed here);
 * when it is, initialise it at boot and forward inside captureException.
 */

const startedAt = Date.now();

/** App version for health payloads (APP_VERSION env, else 'dev'). */
export function appVersion() {
  return process.env.APP_VERSION || 'dev';
}

/** Seconds the process has been up. */
export function uptimeSeconds() {
  return Math.floor((Date.now() - startedAt) / 1000);
}

/**
 * Report a captured error. Always logs via the structured logger; forwards to
 * an external tracker when one is wired up.
 * @param {unknown} err
 * @param {object} [context] extra fields (e.g. { where: 'uncaughtException' })
 */
export function captureException(err, context = {}) {
  logger.error('exception', { ...context, error: errInfo(err) });
  if (process.env.SENTRY_DSN) {
    // Placeholder: with @sentry/node installed, forward here:
    //   Sentry.captureException(err, { extra: context });
    // Kept dependency-free for now — the DSN presence is just acknowledged.
    logger.debug('sentry forward (stub)', { where: context?.where ?? 'unknown' });
  }
}

/**
 * Install process-level handlers so a crash or dropped promise is captured
 * (logged / forwarded) instead of dying silently. Call once at boot.
 */
export function installProcessHandlers() {
  process.on('unhandledRejection', (reason) => {
    captureException(reason, { where: 'unhandledRejection' });
  });
  process.on('uncaughtException', (err) => {
    captureException(err, { where: 'uncaughtException' });
    // An uncaught exception leaves the process in an undefined state; after
    // capturing, exit so the supervisor (Docker/systemd) can restart cleanly.
    process.exit(1);
  });
}

/**
 * Probe dependencies for a readiness check.
 *
 * @param {object} [opts]
 * @param {boolean} [opts.deep=false] when true, also makes a real NETWORK probe
 *   to the Supabase Auth host (catches egress blocks). Off by default so the
 *   public liveness/readiness path stays cheap; the admin health view opts in.
 * @returns {Promise<{ ready: boolean, checks: object }>}
 */
export async function checkReadiness(opts = {}) {
  const checks = {};

  // Database: a trivial round-trip proves connectivity + the pool is alive.
  const t0 = Date.now();
  try {
    await prisma.$queryRaw`SELECT 1`;
    checks.database = { ok: true, latencyMs: Date.now() - t0 };
  } catch (err) {
    checks.database = { ok: false, latencyMs: Date.now() - t0, error: errInfo(err)?.message };
  }

  // Supabase (customer auth). Always report whether it's configured; on a deep
  // check also report whether the Auth host is actually REACHABLE from here —
  // a config-only "ok" can hide an egress block where every customer login fails.
  if (opts.deep) {
    const probe = await checkSupabaseReachable();
    checks.supabase = {
      ok: probe.configured && probe.reachable !== false,
      configured: probe.configured,
      reachable: probe.reachable, // true | false | null(not configured)
      reason: probe.reason,
      latencyMs: probe.latencyMs,
    };
  } else {
    checks.supabase = { ok: isSupabaseConfigured(), configured: isSupabaseConfigured() };
  }

  // AI Content Assistant (optional feature). Like Supabase, a config-only "ok"
  // can hide an egress block where every AI call fails — so a deep check does a
  // real network probe to the provider host. Non-deep reports presence only.
  if (opts.deep) {
    const ai = await checkAiReachable();
    checks.ai = {
      // "ok" here means: either the feature is off (nothing to worry about), or
      // it's on, configured AND reachable. On+configured+unreachable = not ok.
      ok: !ai.enabled || (ai.configured && ai.reachable !== false),
      enabled: ai.enabled,
      configured: ai.configured,
      reachable: ai.reachable, // true | false | null(nothing configured)
      provider: ai.provider,
      reason: ai.reason,
      latencyMs: ai.latencyMs,
    };
  } else {
    checks.ai = { ok: true, enabled: isAiEnabled(), configured: isAiConfigured() };
  }

  // Ready only if every critical check passed. (Supabase/AI missing or
  // unreachable = degraded, but DB is the hard gate; surface the rest either way.)
  const ready = checks.database.ok;
  return { ready, checks };
}

/** Cheap runtime metrics for an ops/admin view. */
export function processMetrics() {
  const mem = process.memoryUsage();
  return {
    version: appVersion(),
    nodeVersion: process.version,
    uptimeSeconds: uptimeSeconds(),
    memory: {
      rssMb: Math.round(mem.rss / 1048576),
      heapUsedMb: Math.round(mem.heapUsed / 1048576),
      heapTotalMb: Math.round(mem.heapTotal / 1048576),
    },
  };
}
