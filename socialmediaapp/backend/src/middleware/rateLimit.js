/**
 * rateLimit — a tiny, dependency-free fixed-window rate limiter.
 *
 * Keeps per-key hit counts in an in-process Map. Good enough to blunt
 * brute-force on sensitive endpoints (e.g. admin login) for a single-instance
 * deployment. NOTE: state is per-process — behind multiple instances/replicas
 * each has its own window, so for horizontal scale replace this with a shared
 * store (Redis) or express-rate-limit + a store.
 *
 * @param {object} opts
 * @param {number} opts.windowMs  window length in ms (default 15 min)
 * @param {number} opts.max       max requests per key per window (default 10)
 * @param {string} [opts.message] 429 message
 * @returns {import('express').RequestHandler}
 */
export function rateLimit({ windowMs = 15 * 60 * 1000, max = 10, message } = {}) {
  /** @type {Map<string, { count: number, resetAt: number }>} */
  const hits = new Map();

  // Occasionally sweep expired entries so the Map doesn't grow unbounded.
  function sweep(now) {
    if (hits.size < 1000) return;
    for (const [key, rec] of hits) {
      if (rec.resetAt <= now) hits.delete(key);
    }
  }

  return function rateLimiter(req, res, next) {
    const now = Date.now();
    // Key by client IP. Honour a trusted proxy's forwarded IP if present.
    const fwd = req.headers['x-forwarded-for'];
    const ip = (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim() || req.ip || 'unknown';
    const key = `${req.method}:${req.baseUrl}${req.path}:${ip}`;

    let rec = hits.get(key);
    if (!rec || rec.resetAt <= now) {
      rec = { count: 0, resetAt: now + windowMs };
      hits.set(key, rec);
    }
    rec.count += 1;

    const remaining = Math.max(0, max - rec.count);
    res.setHeader('X-RateLimit-Limit', String(max));
    res.setHeader('X-RateLimit-Remaining', String(remaining));

    if (rec.count > max) {
      const retryAfter = Math.ceil((rec.resetAt - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      sweep(now);
      return res.status(429).json({
        error: message || 'Too many requests. Please try again later.',
      });
    }

    sweep(now);
    next();
  };
}
