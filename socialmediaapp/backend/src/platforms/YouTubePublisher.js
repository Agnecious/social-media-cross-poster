import { http } from '../services/http.js';
import fs from 'node:fs';
import { PlatformPublisher } from './PlatformPublisher.js';

/**
 * YouTube adapter — Data API v3. VIDEO ONLY.
 * Uses a resumable upload: first open a session, then stream the file bytes.
 */
export class YouTubePublisher extends PlatformPublisher {
  capabilities() {
    return { text: false, image: false, video: true };
  }

  supportsScheduling() {
    return true;
  }

  supportsAnalytics() {
    return true;
  }

  /**
   * YouTube channel analytics over the last `days` via the YouTube Analytics
   * API. Needs the yt-analytics.readonly scope on the connection.
   *
   * @param {object} auth { accessToken }
   * @param {object} opts { days }
   */
  async analytics(auth, opts = {}) {
    const days = clampDaysYt(opts.days);
    const end = new Date();
    const start = new Date(Date.now() - days * 86400000);
    const fmt = (d) => d.toISOString().slice(0, 10); // YYYY-MM-DD
    const labels = {
      views: 'Views',
      estimatedMinutesWatched: 'Minutes watched',
      averageViewDuration: 'Avg. view (sec)',
      subscribersGained: 'Subscribers gained',
      subscribersLost: 'Subscribers lost',
      likes: 'Likes',
      comments: 'Comments',
      shares: 'Shares',
    };
    const categories = {
      views: 'reach',
      estimatedMinutesWatched: 'reach',
      averageViewDuration: 'engagement',
      subscribersGained: 'audience',
      subscribersLost: 'audience',
      likes: 'engagement',
      comments: 'engagement',
      shares: 'engagement',
    };

    const metrics = [];

    // Core engagement/reach/audience report (no special scope needed beyond
    // yt-analytics.readonly).
    try {
      const { data } = await http.get('https://youtubeanalytics.googleapis.com/v2/reports', {
        params: {
          ids: 'channel==MINE',
          startDate: fmt(start),
          endDate: fmt(end),
          metrics:
            'views,estimatedMinutesWatched,averageViewDuration,subscribersGained,subscribersLost,likes,comments,shares',
        },
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const row = data.rows?.[0] || [];
      const headers = (data.columnHeaders || []).map((h) => h.name);
      headers.forEach((name, i) => {
        metrics.push({
          key: name,
          label: labels[name] || name,
          value: Number(row[i] ?? 0),
          category: categories[name] || 'engagement',
        });
      });
    } catch {
      // Analytics window unavailable — continue with channel totals.
    }

    // Lifetime channel totals (Data API statistics): subscribers, total views,
    // video count. Audience headline numbers.
    try {
      const { data } = await http.get('https://www.googleapis.com/youtube/v3/channels', {
        params: { part: 'statistics', mine: 'true' },
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const stats = data.items?.[0]?.statistics;
      if (stats) {
        if (stats.subscriberCount != null) {
          metrics.unshift({ key: 'yt_subscribers_total', label: 'Total subscribers', value: Number(stats.subscriberCount), category: 'audience' });
        }
        if (stats.videoCount != null) {
          metrics.push({ key: 'yt_video_count', label: 'Total videos', value: Number(stats.videoCount), category: 'audience' });
        }
      }
    } catch {
      // Statistics not accessible — skip.
    }

    // Monetisation — YouTube is the one platform with a genuine revenue report,
    // but it needs the `yt-analytics-monetary.readonly` scope AND the channel
    // must be in the YouTube Partner Program. Attempt it; on failure, report it
    // honestly as unavailable rather than fabricating revenue.
    let monetization = {
      supported: false,
      note: 'Revenue requires the YouTube Partner Program and the monetary analytics scope.',
    };
    try {
      const { data } = await http.get('https://youtubeanalytics.googleapis.com/v2/reports', {
        params: {
          ids: 'channel==MINE',
          startDate: fmt(start),
          endDate: fmt(end),
          metrics: 'estimatedRevenue,estimatedAdRevenue,cpm',
          currency: 'USD',
        },
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const row = data.rows?.[0] || [];
      const headers = (data.columnHeaders || []).map((h) => h.name);
      const monLabels = {
        estimatedRevenue: 'Estimated revenue (USD)',
        estimatedAdRevenue: 'Ad revenue (USD)',
        cpm: 'CPM (USD)',
      };
      const monMetrics = headers.map((name, i) => ({
        key: name,
        label: monLabels[name] || name,
        value: Number(row[i] ?? 0),
        category: 'monetization',
      }));
      if (monMetrics.length) {
        monetization = { supported: true, metrics: monMetrics };
      }
    } catch {
      // No monetary scope / not in YPP — leave monetization.supported = false.
    }

    return { supported: true, metrics, monetization };
  }

  getAuthUrl(state) {
    const params = new URLSearchParams({
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      response_type: 'code',
      access_type: 'offline',
      prompt: 'consent',
      state,
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
  }

  async exchangeCode(code) {
    const { data } = await http.post(
      'https://oauth2.googleapis.com/token',
      new URLSearchParams({
        code,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
        redirect_uri: this.config.redirectUri,
        grant_type: 'authorization_code',
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return {
      accessToken: data.access_token,
      meta: { refreshToken: data.refresh_token, expiresIn: data.expires_in },
    };
  }

  /** Identify the connected YouTube channel for labelling. */
  async identity(auth) {
    try {
      const { data } = await http.get(
        'https://www.googleapis.com/youtube/v3/channels',
        {
          params: { part: 'snippet', mine: 'true' },
          headers: { Authorization: `Bearer ${auth.accessToken}` },
        }
      );
      const ch = data.items?.[0];
      if (ch) return { accountId: `yt:${ch.id}`, label: ch.snippet?.title || 'YouTube channel' };
    } catch {
      // fall through to generic id
    }
    return { accountId: `yt:${Date.now()}`, label: 'YouTube channel' };
  }

  /**
   * @param {object} post { text, title, mediaType, filePath, privacyStatus?, scheduledAt? }
   * @param {object} auth { accessToken }
   */
  async publish(post, auth) {
    this.assertSupports(post.mediaType);
    const token = auth.accessToken;

    const status = { privacyStatus: post.privacyStatus || 'private' };
    // For scheduling, YouTube requires the video to be private and a future
    // RFC3339 publishAt time; it goes public automatically at that moment.
    if (post.scheduledAt) {
      const when = new Date(post.scheduledAt);
      if (Number.isNaN(when.getTime())) throw new Error('youtube: invalid scheduled time.');
      if (when.getTime() <= Date.now()) {
        throw new Error('youtube: scheduled time must be in the future.');
      }
      status.privacyStatus = 'private';
      status.publishAt = when.toISOString();
    }

    const metadata = {
      snippet: {
        title: post.title || (post.text ? post.text.slice(0, 95) : 'Untitled'),
        description: post.text || '',
      },
      status,
    };

    const fileSize = fs.statSync(post.filePath).size;

    // Step 1 — start a resumable upload session
    const initRes = await http.post(
      'https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      metadata,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-Upload-Content-Length': fileSize,
          'X-Upload-Content-Type': 'video/*',
        },
      }
    );
    const uploadUrl = initRes.headers.location;

    // Step 2 — stream the bytes to the session URL. Disable the client timeout
    // (0) for the upload — a large video can legitimately take minutes.
    const { data } = await http.put(uploadUrl, fs.createReadStream(post.filePath), {
      timeout: 0,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'video/*',
        'Content-Length': fileSize,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    return { id: data.id, url: `https://youtu.be/${data.id}`, scheduled: !!post.scheduledAt };
  }
}

/** Clamp an analytics window to the supported 7–90 day range (default 7). */
function clampDaysYt(days) {
  const n = Number(days);
  if (!Number.isFinite(n)) return 7;
  return Math.min(90, Math.max(7, Math.floor(n)));
}

