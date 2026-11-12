import dotenv from 'dotenv';

dotenv.config();

/** The platforms this app knows how to talk to, and their env prefixes. */
export const PLATFORM_KEYS = Object.freeze({
  facebook: 'FACEBOOK',
  instagram: 'INSTAGRAM',
  youtube: 'YOUTUBE',
  tiktok: 'TIKTOK',
  x: 'X',
});

/**
 * Reads a single platform's configuration from environment variables.
 * Computed on demand so that changes made at runtime (e.g. via the Admin UI,
 * which updates process.env and the .env file) are picked up immediately.
 *
 * @param {string} prefix e.g. "FACEBOOK"
 * @returns {object} platform config
 */
function readPlatformConfig(prefix) {
  return {
    enabled: process.env[`${prefix}_ENABLED`] === 'true',
    clientId: process.env[`${prefix}_CLIENT_ID`] || '',
    clientSecret: process.env[`${prefix}_CLIENT_SECRET`] || '',
    redirectUri: process.env[`${prefix}_REDIRECT_URI`] || '',
    scopes: (process.env[`${prefix}_SCOPES`] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    apiVersion: process.env[`${prefix}_API_VERSION`] || '',
  };
}

/** Server-level config, fixed at boot. */
export const serverConfig = Object.freeze({
  port: Number(process.env.PORT) || 3000,
  frontendOrigin: process.env.FRONTEND_ORIGIN || 'http://localhost:4200',
});

/** @returns {object} the full, current platforms map (recomputed each call) */
export function getPlatforms() {
  const platforms = {};
  for (const [key, prefix] of Object.entries(PLATFORM_KEYS)) {
    platforms[key] = readPlatformConfig(prefix);
  }
  return platforms;
}

/** @returns {string[]} keys of platforms that are enabled AND have credentials */
export function enabledPlatformKeys() {
  return Object.entries(getPlatforms())
    .filter(([, p]) => p.enabled && p.clientId && p.clientSecret)
    .map(([key]) => key);
}

/** @returns {object} config for one platform, or throws if unknown */
export function getPlatformConfig(key) {
  if (!PLATFORM_KEYS[key]) throw new Error(`Unknown platform: ${key}`);
  return readPlatformConfig(PLATFORM_KEYS[key]);
}

/**
 * Max number of accounts a user may connect per platform.
 * Read from MAX_ACCOUNTS_PER_PLATFORM. Default 5. A value of 0 (or blank/invalid)
 * means unlimited. Read on demand so changes take effect without a restart.
 *
 * @returns {number} the cap, or 0 for unlimited
 */
export function maxAccountsPerPlatform() {
  const raw = process.env.MAX_ACCOUNTS_PER_PLATFORM;
  if (raw === undefined || raw.trim() === '') return 5;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < 0) return 5;
  return Math.floor(n); // 0 = unlimited
}

/**
 * The app-wide UI theme the frontend should render in. Read from APP_THEME on
 * demand, normalized to 'light' or 'dark'. Anything else (unset/invalid) falls
 * back to 'light'. This is a single shipped theme for the whole app (no
 * per-user toggle) — change APP_THEME in .env and restart to switch.
 *
 * @returns {'light'|'dark'}
 */
export function appTheme() {
  const raw = (process.env.APP_THEME || '').trim().toLowerCase();
  return raw === 'dark' ? 'dark' : 'light';
}

/**
 * The support inbox customers' "Contact support" messages are addressed to.
 * Read from SUPPORT_EMAIL on demand; defaults to the business Gmail so the
 * feature works out of the box. Change it in .env without a code change.
 *
 * @returns {string}
 */
export function supportEmail() {
  const raw = (process.env.SUPPORT_EMAIL || '').trim();
  return raw || 'mathema.business@gmail.com';
}

/**
 * SMTP mail configuration for sending support emails server-side. Read on
 * demand. `enabled` is true only when the essential SMTP fields are present —
 * when false the app falls back to the client-side `mailto:` behaviour.
 *
 * For Gmail: host=smtp.gmail.com, port=465 (secure) or 587, user=<your gmail>,
 * pass=<a Google App Password> (NOT your normal password; requires 2FA).
 *
 * @returns {{enabled:boolean, host:string, port:number, secure:boolean, user:string, pass:string, from:string}}
 */
