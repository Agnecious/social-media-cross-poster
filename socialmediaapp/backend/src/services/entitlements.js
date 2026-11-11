/**
 * Entitlements — plan/trial access rules for feature gating.
 *
 * A customer may use gated features when EITHER:
 *   - their free trial is still active (trialEndsAt in the future), OR
 *   - their subscription is 'active'.
 * Otherwise (trial expired and not active, or explicitly 'canceled') gated
 * actions like connecting accounts and publishing are blocked.
 *
 * This is DB-only (no payments): a customer moves to 'active' by choosing a
 * plan after the trial (see PUT /api/customer/plan). The intent is that an
 * expired trial should stop new publishing/connecting until they pick a plan.
 */

/**
 * Whether a customer is entitled to use gated features.
 * @param {{trialEndsAt?: Date|string|null, subscriptionStatus?: string}} customer
 * @returns {boolean}
 */
export function hasActiveAccess(customer) {
  if (!customer) return false;
  if (customer.subscriptionStatus === 'active') return true;
  const ends = customer.trialEndsAt ? new Date(customer.trialEndsAt) : null;
  return !!ends && ends.getTime() > Date.now();
}

/**
 * A short machine-readable reason when access is denied (for the client to
 * show the right nudge). Returns null when access IS allowed.
 * @param {object} customer
 * @returns {'trial_expired'|'canceled'|null}
 */
export function accessDeniedReason(customer) {
  if (hasActiveAccess(customer)) return null;
  if (customer?.subscriptionStatus === 'canceled') return 'canceled';
  return 'trial_expired';
}
