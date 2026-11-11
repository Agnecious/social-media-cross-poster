import { aiConfig } from '../config/index.js';
import { GeminiProvider } from './GeminiProvider.js';
import { OpenRouterProvider } from './OpenRouterProvider.js';
import { logger, errInfo } from '../services/logger.js';

/**
 * AI provider factory + fallback orchestration.
 *
 * The product never picks a provider directly — it calls generateWithFallback,
 * which tries the PRIMARY (Gemini) first and, only if that provider is
 * unconfigured or its call fails, falls back to OpenRouter. This keeps the app
 * working when one provider has an outage, a bad key, or (on this network) is
 * blocked by egress filtering.
 */

/** @returns {GeminiProvider} the primary provider, bound to current config. */
export function getPrimaryProvider() {
  return new GeminiProvider(aiConfig().gemini);
}

/** @returns {OpenRouterProvider} the fallback provider, bound to current config. */
export function getFallbackProvider() {
  return new OpenRouterProvider(aiConfig().openrouter);
}

/** Whether the AI feature is switched on (AI_ENABLED=true). */
export function isAiEnabled() {
  return aiConfig().enabled;
}

/** Whether at least one provider has an API key (feature can actually run). */
export function isAiConfigured() {
  return aiConfig().configured;
}

/**
 * Probe whether the backend can actually REACH an AI provider — the same
 * network path real generations use. Mirrors checkSupabaseReachable: catches an
 * egress / SSL-inspection block that leaves keys present but every AI call
 * failing with "fetch failed".
 *
 * Tries the configured providers in the primary→fallback order; the first host
 * that responds (any HTTP status) means reachable. If every configured provider
 * throws a connection error, it's blocked. If none are configured, reachable is
 * null (nothing to probe).
 *
 * @param {object} [log]
 * @returns {Promise<{ enabled:boolean, configured:boolean, reachable:boolean|null, provider?:string, reason?:string, latencyMs?:number }>}
 */
export async function checkAiReachable(log = logger) {
  const cfg = aiConfig();
  const base = { enabled: cfg.enabled, configured: cfg.configured };
  const chain = [getPrimaryProvider(), getFallbackProvider()].filter((p) => p.isConfigured);

  if (chain.length === 0) {
    return { ...base, reachable: null };
  }

  const t0 = Date.now();
  let lastErr;
  for (const provider of chain) {
    try {
      await provider.ping();
      return { ...base, reachable: true, provider: provider.key, latencyMs: Date.now() - t0 };
    } catch (err) {
      lastErr = err;
      log.warn('ai reachability: provider unreachable, trying next', {
        provider: provider.key,
        error: errInfo(err),
      });
    }
  }

  const code = lastErr?.code || lastErr?.cause?.code;
  const msg = lastErr?.message || String(lastErr);
  return {
    ...base,
    reachable: false,
    latencyMs: Date.now() - t0,
    reason: code || (/fetch failed/i.test(msg) ? 'fetch failed' : msg),
  };
}

/**
 * Run a completion through the primary→fallback chain.
 *
 * Order: Gemini (if configured) → OpenRouter (if configured). Each configured
 * provider is attempted in turn; the first success wins. If every configured
 * provider throws, the last error is surfaced. If NONE are configured, a clear
 * configuration error is thrown.
 *
 * @param {{system?:string, user:string, maxTokens?:number, temperature?:number}} args
 * @param {object} [log] a request-scoped logger (falls back to the module logger)
 * @returns {Promise<{text:string, provider:string}>}
 */
export async function generateWithFallback(args, log = logger) {
  const chain = [getPrimaryProvider(), getFallbackProvider()].filter((p) => p.isConfigured);

  if (chain.length === 0) {
    throw new Error('AI is not configured — set GEMINI_API_KEY and/or OPENROUTER_API_KEY.');
  }

  let lastErr;
  for (const provider of chain) {
    try {
      const text = await provider.complete(args);
      return { text, provider: provider.key };
    } catch (err) {
      lastErr = err;
      // Log and continue to the next provider in the chain.
      log.warn('ai provider failed, trying next', {
        provider: provider.key,
        error: errInfo(err),
      });
    }
  }
  // Every configured provider failed.
  throw lastErr || new Error('All AI providers failed.');
}
