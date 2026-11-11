import crypto from 'node:crypto';
import { logger } from '../services/logger.js';

/**
 * requestLogger — assigns each request a short id, attaches a child logger as
 * `req.log`, and logs one line when the response finishes (method, path,
 * status, duration). The request id is also returned to the client as the
 * `X-Request-Id` header so a user can quote it when reporting an issue.
 *
 * Put this early in the middleware chain (after security headers). Because it
 * sets `req.log`, later middleware/routes can log with the request id attached:
 *   req.log.info('did a thing', { foo: 1 })
 */
export function requestLogger(req, res, next) {
  const id = req.headers['x-request-id'] || crypto.randomBytes(6).toString('hex');
  res.setHeader('X-Request-Id', id);
  req.id = id;
  req.log = logger.child({ reqId: id });

  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durMs = Number(process.hrtime.bigint() - start) / 1e6;
    // Identify the actor if auth middleware resolved one (best-effort).
    const actor = req.customer?.id
      ? { customerId: req.customer.id }
      : req.admin?.username
        ? { admin: req.admin.username }
        : {};
    const level = res.statusCode >= 500 ? 'error' : res.statusCode >= 400 ? 'warn' : 'info';
    req.log[level]('request', {
      method: req.method,
      path: req.originalUrl.split('?')[0],
      status: res.statusCode,
      durMs: Math.round(durMs),
      ...actor,
    });
  });

  next();
}
