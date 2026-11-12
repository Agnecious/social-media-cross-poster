import fs from 'node:fs';
import { PlatformPublisher } from './PlatformPublisher.js';
import { http } from '../services/http.js';
import { logger } from '../services/logger.js';

/**
 * LinkedIn adapter — API v2, OAuth 2.0 / OpenID Connect.
 *
 * Posts text (+ optional image/video) to the authenticated MEMBER's profile via
 * POST /rest/posts. It posts to the personal profile (self-serve "Share on
 * LinkedIn" + "Sign In with LinkedIn using OpenID Connect" products); posting to
 * a company Page needs the vetted w_organization_social product and is NOT
 * implemented here. There is no per-post target picker and no native scheduling
 * API (the app's browser scheduler handles scheduled posts).
 *
 * Author identity: LinkedIn's versioned Posts API needs an author URN. We
 * resolve the member id from /v2/userinfo (OIDC `sub`) at token-exchange time
 * and stash the URN in the token's `meta.authorUrn`, so it travels with the
 * persisted account and is available at publish time (publish only receives the
 * decrypted auth, not the accountId).
 *
 * Media: images/videos are uploaded first via the Images/Videos API
 * (initializeUpload -> PUT bytes), then the returned asset URN is referenced in
 * the post body's `content.media`.
 *
 * All /rest/* calls carry a monthly `LinkedIn-Version` header (YYYYMM, from
 * LINKEDIN_API_VERSION) and `X-Restli-Protocol-Version: 2.0.0`.
 */
export class LinkedInPublisher extends PlatformPublisher {
  /** The monthly versioned header value (e.g. "202502"). */
  get version() {
    return this.config.apiVersion || '202502';
  }

  /** Common headers for the versioned REST endpoints. */
  restHeaders(token, extra = {}) {
    return {
      Authorization: `Bearer ${token}`,
      'LinkedIn-Version': this.version,
      'X-Restli-Protocol-Version': '2.0.0',
      ...extra,
    };
  }

  capabilities() {
    return { text: true, image: true, video: true };
  }

  /** Posts to the member's own profile — no Page/destination picker. */
  requiresTarget() {
    return false;
  }

  /** LinkedIn has no public scheduling API; the app scheduler handles it. */
  supportsScheduling() {
    return false;
  }

  supportsAnalytics() {
    return false;
  }

  // --- OAuth --------------------------------------------------------------

