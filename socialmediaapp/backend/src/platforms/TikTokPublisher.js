import { http } from '../services/http.js';
import fs from 'node:fs';
import { PlatformPublisher } from './PlatformPublisher.js';

/**
 * TikTok adapter — Content Posting API. Video (and photo) upload.
 * Requires app review/approval before production posting.
 *
 * Flow: initialize an upload (get an upload_url), PUT the file bytes,
 * then TikTok processes and publishes.
 */
export class TikTokPublisher extends PlatformPublisher {
  capabilities() {
    return { text: false, image: true, video: true };
  }

  getAuthUrl(state) {
    const params = new URLSearchParams({
      client_key: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(','),
      response_type: 'code',
      state,
    });
    return `https://www.tiktok.com/v2/auth/authorize/?${params}`;
  }

  async exchangeCode(code) {
    const { data } = await http.post(
      'https://open.tiktokapis.com/v2/oauth/token/',
      new URLSearchParams({
        client_key: this.config.clientId,
        client_secret: this.config.clientSecret,
        code,
        grant_type: 'authorization_code',
        redirect_uri: this.config.redirectUri,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );
    return {
      accessToken: data.access_token,
      meta: { refreshToken: data.refresh_token, openId: data.open_id, expiresIn: data.expires_in },
    };
  }

  /** Identify the connected TikTok account (display name if available). */
  async identity(auth) {
    const openId = auth.meta?.openId;
    try {
      const { data } = await http.get('https://open.tiktokapis.com/v2/user/info/', {
        params: { fields: 'open_id,display_name' },
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const u = data.data?.user;
      if (u) {
        return {
          accountId: `tt:${u.open_id || openId}`,
          label: u.display_name ? `@${u.display_name}` : 'TikTok account',
        };
      }
    } catch {
      // fall through
    }
    return { accountId: `tt:${openId || Date.now()}`, label: 'TikTok account' };
  }

  /**
   * @param {object} post { text, mediaType, filePath }
   * @param {object} auth { accessToken }
   */
  async publish(post, auth) {
    this.assertSupports(post.mediaType);
    if (post.scheduledAt) {
      throw new Error(
        'tiktok: the API does not support scheduling; use the app scheduler (keeps the tab open).'
      );
    }
    const token = auth.accessToken;
    const fileSize = fs.statSync(post.filePath).size;

    // Step 1 — initialize upload
    const { data: init } = await http.post(
      'https://open.tiktokapis.com/v2/post/publish/video/init/',
      {
        post_info: { title: post.text || '', privacy_level: 'SELF_ONLY' },
        source_info: {
          source: 'FILE_UPLOAD',
          video_size: fileSize,
          chunk_size: fileSize,
          total_chunk_count: 1,
        },
      },
      {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      }
    );

    const uploadUrl = init.data.upload_url;
    const publishId = init.data.publish_id;

    // Step 2 — upload the bytes. Disable the client timeout (0) for the upload —
    // a large video can legitimately take minutes.
    await http.put(uploadUrl, fs.createReadStream(post.filePath), {
      timeout: 0,
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': fileSize,
        'Content-Range': `bytes 0-${fileSize - 1}/${fileSize}`,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    return { id: publishId, url: 'https://www.tiktok.com/' };
  }
}

