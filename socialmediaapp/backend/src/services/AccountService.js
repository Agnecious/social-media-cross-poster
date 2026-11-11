import { prisma } from '../db/prisma.js';
import { encrypt, decrypt } from './crypto.js';
import { maxAccountsPerPlatform } from '../config/index.js';
import { planAccountCap } from '../config/plans.js';

/**
 * Resolve the effective per-platform account cap for a customer's plan.
 *
 * The plan's own cap (from the configurable plans catalogue) is authoritative.
 * A plan cap of 0 means "unlimited by plan" — in that case we fall back to the
 * global MAX_ACCOUNTS_PER_PLATFORM as an operator safety ceiling (which may
 * itself be 0 = truly unlimited). This keeps plan tiers in control while still
 * honouring a global cap for "unlimited" tiers.
 *
 * @param {string} plan the customer's plan id
 * @returns {number} cap (0 = unlimited)
 */
export function effectiveAccountCap(plan) {
  const planCap = planAccountCap(plan);
  if (planCap > 0) return planCap;
  return maxAccountsPerPlatform(); // plan is unlimited → defer to global ceiling (0 = unlimited)
}

/**
 * AccountService — per-customer connected social accounts, stored in the DB
 * (connected_accounts), with the OAuth token AES-encrypted at rest. Everything
 * is scoped by customerId so one customer can never see or use another's.
 *
 * Replaces the global TokenStore for the multi-tenant customer flows.
 */
export class AccountService {
  /**
   * List a customer's connected accounts (auth decrypted for use).
   * @returns {Promise<Array<{platform,accountId,label,auth,scopes}>>}
   */
  async list(customerId) {
    const rows = await prisma.connectedAccount.findMany({
      where: { customerId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((r) => ({
      platform: r.platform,
      accountId: r.accountId,
      label: r.label,
      scopes: r.scopes,
      auth: safeParse(decrypt(r.authEnc)),
    }));
  }

  /** Get one account's decrypted auth, scoped to the customer. */
  async getAuth(customerId, platform, accountId) {
    const row = await prisma.connectedAccount.findUnique({
      where: { customerId_platform_accountId: { customerId, platform, accountId } },
    });
    if (!row) return null;
    return safeParse(decrypt(row.authEnc));
  }

  /**
   * Add or replace a connected account for a customer.
   *
   * Enforces the customer's PLAN account cap per platform (from the configurable
   * plans catalogue), falling back to the global ceiling for unlimited plans.
   * Replacing an existing account is always allowed (doesn't count against the
   * cap). Returns { ok } or { ok:false, reason:'limit', max }.
   *
   * @param {string} customerId
   * @param {object} args
   * @param {string} args.plan the customer's plan id (drives the cap)
   */
  async add(customerId, { platform, accountId, label, auth, scopes, plan }) {
    const max = effectiveAccountCap(plan);
    if (max > 0) {
      const existing = await prisma.connectedAccount.findUnique({
        where: { customerId_platform_accountId: { customerId, platform, accountId } },
      });
      if (!existing) {
        const count = await prisma.connectedAccount.count({ where: { customerId, platform } });
        if (count >= max) {
          return { ok: false, reason: `limit`, max };
        }
      }
    }

    await prisma.connectedAccount.upsert({
      where: { customerId_platform_accountId: { customerId, platform, accountId } },
      update: { label, authEnc: encrypt(JSON.stringify(auth)), scopes: scopes ?? null },
      create: {
        customerId,
        platform,
        accountId,
        label,
        authEnc: encrypt(JSON.stringify(auth)),
        scopes: scopes ?? null,
      },
    });
    return { ok: true };
  }

  /** Remove one connected account, scoped to the customer. */
  async remove(customerId, platform, accountId) {
    await prisma.connectedAccount.deleteMany({
      where: { customerId, platform, accountId },
    });
  }
}

function safeParse(json) {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

export const accountService = new AccountService();
