import FormData from 'form-data';
import fs from 'node:fs';
import { PlatformPublisher } from './PlatformPublisher.js';
import { http } from '../services/http.js';
import { logger } from '../services/logger.js';

/**
 * Facebook adapter — posts text / photo / video to a Facebook Page.
 * Uses the Graph API. Note: posting to personal profiles is not supported
 * by the API; you post to a Page you manage.
 */
export class FacebookPublisher extends PlatformPublisher {
  get base() {
    return `https://graph.facebook.com/${this.config.apiVersion || 'v21.0'}`;
  }

  capabilities() {
    return { text: true, image: true, video: true };
  }

  requiresTarget() {
    return true;
  }

  supportsScheduling() {
    return true;
  }

  supportsAnalytics() {
    return true;
  }

  /**
   * Facebook Page insights over the last `days`. Requires a Page (target) with
   * its page access token. Needs the `read_insights` scope on the connection.
   *
   * @param {object} auth { accessToken } (user token; page token preferred via target)
   * @param {object} opts { days, target: { id, extra:{ pageAccessToken } } }
   */
  async analytics(auth, opts = {}) {
    const days = clampDays(opts.days);
    const target = opts.target;
    if (!target?.id) {
      return {
        supported: true,
        metrics: [],
        note: 'Select a Facebook Page to see its insights.',
      };
    }
    const token = target.extra?.pageAccessToken || auth.accessToken;
    const since = Math.floor((Date.now() - days * 86400000) / 1000);
    const until = Math.floor(Date.now() / 1000);

    // Metrics vary by API version / Page eligibility, and Meta has deprecated
    // several. Request each one INDEPENDENTLY so a single unsupported metric
    // doesn't fail the whole call — we just skip the ones the API rejects.
    // `cumulative` metrics (running totals like followers) take the latest value.
    // Meta keeps deprecating/renaming Page Insights metrics (notably the
    // impressions -> views migration and the Nov-2025 round), and the whole
    // insights endpoint only returns data for Pages with 100+ likes. We request
    // each metric INDEPENDENTLY and, for the ones with newer replacements, try a
    // list of candidate names until one succeeds. Any failures are recorded so
    // we can surface a helpful note instead of silently showing nothing.
    const wanted = [
      { keys: ['page_impressions_unique'], label: 'Reach (people)', category: 'reach' },
      { keys: ['page_impressions'], label: 'Impressions', category: 'reach' },
      // Page views: the `_total` variant was deprecated; try the base name too.
      { keys: ['page_views_total', 'page_views'], label: 'Page views', category: 'reach' },
      { keys: ['page_post_engagements'], label: 'Post engagements', category: 'engagement' },
      // New followers: newer Pages expose the `_unique` daily-follows metric.
      { keys: ['page_daily_follows_unique', 'page_fan_adds_unique', 'page_fan_adds'], label: 'New followers', category: 'audience' },
      { keys: ['page_daily_unfollows_unique', 'page_fan_removes_unique', 'page_fan_removes'], label: 'Unfollows', category: 'audience' },
    ];

    const metrics = [];
    const skipped = [];
    for (const w of wanted) {
      let got = false;
      let lastErr = null;
      for (const key of w.keys) {
        try {
          const { data } = await http.get(`${this.base}/${target.id}/insights`, {
            params: { access_token: token, metric: key, since, until, period: 'day' },
          });
          const series = data.data?.[0]?.values;
          if (!Array.isArray(series)) {
            lastErr = 'no series';
            continue;
          }
          const value = series.reduce((sum, v) => sum + Number(v.value ?? 0), 0);
          metrics.push({ key, label: w.label, value, category: w.category });
          got = true;
          break;
        } catch (err) {
          lastErr = err?.response?.data?.error?.message || err?.message || 'request failed';
        }
      }
      if (!got) skipped.push({ label: w.label, reason: lastErr });
    }

    if (skipped.length) {
      logger.info('facebook.analytics metrics skipped', {
        pageId: target.id,
        skipped: skipped.map((s) => `${s.label}: ${s.reason}`),
      });
    }

    // Page-node fields are the RELIABLE source for audience headline numbers —
    // they don't depend on the volatile insights metric names or the 100-likes
    // rule (only on pages_read_engagement). Pull total followers + likes.
    let pageLikes = null;
    let pageNodeError = null;
    try {
      const { data: page } = await http.get(`${this.base}/${target.id}`, {
        params: { access_token: token, fields: 'followers_count,fan_count' },
      });
      const followers = Number(page.followers_count ?? page.fan_count ?? 0);
      if (followers > 0) {
        metrics.unshift({ key: 'page_followers_total', label: 'Total followers', value: followers, category: 'audience' });
      }
      if (page.fan_count != null) {
        pageLikes = Number(page.fan_count);
        metrics.push({ key: 'page_likes_total', label: 'Page likes', value: pageLikes, category: 'audience' });
      }
    } catch (err) {
      pageNodeError = err?.response?.data?.error?.message || err?.message || 'request failed';
      logger.info('facebook.analytics page-node fields failed', {
        pageId: target.id,
        reason: pageNodeError,
      });
    }

    // Build a debug block so the exact per-metric reasons are visible in the UI
    // (helps diagnose scope/permission/eligibility issues without server logs).
    const debug = [];
    for (const s of skipped) debug.push(`${s.label}: ${s.reason}`);
    if (pageNodeError) debug.push(`Followers/likes (Page profile): ${pageNodeError}`);

    // Monetisation: Facebook provides no general revenue API for Pages, so we
    // surface it honestly as unavailable rather than inventing a number.
    const monetization = {
      supported: false,
      note: 'Facebook does not expose Page monetisation/revenue via its public API.',
    };

    if (metrics.length === 0) {
      return {
        supported: true,
        metrics: [],
        monetization,
        debug,
        note: 'No insights available for this Page yet (a Page needs recent activity, and some metrics require a larger audience).',
      };
    }

    // If reach/follower metrics got skipped we only end up with engagement.
    // Explain why so the user isn't left wondering.
    let note;
    const haveReachOrAudience = metrics.some(
      (m) => m.category === 'reach' || m.category === 'audience'
    );
    if (!haveReachOrAudience) {
      note =
        'Only engagement is available. Facebook Page Insights (reach, views, followers) ' +
        'need a Page with 100+ likes and the read_insights permission — reconnect this ' +
        'Page if you granted it recently.';
    } else if (pageLikes != null && pageLikes < 100) {
      note =
        'This Page has under 100 likes, so Facebook limits the insights it returns. ' +
        'Follower totals are shown from the Page profile.';
    }

    return { supported: true, metrics, monetization, note, debug };
  }

