import crypto from 'node:crypto';
import fs from 'node:fs';
import FormData from 'form-data';
import { PlatformPublisher } from './PlatformPublisher.js';
import { http } from '../services/http.js';
import { encrypt, decrypt, isEncryptionConfigured } from '../services/crypto.js';
import { logger } from '../services/logger.js';

/**
 * X (Twitter) adapter — API v2, OAuth 2.0 with PKCE.
 *
 * Posts text (<=280 chars) and an optional image/video to the authenticated
 * account via POST /2/tweets. There is no per-post destination (it always posts
 * to the logged-in account) and no native scheduling API, so scheduled posts
 * use the app's browser-timer fallback (the tab must stay open).
 *
 * PKCE in a stateless app: the OAuth flow here keeps NO server-side session, so
 * the per-request `code_verifier` is carried THROUGH the `state` parameter. On
 * getAuthUrl we generate the verifier, derive its S256 challenge, and pack the
 * verifier (encrypted when TOKEN_STORE_KEY is set, else base64url) into `state`.
 * On exchangeCode we receive that same `state` back and recover the verifier.
 * The verifier never leaves our round-trip and is single-use.
 *
 * Media upload uses the v1.1 media/upload endpoints (v2 has no upload yet):
 *  - images: single-shot upload
 *  - video:  chunked INIT -> APPEND -> FINALIZE (+ STATUS poll)
 * then the returned media_id is attached to the v2 tweet.
 */
export class XPublisher extends PlatformPublisher {
  /** X posts text and media to the authenticated account. */
  capabilities() {
    return { text: true, image: true, video: true };
  }

  /** No Page/channel picker — it posts to the authenticated account. */
  requiresTarget() {
    return false;
  }

  /** X API v2 has no scheduling; the app scheduler (browser timer) handles it. */
  supportsScheduling() {
    return false;
  }

  supportsAnalytics() {
    return false;
  }

  // --- PKCE helpers -------------------------------------------------------

