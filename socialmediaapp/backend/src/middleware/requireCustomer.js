import { getUserFromToken, isSupabaseConfigured } from '../services/SupabaseService.js';
import { prisma } from '../db/prisma.js';
import { trialDays, DEFAULT_TRIAL_PLAN } from '../config/plans.js';
import { billingConfig } from '../config/index.js';
import { logger, errInfo } from '../services/logger.js';

/**
 * requireCustomer — protects customer-scoped routes.
 *
 * Expects `Authorization: Bearer <supabase-access-token>`. Verifies it with
 * Supabase, then ensures a local Customer row exists (auto-provisioned on first
 * authenticated request) and attaches it as `req.customer`. This `customerId`
 * is what every customer-scoped query MUST filter on.
 */
export async function requireCustomer(req, res, next) {
  if (!isSupabaseConfigured()) {
    return res.status(500).json({ error: 'Customer auth is not configured (missing Supabase keys).' });
  }

  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    return res.status(401).json({ error: 'Authentication required.' });
  }

  const user = await getUserFromToken(token);
  if (!user) {
    return res.status(401).json({ error: 'Invalid or expired session.' });
  }

  try {
    // Profile captured at sign-up rides along in the Supabase user's metadata.
    const meta = user.user_metadata || {};
    const firstName = meta.firstName ?? null;
    const lastName = meta.lastName ?? null;
    const phone = meta.phone ?? null;

    // First login for this Supabase user → create their Customer row.
    //
    // Billing ON (the SaaS model): new customers start at 'pending_setup' —
    // they MUST choose a plan + add billing before any access or trial. The
    // billing flow (startTrial / webhooks) moves them to trialing/active.
    //
    // Billing OFF (dev / pre-billing): preserve the old behaviour of granting
    // an immediate trial so nothing breaks when billing isn't configured.
    const billingOn = billingConfig().enabled;
    const createData = {
      id: user.id,
      email: user.email ?? `${user.id}@unknown.local`,
      firstName,
      lastName,
      phone,
      plan: DEFAULT_TRIAL_PLAN,
    };
    if (billingOn) {
      createData.subscriptionStatus = 'pending_setup';
    } else {
      createData.subscriptionStatus = 'trialing';
      createData.trialEndsAt = new Date(Date.now() + trialDays() * 86400000);
    }

    let customer = await prisma.customer.upsert({
      where: { id: user.id },
      update: {
        email: user.email ?? undefined,
        firstName: firstName ?? undefined,
        lastName: lastName ?? undefined,
        phone: phone ?? undefined,
      },
      create: createData,
    });

    // Billing OFF only: backfill a trial for pre-existing rows that never had
    // one, so dev accounts aren't stuck. (When billing is ON we intentionally
    // leave existing statuses alone — the billing flow owns transitions.)
    if (!billingOn && !customer.trialEndsAt && customer.subscriptionStatus !== 'active') {
      customer = await prisma.customer.update({
        where: { id: customer.id },
        data: { subscriptionStatus: 'trialing', trialEndsAt: new Date(Date.now() + trialDays() * 86400000) },
      });
    }

    req.customer = customer;
    next();
  } catch (err) {
    (req.log ?? logger).error('requireCustomer provisioning error', { error: errInfo(err) });
    res.status(500).json({ error: 'Could not resolve your account.' });
  }
}
