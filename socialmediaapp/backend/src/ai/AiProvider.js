/**
 * AiProvider — the contract every AI text provider adapter implements (Strategy
 * pattern, mirroring BillingProvider and PlatformPublisher). The rest of the
 * app depends only on this shape, never on a concrete provider, so the
 * primary→fallback chain (Gemini → OpenRouter) is a factory concern, not a
 * caller concern.
 *
 * Providers do ONE thing: turn a prompt into text. All the product logic
 * (platform content, rewrite, hashtags, titles, translate) lives in AiService,
 * which composes prompts and asks whichever provider is active to complete them.
 */
export class AiProvider {
  /** @param {object} cfg provider config slice from aiConfig() */
  constructor(cfg) {
    if (new.target === AiProvider) {
      throw new Error('AiProvider is abstract.');
    }
    this.cfg = cfg;
  }

  /** Stable provider key, e.g. 'gemini' | 'openrouter'. */
  get key() {
    throw new Error('key not implemented');
  }

  /** Whether this provider has the credentials it needs to run. */
  get isConfigured() {
    return !!this.cfg?.apiKey;
  }

  /**
   * Complete a prompt and return the model's text output.
   *
   * @param {object} args
   * @param {string} args.system   system / role instruction (tone, output rules)
   * @param {string} args.user     the user content / task
   * @param {number} [args.maxTokens] soft cap on output length
   * @param {number} [args.temperature] creativity 0..1
   * @returns {Promise<string>} raw text from the model
   */
  async complete(_args) {
    throw new Error('complete not implemented');
  }

  /**
   * Reachability probe: can the backend actually REACH this provider's host?
   * Used by the admin health check to surface an egress block (keys present but
   * every call fails with "fetch failed") distinctly from a config problem.
   *
   * Implementations should make ONE cheap HTTP call that treats ANY HTTP
   * response (even 4xx auth errors) as "reachable" — we only care about
   * network connectivity, not the body. A thrown connection error means blocked.
   *
   * @returns {Promise<void>} resolves if the host responded; rejects if unreachable
   */
  async ping() {
    throw new Error('ping not implemented');
  }
}
