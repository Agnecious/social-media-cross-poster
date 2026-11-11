import { http } from '../services/http.js';
import { PlatformPublisher } from './PlatformPublisher.js';

/**
 * Instagram adapter — Graph API, Business/Creator accounts only.
 *
 * Instagram publishing is a TWO-STEP process and requires the media to be
 * reachable at a PUBLIC URL (Instagram fetches it itself):
 *   1) create a media "container" pointing at the public image/video URL
 *   2) publish that container
 *
 * Because of this, `post.mediaUrl` (a public URL) is required — not a local file.
 * Pure text posts are not supported by Instagram.
 */
export class InstagramPublisher extends PlatformPublisher {
  get base() {
    return `https://graph.facebook.com/${this.config.apiVersion || 'v21.0'}`;
  }

  capabilities() {
    return { text: false, image: true, video: true };
  }

  requiresTarget() {
    return true;
  }

  supportsAnalytics() {
    return true;
  }

  /**
   * Instagram Business account insights over the last `days`. Requires the
   * selected IG Business account (target) and the instagram_manage_insights
   * scope on the connection.
   *
   * @param {object} auth { accessToken }
   * @param {object} opts { days, target: { id } }  // id = IG business user id
   */
  async analytics(auth, opts = {}) {
    const days = clampDaysIg(opts.days);
    const igId = opts.target?.id;
    if (!igId) {
      return { supported: true, metrics: [], note: 'Select an Instagram account to see its insights.' };
    }
    const since = Math.floor((Date.now() - days * 86400000) / 1000);
    const until = Math.floor(Date.now() / 1000);

    // Time-series insights. Request independently-safe keys; the API rejects the
    // whole call if ANY metric is unsupported, so keep this to widely-available
    // ones and catch failures.
    const labels = {
      impressions: 'Impressions',
      reach: 'Reach',
      profile_views: 'Profile views',
      follower_count: 'New followers',
      website_clicks: 'Website clicks',
    };
    const categories = {
      impressions: 'reach',
      reach: 'reach',
      profile_views: 'engagement',
      follower_count: 'audience',
      website_clicks: 'engagement',
    };

    const metrics = [];
    try {
      const { data } = await http.get(`${this.base}/${igId}/insights`, {
        params: {
          access_token: auth.accessToken,
          metric: 'impressions,reach,profile_views',
          period: 'day',
          since,
          until,
        },
      });
      for (const m of data.data || []) {
        const values = Array.isArray(m.values) ? m.values : [];
        const value = values.reduce((sum, v) => sum + Number(v.value ?? 0), 0);
        metrics.push({ key: m.name, label: labels[m.name] || m.name, value, category: categories[m.name] || 'engagement' });
      }
    } catch {
      // Insights window unsupported for this account — continue with totals.
    }

    // New-followers series (separate call; not all accounts expose it).
    try {
      const { data } = await http.get(`${this.base}/${igId}/insights`, {
        params: { access_token: auth.accessToken, metric: 'follower_count', period: 'day', since, until },
      });
      const series = data.data?.[0]?.values;
      if (Array.isArray(series)) {
        const value = series.reduce((sum, v) => sum + Number(v.value ?? 0), 0);
        metrics.push({ key: 'follower_count', label: labels.follower_count, value, category: 'audience' });
      }
    } catch {
      // Not available — skip.
    }

    // Total followers + total media — read off the IG account node directly.
    try {
      const { data: profile } = await http.get(`${this.base}/${igId}`, {
        params: { access_token: auth.accessToken, fields: 'followers_count,follows_count,media_count' },
      });
      if (profile.followers_count != null) {
        metrics.unshift({ key: 'ig_followers_total', label: 'Total followers', value: Number(profile.followers_count), category: 'audience' });
      }
      if (profile.media_count != null) {
        metrics.push({ key: 'ig_media_count', label: 'Total posts', value: Number(profile.media_count), category: 'audience' });
      }
    } catch {
      // Field not available — skip.
    }

    // Instagram has no public revenue/monetisation API for Business accounts.
    const monetization = {
      supported: false,
      note: 'Instagram does not expose monetisation/revenue via its public API.',
    };

    return { supported: true, metrics, monetization };
  }

  /**
   * List Instagram Business accounts reachable from this user. Each IG Business
   * account is linked to a Facebook Page, so we walk the user's Pages and pull
   * their `instagram_business_account`.
   *
   * @param {object} auth { accessToken }
   * @returns {Promise<Array<{ id, name }>>} id is the IG Business user ID
   */
  async listTargets(auth) {
    const { data } = await http.get(`${this.base}/me/accounts`, {
      params: {
        access_token: auth.accessToken,
        fields: 'name,instagram_business_account{id,username}',
      },
    });
    return (data.data || [])
      .filter((page) => page.instagram_business_account)
      .map((page) => {
        const ig = page.instagram_business_account;
        return {
          id: ig.id,
          name: ig.username ? `@${ig.username}` : `${page.name} (IG)`,
        };
      });
  }

  getAuthUrl(state) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(','),
      response_type: 'code',
      state,
    });
    return `https://www.facebook.com/${this.config.apiVersion || 'v21.0'}/dialog/oauth?${params}`;
  }

  async exchangeCode(code) {
    const { data } = await http.get(`${this.base}/oauth/access_token`, {
      params: {
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        code,
      },
    });
    return { accessToken: data.access_token, meta: { tokenType: data.token_type } };
  }

  /** Identify the logged-in user (login is via Facebook) for labelling. */
  async identity(auth) {
    const { data } = await http.get(`${this.base}/me`, {
      params: { access_token: auth.accessToken, fields: 'id,name' },
    });
    return { accountId: `ig:${data.id}`, label: data.name ? `${data.name} (IG)` : 'Instagram account' };
  }

  /**
   * @param {object} post { text, mediaType, mediaUrl, igUserId }
   * @param {object} auth { accessToken }
   */
  async publish(post, auth) {
    this.assertSupports(post.mediaType);
    if (post.scheduledAt) {
      throw new Error(
        'instagram: the API does not support scheduling; use the app scheduler (keeps the tab open).'
      );
    }
    const token = auth.accessToken;
    const igUserId = post.igUserId;
    if (!igUserId) throw new Error('instagram: an IG Business user ID is required.');
    if (!post.mediaUrl) {
      throw new Error('instagram: a public mediaUrl is required (Instagram fetches media itself).');
    }

    // Step 1 — create container
    const containerParams = {
      access_token: token,
      caption: post.text || '',
    };
    if (post.mediaType === 'video') {
      containerParams.media_type = 'REELS';
      containerParams.video_url = post.mediaUrl;
    } else {
      containerParams.image_url = post.mediaUrl;
    }
    const { data: container } = await http.post(
      `${this.base}/${igUserId}/media`,
      null,
      { params: containerParams }
    );

    // Step 2 — publish container
    const { data: published } = await http.post(
      `${this.base}/${igUserId}/media_publish`,
      null,
      { params: { creation_id: container.id, access_token: token } }
    );

    return { id: published.id, url: `https://instagram.com/p/${published.id}` };
  }
}

/** Clamp an analytics window to the supported 7–90 day range (default 7). */
function clampDaysIg(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) return 7;
  return Math.min(90, Math.max(7, Math.floor(n)));
}

