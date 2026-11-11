import { createPublisher } from '../platforms/PublisherFactory.js';

/**
 * PublishService — Facade.
 *
 * The routes talk only to this service. It hides the details of resolving
 * adapters and fanning a single compose action out to multiple platforms.
 * It holds NO state: tokens and post data are passed in per call and
 * discarded when the request completes.
 */
export class PublishService {
  /**
   * Publish one post to many platforms.
   *
   * @param {object} post shared post payload (text, mediaType, filePath/mediaUrl, ...)
   * @param {Array<{platform: string, auth: object, options?: object}>} targets
   * @returns {Promise<Array<{platform, ok, result?, error?}>>}
   */
  async publishToMany(post, targets) {
    const results = await Promise.allSettled(
      targets.map(async ({ platform, auth, options }) => {
        const publisher = createPublisher(platform);
        const merged = { ...post, ...(options || {}) };
        const result = await publisher.publish(merged, auth);
        return { result };
      })
    );

    return results.map((r, i) => {
      const { platform, accountId, label } = targets[i];
      const base = { platform, accountId, label };
      if (r.status === 'fulfilled') {
        return { ...base, ok: true, result: r.value.result };
      }
      return { ...base, ok: false, error: normalizeError(r.reason) };
    });
  }

  /** Build an OAuth authorization URL for a single platform. */
  getAuthUrl(platform, state) {
    return createPublisher(platform).getAuthUrl(state);
  }

  /** Exchange an OAuth code for a token for a single platform. */
  async exchangeCode(platform, code) {
    return createPublisher(platform).exchangeCode(code);
  }

  /** Resolve a connected account's identity (id + label) for a platform. */
  async identity(platform, auth) {
    return createPublisher(platform).identity(auth);
  }
}

function normalizeError(err) {
  if (err?.response?.data) {
    return typeof err.response.data === 'string'
      ? err.response.data
      : JSON.stringify(err.response.data);
  }
  return err?.message || String(err);
}

export const publishService = new PublishService();