  getAuthUrl(state) {
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      state,
      // LinkedIn expects space-delimited scopes.
      scope: (this.config.scopes.length
        ? this.config.scopes
        : ['openid', 'profile', 'email', 'w_member_social']
      ).join(' '),
    });
    return `https://www.linkedin.com/oauth/v2/authorization?${params}`;
  }

  async exchangeCode(code) {
    const { data } = await http.post(
      'https://www.linkedin.com/oauth/v2/accessToken',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
        client_id: this.config.clientId,
        client_secret: this.config.clientSecret,
      }),
      { headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }
    );

    const accessToken = data.access_token;
    // Resolve the member id now so the author URN travels with the token
    // (publish only receives the decrypted auth, not the accountId).
    let authorUrn;
    let name;
    try {
      const me = await this.userinfo(accessToken);
      if (me?.sub) {
        authorUrn = `urn:li:person:${me.sub}`;
        name = me.name;
      }
    } catch (err) {
      logger.warn('linkedin.exchangeCode: userinfo failed (author URN unresolved)', {
        error: err?.response?.data || err?.message,
      });
    }

    return {
      accessToken,
      meta: {
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        scope: data.scope,
        authorUrn,
        name,
      },
    };
  }

  /** Call the OpenID Connect userinfo endpoint. */
  async userinfo(accessToken) {
    const { data } = await http.get('https://api.linkedin.com/v2/userinfo', {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return data; // { sub, name, email, ... }
  }

  /** Identify the member so multiple LinkedIn logins can be labelled. */
  async identity(auth) {
    // Prefer the URN resolved at exchange time; otherwise look it up now.
    let sub = auth.meta?.authorUrn ? auth.meta.authorUrn.split(':').pop() : null;
    let name = auth.meta?.name;
    if (!sub) {
      try {
        const me = await this.userinfo(auth.accessToken);
        sub = me?.sub;
        name = me?.name;
      } catch {
        // fall through to a generic label
      }
    }
    if (sub) {
      return { accountId: `li:${sub}`, label: name || 'LinkedIn account' };
    }
    return { accountId: `li:${Date.now()}`, label: 'LinkedIn account' };
  }

  // --- Publishing ---------------------------------------------------------

  /** Resolve the author URN from the token, or look it up as a fallback. */
  async resolveAuthorUrn(auth) {
    if (auth.meta?.authorUrn) return auth.meta.authorUrn;
    const me = await this.userinfo(auth.accessToken);
    if (!me?.sub) throw new Error('linkedin: could not resolve the author (userinfo returned no id).');
    return `urn:li:person:${me.sub}`;
  }

  /**
   * @param {object} post { text, mediaType, filePath?, scheduledAt? }
   * @param {object} auth { accessToken, meta:{ authorUrn } }
   */
  async publish(post, auth) {
    this.assertSupports(post.mediaType);
    if (post.scheduledAt) {
      throw new Error(
        'linkedin: the API does not support scheduling; use the app scheduler (keeps the tab open).'
      );
    }
    const token = auth.accessToken;
    const author = await this.resolveAuthorUrn(auth);
    const commentary = post.text || '';

    // Build the base post body (UGC "Posts" API shape).
    const body = {
      author,
      commentary,
      visibility: 'PUBLIC',
      distribution: {
        feedDistribution: 'MAIN_FEED',
        targetEntities: [],
        thirdPartyDistributionChannels: [],
      },
      lifecycleState: 'PUBLISHED',
      isReshareDisabledByAuthor: false,
    };

    if (post.mediaType !== 'none') {
      if (!post.filePath) throw new Error(`linkedin: a file is required for a ${post.mediaType} post.`);
      const assetUrn = await this.uploadMedia(post, auth, author);
      body.content = {
        media: {
          // A short alt/title; LinkedIn shows the commentary as the post text.
          title: (post.text || 'Media').slice(0, 60),
          id: assetUrn,
        },
      };
    } else if (!commentary.trim()) {
      throw new Error('linkedin: a post needs text (or attach media).');
    }

    const res = await http.post('https://api.linkedin.com/rest/posts', body, {
      headers: this.restHeaders(token, { 'Content-Type': 'application/json' }),
    });

    // The created post URN is returned in the x-restli-id / x-linkedin-id header.
    const postUrn =
      res.headers?.['x-restli-id'] || res.headers?.['x-linkedin-id'] || res.data?.id;
    const url = postUrn
      ? `https://www.linkedin.com/feed/update/${encodeURIComponent(postUrn)}/`
      : 'https://www.linkedin.com/feed/';
    return { id: postUrn || '', url };
  }

  /**
   * Upload an image or video and return its asset URN. Uses the versioned
   * Images/Videos API: initializeUpload to get an uploadUrl + URN, PUT the
   * bytes, and (for simplicity/reliability) a single-shot upload. LinkedIn
   * accepts single-shot uploads for typical social media file sizes.
   */
  async uploadMedia(post, auth, author) {
    const token = auth.accessToken;
    const isVideo = post.mediaType === 'video';
    const resource = isVideo ? 'videos' : 'images';
    const fileSize = fs.statSync(post.filePath).size;

    // 1) initializeUpload
    const initBody = isVideo
      ? {
          initializeUploadRequest: {
            owner: author,
            fileSizeBytes: fileSize,
            uploadCaptions: false,
            uploadThumbnail: false,
          },
        }
      : { initializeUploadRequest: { owner: author } };

    const { data: init } = await http.post(
      `https://api.linkedin.com/rest/${resource}?action=initializeUpload`,
      initBody,
      { headers: this.restHeaders(token, { 'Content-Type': 'application/json' }) }
    );

    const value = init.value || {};
    const assetUrn = value.image || value.video; // URN of the created asset

    // Images return a single uploadUrl; videos return uploadInstructions.
    const uploadUrl =
      value.uploadUrl ||
      value.uploadInstructions?.[0]?.uploadUrl;
    if (!uploadUrl || !assetUrn) {
      throw new Error('linkedin: upload initialization did not return an upload URL.');
    }

    // 2) PUT the bytes to the signed upload URL.
    await http.put(uploadUrl, fs.createReadStream(post.filePath), {
      timeout: 0,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/octet-stream',
        'Content-Length': fileSize,
      },
      maxContentLength: Infinity,
      maxBodyLength: Infinity,
    });

    // 3) For video, finalize if the API provided a finalize step (multipart
    // uploads). Single-shot uploads need no finalize. We keep it simple: a
    // single PUT covers typical files; large multipart videos would need the
    // per-part ETag FINALIZE call, which can be added if needed.

    return assetUrn;
  }
}