  /**
   * List the Pages this user manages. Each Page carries its own access token,
   * which is what we publish with (the `extra.pageAccessToken`).
   *
   * @param {object} auth { accessToken } the user token from OAuth
   * @returns {Promise<Array<{ id, name, extra: { pageAccessToken } }>>}
   */
  async listTargets(auth) {
    const { data } = await http.get(`${this.base}/me/accounts`, {
      params: { access_token: auth.accessToken, fields: 'id,name,access_token' },
    });
    return (data.data || []).map((page) => ({
      id: page.id,
      name: page.name,
      extra: { pageAccessToken: page.access_token },
    }));
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
    // The caller may still need to resolve a Page token; kept minimal here.
    return { accessToken: data.access_token, meta: { tokenType: data.token_type } };
  }

  /** Identify the logged-in user so multiple FB logins can be labelled. */
  async identity(auth) {
    const { data } = await http.get(`${this.base}/me`, {
      params: { access_token: auth.accessToken, fields: 'id,name' },
    });
    return { accountId: `fb:${data.id}`, label: data.name || 'Facebook account' };
  }

  /**
   * Validate a scheduled time against Facebook's rules and return the Unix
   * timestamp (seconds) it expects. Facebook requires the time to be between
   * 10 minutes and 75 days in the future.
   */
  static scheduledPublishTime(scheduledAt) {
    const when = new Date(scheduledAt).getTime();
    if (Number.isNaN(when)) throw new Error('facebook: invalid scheduled time.');
    const now = Date.now();
    const minMs = 10 * 60 * 1000;
    const maxMs = 75 * 24 * 60 * 60 * 1000;
    if (when < now + minMs) {
      throw new Error('facebook: scheduled time must be at least 10 minutes from now.');
    }
    if (when > now + maxMs) {
      throw new Error('facebook: scheduled time must be within 75 days.');
    }
    return Math.floor(when / 1000);
  }

  /**
   * @param {object} post { text, mediaType, filePath?, pageId, pageAccessToken?, scheduledAt? }
   * @param {object} auth { accessToken }
   */
  async publish(post, auth) {
    this.assertSupports(post.mediaType);
    const token = post.pageAccessToken || auth.accessToken;
    const pageId = post.pageId;
    if (!pageId) throw new Error('facebook: a Page ID is required to publish.');

    // If a future time is given, tell Facebook to hold and publish it later.
    const scheduling = post.scheduledAt
      ? {
          published: 'false',
          scheduled_publish_time: FacebookPublisher.scheduledPublishTime(post.scheduledAt),
        }
      : {};

    if (post.mediaType === 'none') {
      const { data } = await http.post(`${this.base}/${pageId}/feed`, null, {
        params: { message: post.text, access_token: token, ...scheduling },
      });
      return { id: data.id, url: `https://facebook.com/${data.id}`, scheduled: !!post.scheduledAt };
    }

    const endpoint = post.mediaType === 'video' ? 'videos' : 'photos';
    const form = new FormData();
    form.append('access_token', token);
    if (post.text) form.append(post.mediaType === 'video' ? 'description' : 'caption', post.text);
    form.append('source', fs.createReadStream(post.filePath));
    for (const [k, v] of Object.entries(scheduling)) form.append(k, String(v));

    const { data } = await http.post(`${this.base}/${pageId}/${endpoint}`, form, {
      timeout: 0, // media upload can take a while — don't apply the short client timeout
      headers: form.getHeaders(),
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });
    const id = data.id || data.post_id;
    return { id, url: `https://facebook.com/${id}`, scheduled: !!post.scheduledAt };
  }
}

/** Clamp an analytics window to the supported 7–90 day range (default 7). */
function clampDays(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) return 7;
  return Math.min(90, Math.max(7, Math.floor(n)));
}

/** Human-friendly labels for raw metric keys. */
function prettyMetric(key) {
  const map = {
    page_impressions: 'Impressions',
    page_post_engagements: 'Post engagements',
    page_fans: 'Total followers',
  };
  return map[key] || key;
}
