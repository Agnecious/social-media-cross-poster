/**
 * PlatformPublisher — the common contract every platform adapter implements.
 *
 * This is the "Strategy" interface. The rest of the app depends only on this
 * shape, never on a concrete platform. That keeps platform-specific quirks
 * (YouTube = video only, Instagram = public-URL two-step publish, etc.)
 * isolated inside each adapter.
 *
 * Subclasses must implement:
 *   - getAuthUrl(state)        -> string   (where to send the user to log in)
 *   - exchangeCode(code)       -> Promise<{ accessToken, meta }>
 *   - publish(post, auth)      -> Promise<{ id, url }>
 *   - capabilities()           -> { text, image, video } booleans
 */
export class PlatformPublisher {
  /**
   * @param {string} key stable platform key, e.g. "facebook"
   * @param {object} platformConfig config slice from env
   */
  constructor(key, platformConfig) {
    if (new.target === PlatformPublisher) {
      throw new Error('PlatformPublisher is abstract and cannot be instantiated directly.');
    }
    this.key = key;
    this.config = platformConfig;
  }

  /** Build the platform's OAuth authorization URL. */
  getAuthUrl(_state) {
    throw new Error(`${this.key}: getAuthUrl() not implemented`);
  }

  /**
   * Exchange an OAuth `code` for an access token. Stateless — returns to caller.
   * `state` is the same opaque value the adapter put in the auth URL; adapters
   * that use PKCE (e.g. X) encode their code_verifier into it and recover it
   * here. Adapters that don't need it simply ignore the argument.
   */
  async exchangeCode(_code, _state) {
    throw new Error(`${this.key}: exchangeCode() not implemented`);
  }

  /**
   * Resolve the connected account's identity after OAuth, so multiple accounts
   * of the same platform can be labelled and distinguished. Adapters should
   * override to fetch the real name/handle; the default returns a generic id.
   *
   * @param {object} _auth { accessToken }
   * @returns {Promise<{ accountId: string, label: string }>}
   */
  async identity(_auth) {
    return { accountId: `acct-${Date.now()}`, label: `${this.key} account` };
  }

  /**
   * Publish a post.
   * @param {object} post { text, mediaType: 'none'|'image'|'video', mediaUrl?, filePath?, title? }
   * @param {object} auth { accessToken, ...meta }
   */
  async publish(_post, _auth) {
    throw new Error(`${this.key}: publish() not implemented`);
  }

  /** What this platform accepts. Used by the UI to enable/disable options. */
  capabilities() {
    return { text: false, image: false, video: false };
  }

  /**
   * List the concrete publishing destinations for this platform (e.g. Facebook
   * Pages, Instagram Business accounts). Platforms that post to a single
   * implicit target (YouTube, TikTok) return an empty list.
   *
   * @param {object} _auth { accessToken }
   * @returns {Promise<Array<{ id: string, name: string, extra?: object }>>}
   */
  async listTargets(_auth) {
    return [];
  }

  /** Does the UI need the user to choose a target before publishing? */
  requiresTarget() {
    return false;
  }

  /**
   * Does this platform's API support scheduling a post for a future time?
   * Platforms that return false can only be scheduled via the browser-timer
   * fallback (which requires the tab to stay open).
   */
  supportsScheduling() {
    return false;
  }

  /** Whether this platform can return analytics/insights via its API. */
  supportsAnalytics() {
    return false;
  }

  /**
   * Fetch analytics for a connected account over a period.
   *
   * @param {object} _auth { accessToken }
   * @param {object} _opts { days, accountId, target? }
   * @returns {Promise<{ supported: boolean, metrics: Array<{key,label,value}>, note?: string }>}
   */
  async analytics(_auth, _opts) {
    return { supported: false, metrics: [], note: 'Analytics not available for this platform.' };
  }

  /** Guard used by adapters to reject unsupported media before hitting the API. */
  assertSupports(mediaType) {
    const caps = this.capabilities();
    const ok =
      (mediaType === 'none' && caps.text) ||
      (mediaType === 'image' && caps.image) ||
      (mediaType === 'video' && caps.video);
    if (!ok) {
      throw new Error(
        `${this.key} does not support media type "${mediaType}". ` +
          `Supported: ${JSON.stringify(caps)}`
      );
    }
  }
}