  /** base64url without padding, as required by the PKCE/OAuth specs. */
  static b64url(buf) {
    return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  /**
   * Pack the PKCE verifier into the opaque `state` the platform echoes back.
   * Prefer AES-GCM (TOKEN_STORE_KEY); fall back to base64url so PKCE still
   * works without encryption configured. A random nonce is prefixed so `state`
   * also serves its CSRF purpose (unique per request).
   */
  static packState(verifier) {
    const nonce = crypto.randomBytes(8).toString('hex');
    const payload = JSON.stringify({ n: nonce, v: verifier });
    if (isEncryptionConfigured()) {
      return `e.${encrypt(payload)}`;
    }
    return `p.${XPublisher.b64url(Buffer.from(payload, 'utf8'))}`;
  }

  /** Recover the PKCE verifier from `state`. Throws if it can't be read. */
  static unpackState(state) {
    if (!state || typeof state !== 'string') {
      throw new Error('x: missing OAuth state; cannot complete PKCE exchange.');
    }
    const [tag, body] = [state.slice(0, 2), state.slice(2)];
    let json;
    if (tag === 'e.') {
      json = decrypt(body);
    } else if (tag === 'p.') {
      const b64 = body.replace(/-/g, '+').replace(/_/g, '/');
      json = Buffer.from(b64, 'base64').toString('utf8');
    } else {
      throw new Error('x: unrecognized OAuth state format.');
    }
    if (!json) throw new Error('x: could not read OAuth state (bad key or tampered state).');
    try {
      const { v } = JSON.parse(json);
      if (!v) throw new Error('no verifier');
      return v;
    } catch {
      throw new Error('x: OAuth state did not contain a PKCE verifier.');
    }
  }

  // --- OAuth --------------------------------------------------------------

  /**
   * Build the authorize URL. NOTE: this is also where we mint the PKCE verifier
   * and fold it into `state`, so the `state` the caller passes in is replaced
   * by our packed value (which still contains a random nonce for CSRF).
   */
  getAuthUrl(_state) {
    const verifier = XPublisher.b64url(crypto.randomBytes(32));
    const challenge = XPublisher.b64url(
      crypto.createHash('sha256').update(verifier).digest()
    );
    const packedState = XPublisher.packState(verifier);

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: (this.config.scopes.length
        ? this.config.scopes
        : ['tweet.read', 'tweet.write', 'users.read', 'offline.access']
      ).join(' '),
      state: packedState,
      code_challenge: challenge,
      code_challenge_method: 'S256',
    });
    return `https://twitter.com/i/oauth2/authorize?${params}`;
  }

  /**
   * Exchange the authorization code for an access token. Recovers the PKCE
   * verifier from `state`. Uses HTTP Basic auth (client_id:client_secret) for
   * confidential clients, which X also accepts for public clients.
   */
  async exchangeCode(code, state) {
    const verifier = XPublisher.unpackState(state);
    const basic = Buffer.from(
      `${this.config.clientId}:${this.config.clientSecret}`
    ).toString('base64');

    const { data } = await http.post(
      'https://api.twitter.com/2/oauth2/token',
      new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: this.config.redirectUri,
        code_verifier: verifier,
        client_id: this.config.clientId,
      }),
      {
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${basic}`,
        },
      }
    );
    return {
      accessToken: data.access_token,
      meta: {
        refreshToken: data.refresh_token,
        expiresIn: data.expires_in,
        scope: data.scope,
        tokenType: data.token_type,
      },
    };
  }

  /** Identify the connected X account (handle + name) for labelling. */
  async identity(auth) {
    try {
      const { data } = await http.get('https://api.twitter.com/2/users/me', {
        params: { 'user.fields': 'username,name' },
        headers: { Authorization: `Bearer ${auth.accessToken}` },
      });
      const u = data.data;
      if (u?.id) {
        return {
          accountId: `x:${u.id}`,
          label: u.username ? `@${u.username}` : u.name || 'X account',
        };
      }
    } catch (err) {
      logger.warn('x.identity lookup failed (using generic label)', {
        error: err?.response?.data || err?.message,
      });
    }
    return { accountId: `x:${Date.now()}`, label: 'X account' };
  }

  // --- Publishing ---------------------------------------------------------

  /**
   * @param {object} post { text, mediaType, filePath?, scheduledAt? }
   * @param {object} auth { accessToken }
   */
  async publish(post, auth) {
    this.assertSupports(post.mediaType);
    if (post.scheduledAt) {
      throw new Error(
        'x: the API does not support scheduling; use the app scheduler (keeps the tab open).'
      );
    }
    const token = auth.accessToken;
    const text = post.text || '';

    // Text-only tweets have a hard 280-character limit.
    if (post.mediaType === 'none') {
      if (!text.trim()) throw new Error('x: a tweet needs text (or attach media).');
      if (text.length > 280) {
        throw new Error(`x: tweet is too long (${text.length}/280 characters).`);
      }
      return this.createTweet({ text }, token);
    }

    // Media tweet: upload the file (v1.1), then attach its media_id.
    const mediaId = await this.uploadMedia(post, auth);
    const body = { media: { media_ids: [mediaId] } };
    if (text.trim()) body.text = text;
    return this.createTweet(body, token);
  }

  /** POST /2/tweets — create the tweet and return a normalized result. */
  async createTweet(body, token) {
    const { data } = await http.post('https://api.twitter.com/2/tweets', body, {
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    });
    const id = data.data?.id;
    return { id, url: id ? `https://twitter.com/i/web/status/${id}` : 'https://twitter.com/' };
  }

  /**
   * Upload media via the v1.1 upload endpoint (v2 has no upload yet) and return
   * the media_id string. Images use a single-shot upload; videos use the
   * chunked INIT/APPEND/FINALIZE flow and then poll STATUS until processed.
   *
   * Media upload is authenticated with the SAME OAuth 2.0 user bearer token.
   */
  async uploadMedia(post, auth) {
    const token = auth.accessToken;
    const uploadBase = 'https://upload.twitter.com/1.1/media/upload.json';
    const size = fs.statSync(post.filePath).size;

    if (post.mediaType === 'image') {
      const form = new FormData();
      form.append('media', fs.createReadStream(post.filePath));
      const { data } = await http.post(uploadBase, form, {
        timeout: 0,
        headers: { Authorization: `Bearer ${token}`, ...form.getHeaders() },
        maxContentLength: Infinity,
        maxBodyLength: Infinity,
      });
      return String(data.media_id_string || data.media_id);
    }

    // --- Video: chunked upload ---
    // INIT
    const initForm = new FormData();
    initForm.append('command', 'INIT');
    initForm.append('total_bytes', String(size));
    initForm.append('media_type', 'video/mp4');
    initForm.append('media_category', 'tweet_video');
    const { data: init } = await http.post(uploadBase, initForm, {
      headers: { Authorization: `Bearer ${token}`, ...initForm.getHeaders() },
    });
    const mediaId = String(init.media_id_string || init.media_id);

    // APPEND in ~4MB chunks.
    const CHUNK = 4 * 1024 * 1024;
    const fd = fs.openSync(post.filePath, 'r');
    try {
      const buf = Buffer.alloc(CHUNK);
      let segment = 0;
      let pos = 0;
      while (pos < size) {
        const bytes = fs.readSync(fd, buf, 0, CHUNK, pos);
        if (bytes <= 0) break;
        const chunk = buf.subarray(0, bytes);
        const appendForm = new FormData();
        appendForm.append('command', 'APPEND');
        appendForm.append('media_id', mediaId);
        appendForm.append('segment_index', String(segment));
        appendForm.append('media', chunk, { filename: `chunk-${segment}` });
        await http.post(uploadBase, appendForm, {
          timeout: 0,
          headers: { Authorization: `Bearer ${token}`, ...appendForm.getHeaders() },
          maxContentLength: Infinity,
          maxBodyLength: Infinity,
        });
        segment += 1;
        pos += bytes;
      }
    } finally {
      fs.closeSync(fd);
    }

    // FINALIZE
    const finForm = new FormData();
    finForm.append('command', 'FINALIZE');
    finForm.append('media_id', mediaId);
    const { data: fin } = await http.post(uploadBase, finForm, {
      headers: { Authorization: `Bearer ${token}`, ...finForm.getHeaders() },
    });

    // If X reports async processing, poll STATUS until done (or it errors).
    let info = fin.processing_info;
    let waited = 0;
    while (info && info.state && info.state !== 'succeeded') {
      if (info.state === 'failed') {
        throw new Error(`x: video processing failed${info.error?.message ? ` — ${info.error.message}` : ''}.`);
      }
      const delay = Math.min(15, Math.max(1, Number(info.check_after_secs) || 2));
      waited += delay;
      if (waited > 120) throw new Error('x: timed out waiting for video processing.');
      await new Promise((r) => setTimeout(r, delay * 1000));
      const { data: status } = await http.get(uploadBase, {
        params: { command: 'STATUS', media_id: mediaId },
        headers: { Authorization: `Bearer ${token}` },
      });
      info = status.processing_info;
    }

    return mediaId;
  }
}
