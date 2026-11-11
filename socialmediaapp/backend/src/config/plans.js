/**
 * Central subscription-plan catalogue — the ONE place to define tiers, features
 * and limits. Everything else (the public pricing page, the customer
 * Plan/Billing screen, plan validation, the admin dashboard) reads from here
 * via GET /api/plans.
 *
 * PRICES AND TRIAL LENGTH ARE READ FROM ENV so they can be changed without a
 * code change or rebuild (and, like the platform config, picked up live when
 * the .env file is edited):
 *   PLAN_STARTER_PRICE_ZAR, PLAN_PRO_PRICE_ZAR, PLAN_AGENCY_PRICE_ZAR
 *   TRIAL_DAYS
 * If an env value is missing or invalid, the DEFAULT_* fallback below is used,
 * so the app always has sensible prices. `priceZar` of null means "custom".
 *
 * Currency is South African Rand (ZAR) only. Prices are the monthly amount in
 * Rand. There is intentionally NO free tier — new customers get a trial (see
 * TRIAL below) that defaults to the Starter plan.
 *
 * To change a price: set the env var (e.g. PLAN_PRO_PRICE_ZAR=599). To add a
 * tier: add a definition to PLAN_DEFS (id must be lowercase, unique, and stable
 * — it is stored on the Customer row) and, optionally, a matching price env var
 * via `priceEnv`. Keep the ids in sync with the Prisma `plan` field values.
 */

/** Fallbacks used when the matching env var is missing/invalid. */
const DEFAULT_TRIAL_DAYS = 30;
const DEFAULT_PRICES_ZAR = Object.freeze({ starter: 169, pro: 529, agency: 1399 });

/** The plan a customer is placed on when their trial starts. Must be a plan id. */
export const DEFAULT_TRIAL_PLAN = 'starter';

/**
 * Static tier definitions (everything except the price, which comes from env).
 * `priceEnv` is the env var read for that tier's monthly ZAR price.
 * `limits.maxAccountsPerPlatform` of 0 = unlimited.
 * `highlight` marks the tier shown as "most popular" on the pricing page.
 */
const PLAN_DEFS = [
  {
    id: 'starter',
    name: 'Starter',
    priceEnv: 'PLAN_STARTER_PRICE_ZAR',
    defaultPriceZar: DEFAULT_PRICES_ZAR.starter,
    accountsEnv: 'PLAN_STARTER_MAX_ACCOUNTS',
    aiEnv: 'PLAN_STARTER_AI',
    tagline: 'For solo creators getting started.',
    highlight: false,
    features: [
      'Cross-post to all 4 platforms',
      '1 account per platform',
      'Schedule posts',
      'Basic analytics',
      'Email support',
    ],
    limits: { maxAccountsPerPlatform: 1, aiAssistant: false },
  },
  {
    id: 'pro',
    name: 'Pro',
    priceEnv: 'PLAN_PRO_PRICE_ZAR',
    defaultPriceZar: DEFAULT_PRICES_ZAR.pro,
    accountsEnv: 'PLAN_PRO_MAX_ACCOUNTS',
    aiEnv: 'PLAN_PRO_AI',
    tagline: 'For growing brands managing more.',
    highlight: true,
    features: [
      'Everything in Starter',
      'Up to 5 accounts per platform',
      'AI Content Assistant',
      'Advanced per-platform analytics',
      'Priority scheduling',
      'Priority support',
    ],
    limits: { maxAccountsPerPlatform: 5, aiAssistant: true },
  },
  {
    id: 'agency',
    name: 'Agency',
    priceEnv: 'PLAN_AGENCY_PRICE_ZAR',
    defaultPriceZar: DEFAULT_PRICES_ZAR.agency,
    accountsEnv: 'PLAN_AGENCY_MAX_ACCOUNTS',
    aiEnv: 'PLAN_AGENCY_AI',
    tagline: 'For agencies running many clients.',
    highlight: false,
    features: [
      'Everything in Pro',
      'Unlimited accounts per platform',
      'AI Content Assistant',
      'All analytics & exports',
      'Dedicated support',
    ],
    limits: { maxAccountsPerPlatform: 0, aiAssistant: true },
  },
];

/** Currency metadata for display. */
export const CURRENCY = Object.freeze({ code: 'ZAR', symbol: 'R', locale: 'en-ZA' });

/**
 * Resolve a tier's price from its env var, falling back to the default.
 * A blank env var means "custom / contact us" (null). A negative or
 * non-numeric value falls back to the default.
 * @param {string} envKey e.g. "PLAN_PRO_PRICE_ZAR"
 * @param {number} fallback the default ZAR price
 * @returns {number|null}
 */
function resolvePrice(envKey, fallback) {
  const raw = process.env[envKey];
  if (raw === undefined) return fallback;
  const trimmed = String(raw).trim();
  if (trimmed === '') return null; // explicit blank => custom pricing
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return n;
}