export function mailConfig() {
  const host = (process.env.SMTP_HOST || '').trim();
  const user = (process.env.SMTP_USER || '').trim();
  const pass = process.env.SMTP_PASS || '';
  const port = Number(process.env.SMTP_PORT) || 587;
  return {
    enabled: !!(host && user && pass),
    host,
    port,
    // Port 465 implies implicit TLS; others use STARTTLS.
    secure: port === 465,
    user,
    pass,
    // The visible From address; defaults to the SMTP user.
    from: (process.env.SMTP_FROM || user || '').trim(),
  };
}

/**
 * Billing configuration, read on demand.
 *  - enabled: master switch. When false, billing endpoints are inert and the
 *    old behaviour (no payment required) stands — nothing breaks for dev.
 *  - provider: which BillingProvider to use ('mock' | 'peach' | 'paystack');
 *    default 'mock'.
 *  - webhookSecret: shared secret used to verify inbound provider webhooks
 *    (used by mock/peach; Paystack verifies with its own secret key instead).
 *  - peach*: Peach Payments REST creds (only used by the peach provider).
 *  - paystack*: Paystack creds (only used by the paystack provider). The
 *    SECRET key both authorises API calls AND signs webhooks (HMAC-SHA512).
 * @returns {{enabled:boolean, provider:string, webhookSecret:string, peach:object, paystack:object}}
 */
export function billingConfig() {
  return {
    enabled: process.env.BILLING_ENABLED === 'true',
    provider: (process.env.BILLING_PROVIDER || 'mock').trim().toLowerCase(),
    webhookSecret: process.env.BILLING_WEBHOOK_SECRET || '',
    peach: {
      entityId: process.env.PEACH_ENTITY_ID || '',
      accessToken: process.env.PEACH_ACCESS_TOKEN || '',
      baseUrl: process.env.PEACH_BASE_URL || 'https://testapi.peachpayments.com',
    },
    paystack: {
      secretKey: (process.env.PAYSTACK_SECRET_KEY || '').trim(),
      publicKey: (process.env.PAYSTACK_PUBLIC_KEY || '').trim(),
      baseUrl: (process.env.PAYSTACK_BASE_URL || 'https://api.paystack.co').trim(),
      currency: (process.env.PAYSTACK_CURRENCY || 'ZAR').trim().toUpperCase(),
    },
  };
}

/**
 * AI Content Assistant configuration, read on demand (so .env edits take
 * effect without a restart, like the other config readers).
 *
 * Two providers in a primary→fallback chain:
 *  - Google Gemini (PRIMARY): generativelanguage.googleapis.com. Needs
 *    GEMINI_API_KEY; model defaults to a fast, cheap flash model.
 *  - OpenRouter (FALLBACK): openrouter.ai, an OpenAI-compatible gateway to many
 *    models. Used only when Gemini is unconfigured or its call fails.
 *
 * `enabled` is the master switch (AI_ENABLED=true). When false, AI endpoints
 * return 503 and the UI hides the feature. `configured` is true when at least
 * one provider has an API key — the feature can't actually run without one.
 *
 * @returns {{enabled:boolean, configured:boolean, gemini:object, openrouter:object}}
 */
export function aiConfig() {
  const gemini = {
    apiKey: (process.env.GEMINI_API_KEY || '').trim(),
    model: (process.env.GEMINI_MODEL || 'gemini-1.5-flash').trim(),
    baseUrl: (process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com').trim(),
  };
  const openrouter = {
    apiKey: (process.env.OPENROUTER_API_KEY || '').trim(),
    model: (process.env.OPENROUTER_MODEL || 'openai/gpt-4o-mini').trim(),
    baseUrl: (process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1').trim(),
  };
  return {
    enabled: process.env.AI_ENABLED === 'true',
    configured: !!(gemini.apiKey || openrouter.apiKey),
    gemini,
    openrouter,
  };
}
