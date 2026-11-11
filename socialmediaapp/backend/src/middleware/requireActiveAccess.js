import { accessState } from '../services/subscriptionState.js';
import { billingConfig } from '../config/index.js';

/**
 * requireActiveAccess — gates app actions behind a valid billing state.
 *
 * MUST run AFTER requireCustomer (reads req.customer). Blocks with 402 when the
 * customer isn't entitled, with a machine-readable `reason` the UI uses to
 * route them (e.g. pending_setup → choose a plan; trial_expired/past_due/
 * canceled → billing).
 *
 * When billing is DISABLED (BILLING_ENABLED != true) this is a no-op, so dev
 * and the pre-billing behaviour are unaffected.
 */
export function requireActiveAccess(req, res, next) {
  if (!billingConfig().enabled) return next();

  const { allowed, reason } = accessState(req.customer);
  if (allowed) return next();

  const messages = {
    pending_setup: 'Choose a plan and add billing to start your trial.',
    trial_expired: 'Your free trial has ended. Choose a plan to continue.',
    past_due: 'Your last payment failed. Update billing to continue.',
    canceled: 'Your subscription is canceled. Choose a plan to continue.',
  };
  return res.status(402).json({ error: messages[reason] || 'Billing setup required.', reason });
}