/**
 * Resolve a tier's max-accounts-per-platform cap. Read from the tier's env var
 * (e.g. PLAN_PRO_MAX_ACCOUNTS) so caps are configurable without code; falls
 * back to the tier's hardcoded `limits.maxAccountsPerPlatform`. A value of 0
 * means unlimited. Blank/invalid falls back to the default.
 * @param {string} envKey e.g. "PLAN_PRO_MAX_ACCOUNTS"
 * @param {number} fallback the tier's default cap (0 = unlimited)
 * @returns {number} the cap (>= 0; 0 = unlimited)
 */
function resolveAccountCap(envKey, fallback) {
  const raw = process.env[envKey];
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return fallback;
  return Math.floor(n); // 0 = unlimited
}

/**
 * Resolve a boolean capability from an env var, falling back to the tier's
 * default. Accepts `true/false`, `1/0`, `yes/no`, `on/off` (case-insensitive).
 * Blank/unset/invalid → the hardcoded default, so a tier is never accidentally
 * ungated by a typo.
 * @param {string} envKey e.g. "PLAN_PRO_AI"
 * @param {boolean} fallback the tier's default
 * @returns {boolean}
 */
function resolveBool(envKey, fallback) {
  const raw = process.env[envKey];
  if (raw === undefined) return fallback;
  const v = String(raw).trim().toLowerCase();
  if (v === '') return fallback;
  if (['true', '1', 'yes', 'on'].includes(v)) return true;
  if (['false', '0', 'no', 'off'].includes(v)) return false;
  return fallback;
}

/**
 * The length of the free trial, in days. Read from TRIAL_DAYS on demand,
 * defaulting to 30. A value of 0 or invalid falls back to the default.
 * @returns {number}
 */
export function trialDays() {
  const raw = process.env.TRIAL_DAYS;
  if (raw === undefined || String(raw).trim() === '') return DEFAULT_TRIAL_DAYS;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_TRIAL_DAYS;
  return Math.floor(n);
}

/**
 * Max successful cross-posts allowed during the trial. Read from
 * TRIAL_MAX_POSTS on demand (default 1). A single compose -> fan-out to several
 * platforms counts as ONE. 0 would mean "no posting during trial".
 * @returns {number}
 */
export function trialMaxPosts() {
  const raw = process.env.TRIAL_MAX_POSTS;
  if (raw === undefined || String(raw).trim() === '') return 1;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 1;
  return Math.floor(n);
}

/**
 * Build the current tiers, in display order, with prices resolved from env.
 * Computed on demand so .env edits take effect without a restart.
 * @returns {object[]}
 */
export function getPlans() {
  return PLAN_DEFS.map((def) => ({
    id: def.id,
    name: def.name,
    priceZar: resolvePrice(def.priceEnv, def.defaultPriceZar),
    tagline: def.tagline,
    highlight: def.highlight,
    features: def.features,
    limits: {
      ...def.limits,
      // Env-configurable, falling back to the tier's hardcoded default.
      maxAccountsPerPlatform: resolveAccountCap(def.accountsEnv, def.limits.maxAccountsPerPlatform),
      // Whether this tier includes the AI Content Assistant.
      aiAssistant: resolveBool(def.aiEnv, def.limits.aiAssistant),
    },
  }));
}

/**
 * The max accounts-per-platform a given plan allows (0 = unlimited). Resolves
 * from the tier's env override or its default. Unknown plan ids fall back to
 * the DEFAULT_TRIAL_PLAN's cap so a bad/legacy plan value never grants more
 * than the entry tier.
 * @param {string} planId
 * @returns {number} cap (0 = unlimited)
 */
export function planAccountCap(planId) {
  const def = PLAN_DEFS.find((p) => p.id === planId)
    ?? PLAN_DEFS.find((p) => p.id === DEFAULT_TRIAL_PLAN);
  if (!def) return 0;
  return resolveAccountCap(def.accountsEnv, def.limits.maxAccountsPerPlatform);
}

/**
 * Whether a given plan includes the AI Content Assistant. Resolves from the
 * tier's env override (`PLAN_<TIER>_AI`) or its default. Unknown/legacy plan
 * ids fall back to the DEFAULT_TRIAL_PLAN's capability, so a bad plan value
 * never grants more than the entry tier.
 * @param {string} planId
 * @returns {boolean}
 */
export function planHasAi(planId) {
  const def = PLAN_DEFS.find((p) => p.id === planId)
    ?? PLAN_DEFS.find((p) => p.id === DEFAULT_TRIAL_PLAN);
  if (!def) return false;
  return resolveBool(def.aiEnv, def.limits.aiAssistant);
}

/** @returns {string[]} valid plan ids (e.g. ['starter','pro','agency']) */
export function planIds() {
  return PLAN_DEFS.map((p) => p.id);
}

/** @returns {boolean} whether `id` is a known plan id */
export function isValidPlan(id) {
  return planIds().includes(id);
}

/** @returns {object|undefined} the plan (with resolved price) by id */
export function getPlan(id) {
  return getPlans().find((p) => p.id === id);
}

/**
 * The full catalogue payload served to clients.
 * @returns {{currency: object, trialDays: number, defaultTrialPlan: string, plans: object[]}}
 */
export function plansPayload() {
  return {
    currency: CURRENCY,
    trialDays: trialDays(),
    defaultTrialPlan: DEFAULT_TRIAL_PLAN,
    plans: getPlans(),
  };
}
