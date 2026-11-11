/**
 * Plan catalogue types — mirror the backend central plans config
 * (backend/src/config/plans.js) served by GET /api/plans.
 */

/** Currency metadata for display (ZAR). */
export interface PlanCurrency {
  code: string;   // e.g. "ZAR"
  symbol: string; // e.g. "R"
  locale: string; // e.g. "en-ZA"
}

/** A single subscription tier. */
export interface Plan {
  id: string;
  name: string;
  priceZar: number | null;
  tagline: string;
  highlight: boolean;
  features: string[];
  limits: { maxAccountsPerPlatform: number };
}

/** The full catalogue payload from GET /api/plans. */
export interface PlanCatalogue {
  currency: PlanCurrency;
  trialDays: number;
  defaultTrialPlan: string;
  plans: Plan[];
}

/** A customer's current subscription (GET /api/customer/subscription). */
export interface Subscription {
  plan: string;
  planDetails: Plan | null;
  subscriptionStatus: string; // pending_setup | trialing | active | past_due | canceled
  planStatus: string;
  trialEndsAt: string | null;
  trialActive: boolean;
  trialDaysLeft: number;
}

/** Billing status (GET /api/customer/billing). */
export interface BillingStatus {
  enabled: boolean;
  provider: string; // mock | peach
  plan: string;
  planDetails: Plan | null;
  subscriptionStatus: string; // pending_setup | trialing | active | past_due | canceled
  access: { allowed: boolean; reason?: string };
  trial: {
    postsUsed: number;
    maxPosts: number;
    trialEndsAt: string | null;
    publishAllowed: boolean;
  };
  subscription: { status: string; provider: string; currentPeriodEnd: string | null } | null;
}

/** Response from POST /api/customer/billing/subscribe. */
export interface SubscribeResponse {
  redirectUrl?: string;
  checkoutId?: string;
  provider: string;
}
