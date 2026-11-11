import { prisma } from '../db/prisma.js';
import { logger, errInfo } from './logger.js';

/**
 * Audit logging — a persistent record of WHO did WHAT, for sensitive,
 * deliberate actions (admin config edits, plan changes, connect/disconnect).
 *
 * Distinct from the structured request/error logger: that captures "what
 * happened to the system"; this captures "who deliberately did this", kept in
 * the DB (audit_logs) so it's queryable and durable.
 *
 * Design rules:
 *  - BEST-EFFORT: a failed audit write must never break the user's action, so
 *    recordAudit never throws — it logs the failure and returns.
 *  - NO SECRETS: metadata is a small non-sensitive JSON blob only.
 */

/**
 * Derive the acting principal + client IP from the request. Admin routes set
 * req.admin (from the JWT); customer routes set req.customer.
 * @returns {{ actorType: 'admin'|'customer'|'system', actorId: string|null, ip: string|null }}
 */
export function actorFromReq(req) {
  if (req?.admin?.username) {
    return { actorType: 'admin', actorId: req.admin.username, actorLabel: req.admin.username, ip: clientIp(req) };
  }
  if (req?.customer?.id) {
    // Prefer the human-readable email as the label; fall back to the id.
    return {
      actorType: 'customer',
      actorId: req.customer.id,
      actorLabel: req.customer.email ?? req.customer.id,
      ip: clientIp(req),
    };
  }
  return { actorType: 'system', actorId: null, actorLabel: 'system', ip: clientIp(req) };
}

function clientIp(req) {
  if (!req) return null;
  const fwd = req.headers?.['x-forwarded-for'];
  return (Array.isArray(fwd) ? fwd[0] : fwd)?.split(',')[0].trim() || req.ip || null;
}

/**
 * Record one audit entry. Never throws.
 *
 * @param {object} req  the Express request (for actor + ip); may be omitted for system events
 * @param {object} entry
 * @param {string} entry.action      e.g. 'customer.plan.change'
 * @param {string} [entry.targetType] e.g. 'customer' | 'platform' | 'account'
 * @param {string} [entry.targetId]
 * @param {object} [entry.metadata]  small, non-sensitive detail (serialised to JSON)
 */
export async function recordAudit(
  req,
  { action, targetType = null, targetId = null, targetLabel = null, metadata = null }
) {
  const { actorType, actorId, actorLabel, ip } = actorFromReq(req);
  try {
    await prisma.auditLog.create({
      data: {
        actorType,
        actorId,
        actorLabel,
        action,
        targetType,
        targetId,
        targetLabel,
        ip,
        metadata: metadata == null ? null : safeJson(metadata),
      },
    });
    // Mirror into the structured log too, so it shows in the live stream.
    (req?.log ?? logger).info('audit', { action, actorType, actorLabel, targetType, targetId, targetLabel });
  } catch (err) {
    // Never let an audit failure break the actual operation.
    (req?.log ?? logger).error('audit write failed', { action, error: errInfo(err) });
  }
}

function safeJson(obj) {
  try {
    const s = JSON.stringify(obj);
    return s.length > 4000 ? s.slice(0, 4000) : s;
  } catch {
    return null;
  }
}
